"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const log_1 = require("../../utils/log");
let Log = log_1.default.getInstance();
class Parser {
    static parse({ key = '', iv = '', options }) {
        if (!options.key) {
            Log.error('To download AbemaTV, you need to set a key manually');
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