const fs = require('fs');
const JSONStream = require('JSONStream');

/**
 * Setup and return JSON write stream.
 *
 * @param      {String}         filename  The filename
 * @param      {Array<Object>}  values    An array of JSON-serializable objects we want to write to the output file.
 * @return     {Stream}
 */
function setupJSONWriteStream(filename, values) {
  const transformStream = JSONStream.stringify(null, null, null, 2); // Args are for formatting output.
  const writeStream = fs.createWriteStream(filename);

  transformStream.pipe(writeStream);
  values.forEach(transformStream.write);
  transformStream.end();

  return writeStream;
}

/**
 * Returns a sanitized date string that can be used in a file name.
 *
 * @return     {String}  The sanitized date string.
 */
function getSanitizedDateString() {
  return new Date().toJSON().replace(/[-:\.]/g, ''); // '2020-02-01T00:33:39.895Z' -> 20200201T003355645Z'
}

module.exports = { setupJSONWriteStream, getSanitizedDateString };
