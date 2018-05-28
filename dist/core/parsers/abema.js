"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const log_1 = require("../../utils/log");
class Parser {
    static parse({ key = '', iv = '', options }) {
        if (!options.key) {
            log_1.default.error('To download AbemaTV, you need to set a key manually');
        }
        return {
            key: options.key,
            iv,
            prefix: Parser.prefix
        };
    }
}
Parser.prefix = '';
exports.default = Parser;
//# sourceMappingURL=abema.js.map