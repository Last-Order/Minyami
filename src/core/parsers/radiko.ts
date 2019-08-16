import { ParserOptions, ParserResult } from './types'

export default class Parser {
    static prefix = ''
    static parse({ downloader }: ParserOptions): ParserResult {
        const realM3U8Url = downloader.m3u8.chunks[0].url
        downloader.m3u8Path = realM3U8Url
        return new Promise((resolve, reject) => {
            downloader.loadM3U8()
                .then(() => {
                    resolve({})
                })
                .catch(err => {
                    reject(err)
                })
        })
    }
}
