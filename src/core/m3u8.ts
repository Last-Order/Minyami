import CommonUtils from "../utils/common";

export class M3U8ParseError extends Error {}

export interface M3U8Chunk {
    url: string;
    sequenceId: number;
    length: number;
    isEncrypted: false;
}

export interface EncryptedM3U8Chunk {
    url: string;
    sequenceId: number;
    length: number;
    key: string;
    iv: string;
    isEncrypted: true;
}

export interface Stream {
    url: string;
    bandwidth: number;
    codecs?: string;
    frameRate?: number;
    resolution?: { width: number; height: number };
}

const getTagBody = (line: string) => line.split(":").slice(1).join(":");

const parseTagBody = (body: string): Record<string, string> => {
    const matchResult = body.match(/([^=,]+)(=([^",]|(".+?"))*)?/g);
    const result = {};
    if (matchResult.length > 0) {
        for (const match of matchResult) {
            const [key, ...value] = match.split("=");
            const valueStr = value.join("=");
            result[key] = valueStr.startsWith('"') ? valueStr.slice(1, valueStr.length - 1) : valueStr;
        }
    }
    return result;
};

export class MasterPlaylist {
    m3u8Content: string;
    m3u8Url: string;
    streams: Stream[] = [];

    constructor({ m3u8Content, m3u8Url }: { m3u8Content: string; m3u8Url: string }) {
        this.m3u8Content = m3u8Content;
        this.m3u8Url = m3u8Url;
        this.parse();
    }

    private parse() {
        const lines = this.m3u8Content.split("\n");
        for (let i = 0; i <= lines.length - 1; i++) {
            /**
             * v8 引擎内部对 split/slice 出的字符串有一个对 parent 的引用
             * 并且默认不会被 GC 当 parent string 很长时会造成内存泄漏
             * 此处复制了一次字符串避免此情况
             * See also: https://github.com/nodejs/help/issues/711
             */
            const currentLine = lines[i].split("").join("").trim();
            if (currentLine.startsWith("#EXT-X-STREAM-INF")) {
                // stream information
                const nextLine = lines[i + 1];
                if (!nextLine) {
                    throw new M3U8ParseError("Invalid M3U8 file.");
                }
                const tagBody = getTagBody(currentLine);
                const parsedTagBody = parseTagBody(tagBody);
                if (!parsedTagBody["BANDWIDTH"]) {
                    /**
                     * @see https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.4.2
                     * Every EXT-X-STREAM-INF tag MUST include the BANDWIDTH attribute.
                     */
                    throw new M3U8ParseError("Missing BANDWIDTH attribute for streams.");
                }
                if (!nextLine.startsWith("http") && !this.m3u8Url) {
                    throw new M3U8ParseError("Missing full url for M3U8.");
                }
                const url = CommonUtils.buildFullUrl(this.m3u8Url, nextLine);
                const streamInfo: Stream = {
                    url,
                    bandwidth: +parsedTagBody["BANDWIDTH"],
                    ...(parsedTagBody["CODECS"] ? { codecs: parsedTagBody["CODECS"] } : {}),
                    ...(parsedTagBody["FRAME-RATE"] ? { frameRate: +parsedTagBody["FRAME-RATE"] } : {}),
                };
                this.streams.push(streamInfo);
            }
            // TODO: Support #EXT-X-MEDIA
        }
    }
}

export class Playlist {
    m3u8Content: string;
    m3u8Url: string;
    isEnd: boolean = false;
    chunks: (M3U8Chunk | EncryptedM3U8Chunk)[] = [];
    encryptKeys: string[] = [];

    constructor({ m3u8Content, m3u8Url = "" }: { m3u8Content: string; m3u8Url?: string }) {
        this.m3u8Content = m3u8Content;
        this.m3u8Url = m3u8Url;
        this.parse();
    }

    /**
     * 解析基本属性
     */
    private parse() {
        let key: string,
            iv: string,
            sequenceId = 0,
            isEncrypted = false;
        const lines = this.m3u8Content.split("\n");
        for (let i = 0; i <= lines.length - 1; i++) {
            /**
             * v8 引擎内部对 split/slice 出的字符串有一个对 parent 的引用
             * 并且默认不会被 GC 当 parent string 很长时会造成内存泄漏
             * 此处复制了一次字符串避免此情况
             * See also: https://github.com/nodejs/help/issues/711
             */
            const currentLine = lines[i].split("").join("").trim();
            if (currentLine.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
                /**
                 * @see https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.3.2
                 */
                const tagBody = getTagBody(currentLine);
                sequenceId = parseInt(tagBody);
            }
            if (currentLine.startsWith("#EXT-X-KEY")) {
                /**
                 * @see https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.2.4
                 */
                const tagBody = getTagBody(currentLine);
                const parsedTagBody = parseTagBody(tagBody);
                if (parsedTagBody["METHOD"] === "NONE") {
                    isEncrypted = false;
                } else if (parsedTagBody["METHOD"] === "AES-128") {
                    isEncrypted = true;
                    key = parsedTagBody["URI"];
                    if (parsedTagBody["IV"]) {
                        iv = parsedTagBody["IV"].match(/0x([^,]+)/)[1];
                    }
                    this.encryptKeys.push(key);
                } else {
                    console.log(parsedTagBody["METHOD"]);
                    // SAMPLE-AES is rare in production and it's not supported by Minyami.
                    throw new M3U8ParseError("Unsupported encrypt method.");
                }
            }
            if (currentLine.startsWith("#EXT-X-MAP")) {
                /**
                 * Initial segment
                 * @see https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.2.5
                 */
                const tagBody = getTagBody(currentLine);
                const parsedTagBody = parseTagBody(tagBody);
                const initialSegmentUrl = parsedTagBody["URI"];
                if (!initialSegmentUrl) {
                    throw new M3U8ParseError("Missing URL for initialization segment");
                }
                if (!initialSegmentUrl.startsWith("http") && !this.m3u8Url) {
                    throw new M3U8ParseError("Missing full url for M3U8.");
                }
                this.chunks.push({
                    url: CommonUtils.buildFullUrl(this.m3u8Url, initialSegmentUrl),
                    isEncrypted: false,
                    length: 0,
                    sequenceId: 0,
                });
            }
            if (currentLine.startsWith("#EXT-X-ENDLIST")) {
                this.isEnd = true;
                break;
            }
            if (currentLine.startsWith("#EXTINF")) {
                const tagBody = getTagBody(currentLine);
                const chunkLength = parseFloat(tagBody.split(",")[0]);
                const nextLine = lines[i + 1];
                if (!nextLine) {
                    throw new M3U8ParseError("Invalid M3U8 file.");
                }
                if (!nextLine.startsWith("http") && !this.m3u8Url) {
                    throw new M3U8ParseError("Missing full url for M3U8.");
                }
                if (isEncrypted) {
                    this.chunks.push({
                        url: CommonUtils.buildFullUrl(this.m3u8Url, nextLine),
                        length: chunkLength,
                        isEncrypted: true,
                        key,
                        iv,
                        sequenceId,
                    });
                } else {
                    this.chunks.push({
                        url: CommonUtils.buildFullUrl(this.m3u8Url, nextLine),
                        length: chunkLength,
                        isEncrypted: false,
                        sequenceId,
                    });
                }
                /**
                 * @see https://datatracker.ietf.org/doc/html/rfc8216#section-3
                 * The Media Sequence Number of the first segment in the Media Playlist is either 0 or declared in the * Playlist (Section 4.3.3.2). The Media Sequence Number of every other segment is equal to the Media * Sequence Number of the segment that precedes it plus one.
                 */
                sequenceId++;
            }
        }
    }

    // TODO: use more accurate length of each chunk
    public getChunkLength(): number {
        return (this.chunks[1] || this.chunks[0]).length;
    }
}

export default class M3U8 {
    m3u8Content: string;
    m3u8Url: string;
    constructor({ m3u8Content, m3u8Url }: { m3u8Content: string; m3u8Url?: string }) {
        this.m3u8Content = m3u8Content;
        this.m3u8Url = m3u8Url;
    }
    parse() {
        if (this.m3u8Content.includes("#EXT-X-STREAM-INF")) {
            return new MasterPlaylist({ m3u8Content: this.m3u8Content, m3u8Url: this.m3u8Url });
        } else {
            return new Playlist({ m3u8Content: this.m3u8Content, m3u8Url: this.m3u8Url });
        }
    }
}
