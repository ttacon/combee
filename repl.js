#!/usr/bin/env node

const assert = require('assert');
const argv = require('yargs').argv;
const Bee = require('bee-queue');
const redis = require('redis');
const repl = require('repl');
const sift = require('sift').default;


/**
 * Creates a (honey)combee to allow introspection of bee-queue jobs.
 */
class Combee {

  /**
   * Creates a new Combee.
   *
   * @param {string} redisUrl The connection URI for the redis deployment.
   * @param {[]string} queues The queues to inspect.
   */
  constructor(config) {
    assert(config.redisUrl, 'must provide redis URL');
    assert(config.queues, 'must provide queues');

    this.redis = redis.createClient(config.redisUrl);
    this.redis.on('error', function(err) { console.log(err); });
    this.createQueues(config.queues)
  }

  /**
   * Creates the internal bee-queue queues to be used later on for
   * introspection.
   *
   * @param {[]string} queues The names of the queues to care about.
   */
  createQueues(queues) {
    this._queues = new Map();
    for (const queue of queues) {
      const bq = new Bee(queue, {
        isWorker: false,
        getEvents: false,
        sendEvents: false,
        storeJobs: false,
        redis: this.redis,
        prefix: 'bq'
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
    for (const [ name, queue ] of this._queues) {
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
   * @param {BeeQueue} job The bee-queue job to inspect.
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
   * Lists all the jobs for the given job type in the given page.
   *
   * @param {string} jobType The type of job (i.e. 'active', 'waiting', etc).
   * @param {Object} page The page info.
   *   @property {number} start The start of the page.
   *   @property {number} end The end of the page.
   *   @property {number} size The size of the page.
   */
  list(jobType = 'active', page = { size: 100 }) {
    this.queue.getJobs(jobType, page)
      .then((res) => {
        if (res && res.length) {
          res = res.map(this.stripDownJob)
        }
        console.log(res);
        repl.repl.prompt();
      });
  }

  /**
   * Creates the given job.
   *
   * @param {Object} data The data for the job to create.
   */
  createJob(data) {
    this.queue.createJob(data).save().then((job) => {
      console.log(this.stripDownJob(job));
      repl.repl.prompt();
    });
  }

  /**
   * Removes jobs of the given type that match the given filter.
   *
   * @param {string} jobType The type of job to remove matches from.
   * @param {Object} filter A sift-compatible filter.
   */
  removeJobs(jobType, filter) {
    this.removeJobsAsync(jobType, filter);
  }

  /**
   * Utility function for removing jobs that match the given criteria
   * (the job type and filter).
   *
   * @param {string} jobType The type of job to remove matches from.
   * @param {Object} filter A sift-compatible filter.
   */
  async removeJobsAsync(jobType, filter) {
    const BATCH_SIZE = 50;
    const jobStats = await this.queue.checkHealth();
    const count = jobStats[jobType];
    const sifted = sift(filter);

    let numRemoved = 0;

    for (let i=0; i < count; i+=BATCH_SIZE) {
      const jobs = await this.queue.getJobs(jobType, {
        size: BATCH_SIZE,
        start: i,
      });

      const matched = jobs.filter(sifted);
      if (!matched || !matched.length) {
        continue;
      }

      await Promise.all(matched.map((job) => job.remove()));
      numRemoved += matched.length;
    }

    console.log(`removed ${numRemoved} jobs`);

    repl.repl.prompt();
  }
}


let queueNames = argv.queues;
if (typeof queueNames === 'string') {
  queueNames = queueNames.split(',');
}

const combee = new Combee({
  redisUrl: argv.redis,
  queues: queueNames,
});

repl.start({
  prompt: 'combee::> ',
  ignoreUndefined: true,
}).context.combee = combee;
