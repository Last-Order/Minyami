"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const log_1 = require("../utils/log");
class Downloader {
    constructor(path) {
        if (path.startsWith("http")) {
            // is a url
        }
        else {
            // is a local file path
            if (!fs.existsSync(path)) {
                log_1.default.error(`File '${path}' not found.`);
            }
        }
    }
}
exports.default = Downloader;
//# sourceMappingURL=downloader.js.map