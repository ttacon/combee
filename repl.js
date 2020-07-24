#!/usr/bin/env node

const assert = require('assert');
const argv = require('yargs').argv;
const Bee = require('bee-queue');
const redis = require('redis');
const repl = require('repl');
const sift = require('sift').default;
const getValue = require('get-value');
const { decorateIt } = require('./iterUtils');

/**
 * @typedef {'waiting' | 'active' | 'succeeded' | 'failed' | 'delayed'} JobType
 */

/**
 * Returns an async iterator over jobs in the given queue, of the given type.
 *
 * @param {BeeQueue} queue
 * @param {JobType}  jobType
 * @returns {AsyncIterator<BeeQueue.Job>}
 */
async function *iterate(queue, jobType) {
  const BATCH_SIZE = 50;
  const jobStats = await queue.checkHealth();
  const count = jobStats[jobType];

  for (let i = 0; i < count; i += BATCH_SIZE) {
    const jobs = await queue.getJobs(jobType, {
      size: BATCH_SIZE,
      start: i,
      end: i + BATCH_SIZE - 1,
    });

    for (const job of jobs) {
      yield job;
    }
  }
}

/**
 * Creates a (honey)combee to allow introspection of bee-queue jobs.
 */
class Combee {
  /**
   * Creates a new Combee.
   *
   * @param {string} redisUrl The connection URI for the redis deployment.
   * @param {[]string} queues The queues to inspect.
   * @param {string?} queuePrefix The queue prefix (for queue auto-detection).
   */
  constructor(config) {
    assert(config.redisUrl, 'must provide redis URL');
    assert(config.queues || config.queuePrefix, 'must provide queues');

    let redisConnection = config.redisUrl;
    if (config.redisUrl.startsWith('rediss:')) {
      // A rediss:// URL means in-transit encryption is enabled for the redis host, so use TLS.
      redisConnection = {
        url: redisConnection.replace('rediss:', 'redis:'),
        tls: {},
      };
    };

    this.redis = redis.createClient(redisConnection);

    this.redis.on('error', function(err) {
      console.log(err);
    });
    this.createQueues(config.queues, config.queuePrefix);
  }

  /**
   * Creates the internal bee-queue queues to be used later on for
   * introspection.
   *
   * @param {[]string} queues The names of the queues to care about.
   */
  createQueues(queues, prefix) {
    if (prefix && !queues) {
      this.redis.keys(`${prefix}:*:id`, (err, found) => {
        this._setQueues(
          found.map((key) => new RegExp(`${prefix}:(.*):id`).exec(key)[1])
        );
      });
    } else {
      this._setQueues(queues);
    }
  }

  _setQueues(queues) {
    this._queues = new Map();
    for (const queue of queues) {
      const bq = new Bee(queue, {
        isWorker: false,
        getEvents: false,
        sendEvents: false,
        storeJobs: false,
        redis: this.redis,
        prefix: 'bq',
      });

      this._queues.set(queue, bq);
      this[queue] = new CombeeQueue(bq);
    }
  }

  /**
   * Lists the known queues.
   *
   * @return {Object} The known queues.
   */
  listQueues() {
    const info = [];
    for (const [name, queue] of this._queues) {
      info.push({ name });
    }
    return info;
  }
}

/**
 * Creates a CombeeQueue to provide individual introspection of a queue.
 */
class CombeeQueue {
  /**
   * Constructs the CombeeQueue for the given BeeQueue.
   *
   * @param {BeeQueue} queue The queue to introspect.
   */
  constructor(queue) {
    this.queue = queue;
  }

  /**
   * Strip down job to loggable properties.
   *
   * @param {BeeQueue.Job} job The bee-queue job to inspect.
   * @returns {Object} Stripped down job object.
   */
  stripDownJob(job) {
    return {
      id: job.id,
      data: job.data,
      options: job.options,
      status: job.status,
    };
  }

  /**
   * Returns the job counts for the queue.
   */
  stats() {
    this.queue.checkHealth().then((res) => {
      console.log(res);
      repl.repl.prompt();
    });
  }

  /**
   * Returns all the jobs for the given job type in the given page, and prints them
   * in a console-friendly way.
   *
   * @param {JobType} jobType The type of job (i.e. 'active', 'waiting', etc).
   * @param {Object}  page    The page info.
   *   @property {number} start The start of the page.
   *   @property {number} end The end of the page.
   *   @property {number} size The size of the page.
   * @returns {Promise<BeeQueue.Job[]>} A promise resolving to an array of matching jobs
   */
  list(jobType = 'active', page = { size: 100, start: 0, end: 99 }) {
    return this.queue.getJobs(jobType, page).then((res) => {
      let out = res;
      if (res && res.length) {
        out = res.map((job) => this.stripDownJob(job));
      }
      console.log(out);
      repl.repl.prompt();
      return res;
    });
  }

  /**
   * Creates a job from the given data.
   *
   * @param {Object} data The data for the job to create.
   * @return {Promise<Job>} A promise resolving to the created job
   */
  createJob(data) {
    return this.queue
      .createJob(data)
      .save()
      .then((job) => {
        console.log(this.stripDownJob(job));
        repl.repl.prompt();
        return job;
      });
  }

  /**
   * Removes jobs of the given type that match the given filter.
   *
   * @param {JobType}           jobType The type of job to remove matches from.
   * @param {function | Object} filter  A function, or a sift-compatible filter
   */
  removeJobs(jobType, filter) {
    this.removeJobsAsync(jobType, filter);
  }

  /**
   * Utility function for removing jobs that match the given criteria
   * (the job type and filter).
   *
   * @param {JobType}           jobType The type of job to remove matches from.
   * @param {function | Object} filter  A function, or a sift-compatible filter
   */
  async removeJobsAsync(jobType, filter) {
    const filterFn = typeof filter === 'function' ? filter : sift(filter);

    let numRemoved = 0;

    for await (const job of this.iterate(jobType)) {
      if (filterFn(job)) {
        await job.remove();
        numRemoved++;
      }
    }

    console.log(`removed ${numRemoved} jobs`);

    repl.repl.prompt();
  }

  /**
   * Utility function for finding jobs that match the given criteria
   * (the job type and filter).
   *
   * @param {JobType}           jobType The type of job to search.
   * @param {function | Object} filter  A function, or a sift-compatible filter
   */
  async find(jobType, filter = {}) {
    const matches = await this._find(jobType, filter);
    console.log(matches.map((job) => this.stripDownJob(job)));
    repl.repl.prompt();
    return matches;
  }

  count(jobType, filter = {}) {
    return this.countAsync(jobType, filter);
  }

  /**
   * Counts the number of jobs matching the given type and filter.
   *
   * @param {JobType}           jobType The type of job to search.
   * @param {function | Object} filter  A function, or a sift-compatible filter
   * @return {Promise<number>}
   */
  async countAsync(jobType, filter = {}) {
    const matches = await this._find(jobType, filter);
    console.log(`found ${matches.length} jobs`);
    repl.repl.prompt();
    return matches.length;
  }

  distinct(jobType, field, filter) {
    return this.distinctAsync(jobType, field, filter);
  }

  /**
   * Prints the distinct values of `field` and their counts across all jobs matching
   * the given type and filter. Returns an array of all distinct values.
   *
   * @param {JobType}           jobType The type of job to search.
   * @param {string}            field   The job field to find the distinct values of
   * @param {function | Object} filter  A function, or a sift-compatible filter
   * @return {Promise<*[]>}  An array containing the distinct values of `field` in the matching jobs
   */
  async distinctAsync(jobType, field, filter) {
    const filterFn = typeof filter === 'function' ? filter : sift(filter);
    const vals = new Map();

    for await (const job of this.iterate(jobType)) {
      if (filterFn(job)) {
        const val = getValue(job, field);
        vals.set(val, (vals.get(val) || 0) + 1);
      }
    }

    console.log(); // purge to next line for readability

    for (const [key, count] of vals) {
      console.log(`${key}: ${count}`);
    }

    repl.repl.prompt();
    return [...vals.keys()];
  }

  async _find(jobType, filter) {
    const filterFn = typeof filter === 'function' ? filter : sift(filter);
    const matches = [];

    for await (const job of this.iterate(jobType)) {
      if (filterFn(job)) {
        matches.push(job);
      }
    }

    return matches;
  }

  /**
   * @param {JobType} jobType
   * @returns {DecoratedIterable<BeeQueue.Job>}
   */
  iterate(jobType) {
    return decorateIt(iterate(this.queue, jobType));
  }
}

let queueNames = argv.queues;
if (typeof queueNames === 'string') {
  queueNames = queueNames.split(',');
}

const combee = new Combee({
  redisUrl: argv.redis,
  queues: queueNames,
  queuePrefix: argv.queuePrefix,
});

repl.start({
  prompt: 'combee::> ',
  ignoreUndefined: true,
}).context.combee = combee;
