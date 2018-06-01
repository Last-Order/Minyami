const util = require('util');
export const exec = util.promisify(require('child_process').exec);

export const sleep = deley => new Promise(resolve => setTimeout(resolve, deley));

export const deleteDirectory = (path) => {
    if (process.platform === "win32") {
        return exec(`rd /s /q ${path}`);
    } else {
        return exec(`rm -rf ${path}`);
    }
}