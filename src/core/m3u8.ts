import { buildFullUrl } from "../utils/common";
import logger from "../utils/log";

export class M3U8ParseError extends Error {}

interface BaseChunk {
    url: string;
}

interface NormalChunk extends BaseChunk {
    length: number;
    sequenceId: number;
    isInitialChunk: false;
}

interface InitialChunk extends BaseChunk {
    isInitialChunk: true;
}

interface PlainNormalChunk extends NormalChunk {
    isEncrypted: false;
}

interface EncryptedNormalChunk extends NormalChunk {
    key: string;
    iv: string;
    isEncrypted: true;
}

interface PlainInitialChunk extends InitialChunk {
    isEncrypted: false;
}

interface EncryptedInitialChunk extends InitialChunk {
    key: string;
    iv: string;
    isEncrypted: true;
}

export type M3U8Chunk = PlainNormalChunk | EncryptedNormalChunk | PlainInitialChunk | EncryptedInitialChunk;

export interface Stream {
    url: string;
    bandwidth: number;
    codecs?: string;
    frameRate?: number;
    resolution?: { width: number; height: number };
}

export const isInitialChunk = (chunk: M3U8Chunk): chunk is PlainInitialChunk | EncryptedInitialChunk => {
    return chunk.isInitialChunk;
};

export const isNormalChunk = (chunk: M3U8Chunk): chunk is PlainNormalChunk | EncryptedNormalChunk => {
    return !isInitialChunk(chunk);
};

export const isEncryptedChunk = (chunk: M3U8Chunk): chunk is EncryptedNormalChunk | EncryptedInitialChunk => {
    return chunk.isEncrypted;
};

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
                const url = buildFullUrl(this.m3u8Url, nextLine);
                const streamInfo: Stream = {
                    url,
                    bandwidth: +parsedTagBody["BANDWIDTH"],
                    ...(parsedTagBody["CODECS"] ? { codecs: parsedTagBody["CODECS"] } : {}),
                    ...(parsedTagBody["FRAME-RATE"] ? { frameRate: +parsedTagBody["FRAME-RATE"] } : {}),
                };
                if (parsedTagBody["RESOLUTION"] && parsedTagBody["RESOLUTION"].includes("x")) {
                    const [x, y] = parsedTagBody["RESOLUTION"].split("x").map((n) => parseInt(n));
                    streamInfo.resolution = {
                        width: x,
                        height: y,
                    };
                }
                this.streams.push(streamInfo);
            }
            // TODO: Support #EXT-X-MEDIA
        }
    }
}

export interface PlaylistParseParams {
    m3u8Content: string;
    m3u8Url?: string;
}

export class Playlist {
    m3u8Content: string;
    m3u8Url: string;
    sequenceId: number = 0;
    isEnd: boolean = false;
    chunks: M3U8Chunk[] = [];
    encryptKeys: string[] = [];
    averageChunkLength = 0;
    totalChunkLength = 0;

    constructor({ m3u8Content, m3u8Url = "" }: PlaylistParseParams) {
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
                this.sequenceId = parseInt(tagBody);
            }
            if (currentLine.startsWith("#EXT-X-KEY")) {
                /**
                 * @see https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.2.4
                 */
                const tagBody = getTagBody(currentLine);
                const parsedTagBody = parseTagBody(tagBody);
                if (parsedTagBody["METHOD"] === "AES-128") {
                    isEncrypted = true;
                    key = parsedTagBody["URI"];
                    if (parsedTagBody["IV"]) {
                        iv = parsedTagBody["IV"].match(/0x([^,]+)/)[1];
                    }
                    this.encryptKeys.push(key);
                } else if (parsedTagBody["METHOD"] === "NONE") {
                    isEncrypted = false;
                } else {
                    isEncrypted = false;
                    logger.warning(
                        `Unsupported encryption method: "${parsedTagBody["METHOD"]}". Chunks will not be decrypted.`
                    );
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
                if (isEncrypted && !iv) {
                    /**
                     * If the Media Initialization Section declared by an EXT-X-MAP tag is
                     * encrypted with a METHOD of AES-128, the IV attribute of the EXT-X-KEY
                     * tag that applies to the EXT-X-MAP is REQUIRED.
                     * @see https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.2.5
                     */
                    throw new M3U8ParseError("Missing IV for encrypted initialization segment");
                }
                this.chunks.push({
                    url: buildFullUrl(this.m3u8Url, initialSegmentUrl),
                    isEncrypted,
                    key,
                    iv,
                    isInitialChunk: true,
                });
            }
            if (currentLine.startsWith("#EXT-X-ENDLIST")) {
                this.isEnd = true;
                break;
            }
            if (currentLine.startsWith("#EXTINF")) {
                const tagBody = getTagBody(currentLine);
                const chunkLength = parseFloat(tagBody.split(",")[0]) || 5.0;
                const nextLine = lines[i + 1];
                if (!nextLine) {
                    throw new M3U8ParseError("Invalid M3U8 file.");
                }
                if (!nextLine.startsWith("http") && !this.m3u8Url) {
                    throw new M3U8ParseError("Missing full url for M3U8.");
                }
                if (isEncrypted) {
                    this.chunks.push({
                        url: buildFullUrl(this.m3u8Url, nextLine),
                        length: chunkLength,
                        isEncrypted: true,
                        key,
                        iv,
                        sequenceId: this.sequenceId,
                        isInitialChunk: false,
                    });
                } else {
                    this.chunks.push({
                        url: buildFullUrl(this.m3u8Url, nextLine),
                        length: chunkLength,
                        isEncrypted: false,
                        sequenceId: this.sequenceId,
                        isInitialChunk: false,
                    });
                }
                /**
                 * @see https://datatracker.ietf.org/doc/html/rfc8216#section-3
                 * The Media Sequence Number of the first segment in the Media Playlist is either 0 or declared in the * Playlist (Section 4.3.3.2). The Media Sequence Number of every other segment is equal to the Media * Sequence Number of the segment that precedes it plus one.
                 */
                this.sequenceId++;
            }
        }
    }

    /**
     * average length of chunks
     * @returns
     */
    public getChunkLength(): number {
        if (this.averageChunkLength) {
            return this.averageChunkLength;
        }
        const totalLength = this.chunks.filter(isNormalChunk).reduce((acc, cur) => acc + cur.length, 0);
        const totalCount = this.chunks.filter(isNormalChunk).length;
        const result = totalLength / totalCount;
        this.averageChunkLength = result;
        return result;
    }

    public getTotalChunkLength(): number {
        if (this.totalChunkLength) {
            return this.totalChunkLength;
        }
        const result = this.chunks.filter(isNormalChunk).reduce((acc, cur) => acc + cur.length, 0);
        this.totalChunkLength = result;
        return result;
    }
}

export default class M3U8 {
    m3u8Content: string;
    m3u8Url: string;
    initPrimaryKey: number;
    constructor({
        m3u8Content,
        m3u8Url,
        initPrimaryKey,
    }: {
        m3u8Content: string;
        m3u8Url?: string;
        initPrimaryKey?: number;
    }) {
        this.m3u8Content = m3u8Content;
        this.m3u8Url = m3u8Url;
        this.initPrimaryKey = initPrimaryKey;
    }
    parse() {
        if (this.m3u8Content.includes("#EXT-X-STREAM-INF")) {
            return new MasterPlaylist({ m3u8Content: this.m3u8Content, m3u8Url: this.m3u8Url });
        } else {
            return new Playlist({
                m3u8Content: this.m3u8Content,
                m3u8Url: this.m3u8Url,
            });
        }
    }
}
