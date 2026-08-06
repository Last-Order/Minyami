import { AddressInfo } from "net";
import * as http from "http";

export const mediaChunks = {
    "/0.ts": Buffer.from("first-chunk"),
    "/1.ts": Buffer.from("second-chunk"),
} as const;

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
            ].join("\n")
        );
    });
    const baseUrl = await listen(server);
    try {
        return await run(`${baseUrl}/playlist.m3u8`, Buffer.concat(Object.values(mediaChunks)));
    } finally {
        await close(server);
    }
}
