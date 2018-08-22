"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = require("chalk");
class Log {
    static debug(message) {
        console.debug(chalk_1.default.gray(`[MINYAMI][DEBUG] ${message}`));
    }
    static info(message) {
        console.info(chalk_1.default.white(`[MINYAMI][INFO] ${message}`));
    }
    static warning(message) {
        console.warn(chalk_1.default.yellow(`[MINYAMI][WARN] ${message}`));
    }
    static error(message) {
        console.info(chalk_1.default.red(`[MINYAMI][ERROR] ${message}`));
        process.exit();
    }
}
exports.default = Log;
//# sourceMappingURL=log.js.map