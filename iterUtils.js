const assert = require('assert');
const sift = require('sift').default;

/**
 * @template T
 * @param {(function(T): boolean | Promise<boolean>) | Object} filter
 * @param {AsyncIterable<T> | AsyncIterator<T>} iter
 * @returns {AsyncIterator<T>}
 */
async function *filterIt(filter, iter) {
  const filterFn = typeof filter === 'function' ? filter : sift(filter);
  for await (const item of iter) {
    if (await filterFn(item)) {
      yield item;
    }
  }
}

async function *limitIt(limit, iter) {
  let count = 0;
  for await (const item of iter) {
    yield item;

    if (++count === limit) {
      break
    }
  }
}

/**
 * @template T
 * @implements AsyncIterable<T>
 */
class DecoratedIterable {
  /**
   * @param {AsyncIterable<T> | AsyncIterator<T>} iter
   */
  constructor(iter) {
    this.iter = iter;
  }

  async *[Symbol.asyncIterator]() {
    for await (const item of this.iter) {
      yield item;
    }
  }

  /**
   * @param {function(T)} fn
   * @returns {Promise<void>}
   */
  async forEach(fn) {
    for await (const item of this.iter) {
      await fn(item);
    }
  }

  /**
   * @param {(function(T): boolean | Promise<boolean>) | Object} filter
   * @returns {DecoratedIterable<T>}
   */
  filter(filter) {
    return new DecoratedIterable(filterIt(filter, this));
  }

  /**
   * @returns {Promise<T[]>}
   */
  async toArray() {
    const result = [];
    for await (const item of this.iter) {
      result.push(item);
    }
    return result;
  }

  /**
   * @param {number} limit
   * @return {DecoratedIterable<T>}
   */
  limit(limit) {
    assert(limit && typeof limit === 'number', '"limit" must be a positive integer');
    return new DecoratedIterable(limitIt(limit, this));
  }
}

module.exports = {

  /**
   * @template T
   * @param {AsyncIterable<T> | AsyncIterator<T>} iter
   * @returns {DecoratedIterable<T>}
   */
  decorateIt(iter) {
    return new DecoratedIterable(iter);
  }
};
