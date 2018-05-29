const util = require('util');
export const exec = util.promisify(require('child_process').exec);

export const sleep = deley => new Promise(resolve => setTimeout(resolve, deley));