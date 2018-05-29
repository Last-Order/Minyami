"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util = require('util');
exports.exec = util.promisify(require('child_process').exec);
exports.sleep = deley => new Promise(resolve => setTimeout(resolve, deley));
//# sourceMappingURL=system.js.map