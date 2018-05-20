const util = require('util');
export const exec = util.promisify(require('child_process').exec);
