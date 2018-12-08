import { ParserOptions, ParserResult } from "./types";
import CommonUtils from '../../utils/common';

const cryptojs = require('crypto-js');
export default class Parser {
    static prefix = 'https://movie.freshlive.tv';
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        if (!downloader.m3u8.key || !downloader.m3u8.iv) {
            throw new Error('Key or iv missing.');
        }
        const abemafresh = [1413502068, 2104980084, 1144534056, 1967279194, 2051549272, 860632952, 1464353903, 1212380503];

        const part1 = downloader.m3u8.key.split('/')[3];
        const part2 = downloader.m3u8.key.split('/')[4];

        const hash = cryptojs.HmacSHA256(part1, cryptojs.lib.WordArray.create(abemafresh));
        const decryptResult = cryptojs.AES.decrypt(cryptojs.lib.CipherParams.create({
            ciphertext: cryptojs.enc.Hex.parse(part2)
        }), hash, {
                mode: cryptojs.mode.ECB,
                padding: cryptojs.pad.NoPadding
            }).toString();

        for (var t = new Uint8Array(16), r = 0; 16 > r; r++)
            t[r] = parseInt(decryptResult.substr(2 * r, 2), 16);

        const result = [];

        for (const i of t) {
            result.push(i.toString(16).length === 1 ? ('0' + i.toString(16)) : i.toString(16));
        }

        downloader.saveEncryptionKey(
            CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, downloader.m3u8.key), 
            result.join('')
        );

        return {};
    }
}