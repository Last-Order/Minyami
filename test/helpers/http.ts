import * as http from "http";
import { AddressInfo } from "net";

export const mediaChunks = {
    "/0.ts": Buffer.from("first-chunk"),
    "/1.ts": Buffer.from("second-chunk"),
} as const;

export const masterVariantChunks = {
    low: Buffer.from("low-variant-chunk"),
    high: Buffer.from("high-variant-chunk"),
} as const;

export interface MasterPlaylistServerContext {
    readonly playlistUrl: string;
    readonly lowPlaylistUrl: string;
    readonly highPlaylistUrl: string;
    readonly requests: Map<string, number>;
}

export async function listen(server: http.Server): Promise<string> {
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", onError);
            resolve();
        });
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}

export async function close(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

export async function withMediaServer<T>(run: (playlistUrl: string, expectedOutput: Buffer) => Promise<T>): Promise<T> {
    const server = http.createServer((request, response) => {
        const chunk = mediaChunks[request.url as keyof typeof mediaChunks];
        if (chunk) {
            response.setHeader("content-length", chunk.length);
            response.end(chunk);
            return;
        }
        const address = server.address() as AddressInfo;
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        response.end(
            [
                "#EXTM3U",
                "#EXT-X-TARGETDURATION:1",
                "#EXT-X-MEDIA-SEQUENCE:0",
                "#EXTINF:1,",
                `http://127.0.0.1:${address.port}/0.ts`,
                "#EXTINF:1,",
                `http://127.0.0.1:${address.port}/1.ts`,
                "#EXT-X-ENDLIST",
            ].join("\n"),
        );
    });
    const baseUrl = await listen(server);
    try {
        return await run(`${baseUrl}/playlist.m3u8`, Buffer.concat(Object.values(mediaChunks)));
    } finally {
        await close(server);
    }
}

export async function withMasterPlaylistServer<T>(
    run: (context: MasterPlaylistServerContext) => Promise<T>,
): Promise<T> {
    const requests = new Map<string, number>();
    const server = http.createServer((request, response) => {
        const requestPath = request.url!;
        requests.set(requestPath, (requests.get(requestPath) ?? 0) + 1);
        if (requestPath === "/low.ts") {
            response.end(masterVariantChunks.low);
            return;
        }
        if (requestPath === "/high.ts") {
            response.end(masterVariantChunks.high);
            return;
        }
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        if (requestPath === "/low.m3u8" || requestPath === "/high.m3u8") {
            const chunkPath = requestPath === "/low.m3u8" ? "/low.ts" : "/high.ts";
            response.end(["#EXTM3U", "#EXTINF:1,", chunkPath, "#EXT-X-ENDLIST"].join("\n"));
            return;
        }
        response.end(
            [
                "#EXTM3U",
                '#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.low,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=24',
                "/low.m3u8",
                '#EXT-X-STREAM-INF:BANDWIDTH=2400000,CODECS="avc1.high,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60',
                "/high.m3u8",
            ].join("\n"),
        );
    });
    const baseUrl = await listen(server);
    try {
        return await run({
            playlistUrl: `${baseUrl}/master.m3u8`,
            lowPlaylistUrl: `${baseUrl}/low.m3u8`,
            highPlaylistUrl: `${baseUrl}/high.m3u8`,
            requests,
        });
    } finally {
        await close(server);
    }
}
