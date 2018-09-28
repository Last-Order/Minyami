import { ParserOptions, ParserResult } from "./types";
import Logger from '../../utils/log';
let Log = Logger.getInstance();

export default class Parser {
    static prefix = '';
    static parse({
        key = '',
        iv = '',
        options
    }: ParserOptions): ParserResult {
        if (!options.key) {
            Log.error('To download AbemaTV, you need to set a key manually');
        }
        return {
            key: options.key, 
            iv,
            prefix: Parser.prefix
        }
    }
}