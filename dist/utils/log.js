"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = require("chalk");
class Logger {
    static getInstance() {
        if (!this.instance) {
            throw new Error("Please initalize an instance of Logger first.");
        }
        return this.instance;
    }
    static setInstance(logger) {
        this.instance = logger;
    }
}
class ConsoleLogger extends Logger {
    debug(message) {
        console.debug(chalk_1.default.gray(`[MINYAMI][DEBUG] ${message}`));
    }
    info(message) {
        console.info(chalk_1.default.white(`[MINYAMI][INFO] ${message}`));
    }
    warning(message) {
        console.warn(chalk_1.default.yellow(`[MINYAMI][WARN] ${message}`));
    }
    error(message, error = undefined) {
        if (error != undefined)
            console.log(error);
        console.info(chalk_1.default.red(`[MINYAMI][ERROR] ${message}`));
        process.exit();
    }
}
exports.ConsoleLogger = ConsoleLogger;
exports.default = Logger;
//# sourceMappingURL=log.js.map