"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = require("chalk");
class Log {
    static debug(message) {
        console.debug(chalk_1.default.gray(`[MINYAMI][DEBUG] ${message}`));
    }
    static info(message) {
        console.info(chalk_1.default.blue(`[MINYAMI][INFO] ${message}`));
    }
    static error(message) {
        console.info(chalk_1.default.red(`[MINYAMI][ERROR] ${message}`));
        throw new Error(message);
    }
}
exports.default = Log;
//# sourceMappingURL=log.js.map