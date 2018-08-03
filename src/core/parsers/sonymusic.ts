import { ParserOptions, ParserResult } from "./types";
import Log from "../../utils/log";

export default class Parser {
    static parse({
        key = '',
        iv = '',
        options
    }: ParserOptions): ParserResult { 
        if (!options.m3u8Url) {
            Log.error('Missing m3u8 url for sonymusic.');
        }
        return {
            key,
            iv,
            prefix: ''
        }
    }
}