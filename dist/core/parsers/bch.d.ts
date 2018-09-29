import { ParserOptions, ParserResult } from "./types";
export default class Parser {
    static prefix: string;
    static parse({key, iv, options}: ParserOptions): Promise<ParserResult>;
}
