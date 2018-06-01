"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require('util');
exports.exec = util.promisify(require('child_process').exec);
exports.sleep = deley => new Promise(resolve => setTimeout(resolve, deley));
exports.deleteDirectory = (path) => {
    if (process.platform === "win32") {
        return exports.exec(`rd /s /q ${path}`);
    }
    else {
        return exports.exec(`rm -rf ${path}`);
    }
};
//# sourceMappingURL=system.js.map