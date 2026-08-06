const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { createArchiveDownloader, createDownloader, createLiveDownloader } = require("../dist/exports");
const { TaskScheduler } = require("../dist/core/download/task_scheduler");

async function testScheduler() {
    const events = [];
    const attempts = new Map();
    const scheduler = new TaskScheduler({
        concurrency: 2,
        execute: async (task) => {
            events.push(`task:${task}`);
            attempts.set(task, (attempts.get(task) || 0) + 1);
            if (task === 1 && attempts.get(task) === 1) {
                throw new Error("retry once");
            }
            return task;
        },
        onError: () => true,
    });
    scheduler.add([1, 2]);
    const completion = scheduler.start();
    scheduler.close();
    await completion;

    assert.strictEqual(attempts.get(1), 2);
    assert.strictEqual(attempts.get(2), 1);
}

async function withMediaServer(run) {
    const chunks = {
        "/0.ts": Buffer.from("first-chunk"),
        "/1.ts": Buffer.from("second-chunk"),
    };
    const server = http.createServer((request, response) => {
        if (chunks[request.url]) {
            response.setHeader("content-length", chunks[request.url].length);
            response.end(chunks[request.url]);
            return;
        }
        const address = server.address();
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
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await run(
            `http://127.0.0.1:${server.address().port}/playlist.m3u8`,
            Buffer.concat(Object.values(chunks))
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function testArchiveSliceBoundary() {
    await withMediaServer(async (playlistUrl) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-archive-slice-"));
        const output = path.join(root, "slice.ts");
        try {
            const downloader = createArchiveDownloader(playlistUrl, {
                output,
                tempDir: root,
                slice: "00:00:01-00:00:02",
            });
            await downloader.download();
            const snapshot = downloader.getSnapshot();
            assert.strictEqual(snapshot.totalChunkCount, 1);
            assert.strictEqual(snapshot.completedChunkCount, 1);
            assert.deepStrictEqual(fs.readFileSync(output), Buffer.from("second-chunk"));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

async function testFixedMixedChunkNaming() {
    await withMediaServer(async (playlistUrl) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-mixed-naming-"));
        try {
            const downloader = createArchiveDownloader(playlistUrl, {
                noMerge: true,
                tempDir: root,
                threads: 1,
            });
            await downloader.download();
            assert.deepStrictEqual(fs.readdirSync(downloader.getSnapshot().tempPath).sort(), [
                "000000_0.ts",
                "000001_1.ts",
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

async function testDownloader(createDownloader, name) {
    await withMediaServer(async (playlistUrl, expectedOutput) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `minyami-${name}-`));
        const output = path.join(root, `${name}.ts`);
        try {
            const downloader = createDownloader(playlistUrl, {
                output,
                tempDir: root,
                threads: 2,
            });
            let finished = false;
            let latestChunkInfo;
            downloader.on("chunk-downloaded", (chunkInfo) => {
                latestChunkInfo = chunkInfo;
            });
            downloader.once("finished", () => {
                finished = true;
            });
            await downloader.download();
            const snapshot = downloader.getSnapshot();
            assert.strictEqual(finished, true);
            assert.strictEqual(snapshot.status, "finished");
            assert.strictEqual(snapshot.completedChunkCount, 2);
            assert.strictEqual(snapshot.successfulChunkCount, 2);
            assert.strictEqual(snapshot.droppedChunkCount, 0);
            assert.strictEqual(snapshot.successfulDuration, 2);
            assert.strictEqual(snapshot.pendingTaskCount, 0);
            assert.strictEqual("finishedChunkCount" in snapshot, false);
            assert.strictEqual("finishedChunkLength" in snapshot, false);
            assert.strictEqual(latestChunkInfo.completedChunkCount, 2);
            assert.strictEqual(latestChunkInfo.successfulChunkCount, 2);
            assert.strictEqual(latestChunkInfo.droppedChunkCount, 0);
            assert.strictEqual(latestChunkInfo.totalChunkCount, 2);
            assert.strictEqual("finishedChunksCount" in latestChunkInfo, false);
            assert.deepStrictEqual(fs.readFileSync(output), expectedOutput);
            assert.deepStrictEqual(fs.readdirSync(root), [`${name}.ts`]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

async function testCustomSource() {
    await withMediaServer(async (playlistUrl, expectedOutput) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-custom-source-"));
        const output = path.join(root, "custom.ts");
        const items = [
            {
                url: new URL("/0.ts", playlistUrl).href,
                kind: "init",
            },
            {
                url: new URL("/1.ts", playlistUrl).href,
                kind: "media",
                duration: 1,
            },
        ];
        const source = {
            sourcePath: "custom://media",
            continuous: false,
            async prepare() {
                return { sourcePath: this.sourcePath };
            },
            async *discover() {
                yield { items: [items[0]], totalItemCount: 2 };
                yield { items: [items[1]], totalItemCount: 2 };
            },
        };
        try {
            const downloader = createDownloader(source, { output, tempDir: root, threads: 2 });
            await downloader.download();
            const snapshot = downloader.getSnapshot();
            assert.strictEqual(snapshot.sourcePath, "custom://media");
            assert.strictEqual(snapshot.totalChunkCount, 2);
            assert.strictEqual(snapshot.completedChunkCount, 2);
            assert.strictEqual(snapshot.successfulDuration, 1);
            assert.strictEqual(snapshot.isEnd, true);
            assert.deepStrictEqual(fs.readFileSync(output), expectedOutput);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

function testDownloadLayerProtocolBoundary() {
    const downloadDir = path.resolve(__dirname, "../src/core/download");
    for (const entry of fs.readdirSync(downloadDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
            continue;
        }
        const source = fs.readFileSync(path.join(downloadDir, entry.name), "utf8");
        assert.doesNotMatch(
            source,
            /from\s+["'][^"']*(?:\/m3u8|\/parsers(?:\/|["']))/,
            `${entry.name} must not depend on HLS parser types`
        );
    }
}

async function testRejectsUnpreparedEncryptedItem() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-invalid-encrypted-source-"));
    const source = {
        sourcePath: "custom://encrypted-media",
        continuous: false,
        async prepare() {
            return { sourcePath: this.sourcePath };
        },
        async *discover() {
            yield {
                items: [
                    {
                        url: "http://127.0.0.1:1/unreachable.ts",
                        kind: "media",
                        duration: 1,
                        encryption: {
                            scheme: "aes-128-cbc",
                            keyId: "custom:missing-key",
                            iv: "00000000000000000000000000000001",
                        },
                    },
                ],
                totalItemCount: 1,
            };
        },
    };
    try {
        const downloader = createDownloader(source, { noMerge: true, tempDir: root });
        await assert.rejects(() => downloader.download(), /Encryption key is not registered/);
        assert.strictEqual(downloader.getSnapshot().completedChunkCount, 0);
        assert.strictEqual(downloader.getSnapshot().status, "failed");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function testLiveIncrementalDiscovery() {
    let playlistRequests = 0;
    const chunkRequests = new Map();
    const chunks = {
        "/0.ts": Buffer.from("first-live-chunk"),
        "/1.ts": Buffer.from("second-live-chunk"),
    };
    const server = http.createServer((request, response) => {
        if (chunks[request.url]) {
            chunkRequests.set(request.url, (chunkRequests.get(request.url) || 0) + 1);
            response.end(chunks[request.url]);
            return;
        }
        playlistRequests++;
        const address = server.address();
        const lines = [
            "#EXTM3U",
            "#EXT-X-TARGETDURATION:1",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXTINF:0.01,",
            `http://127.0.0.1:${address.port}/0.ts`,
        ];
        if (playlistRequests > 1) {
            lines.push("#EXTINF:0.01,", `http://127.0.0.1:${address.port}/1.ts`, "#EXT-X-ENDLIST");
        }
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        response.end(lines.join("\n"));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-live-incremental-"));
    const output = path.join(root, "live.ts");
    try {
        const downloader = createLiveDownloader(`http://127.0.0.1:${server.address().port}/playlist.m3u8`, {
            output,
            tempDir: root,
            threads: 2,
        });
        await downloader.download();
        const snapshot = downloader.getSnapshot();
        assert.strictEqual(playlistRequests, 2);
        assert.strictEqual(chunkRequests.get("/0.ts"), 1);
        assert.strictEqual(chunkRequests.get("/1.ts"), 1);
        assert.strictEqual(snapshot.totalChunkCount, 2);
        assert.strictEqual(snapshot.completedChunkCount, 2);
        assert.strictEqual(snapshot.isEnd, true);
        assert.deepStrictEqual(fs.readFileSync(output), Buffer.concat(Object.values(chunks)));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function testLiveGracefulStop() {
    let playlistRequests = 0;
    const chunk = Buffer.from("stopped-live-chunk");
    const server = http.createServer((request, response) => {
        if (request.url === "/0.ts") {
            response.end(chunk);
            return;
        }
        playlistRequests++;
        const address = server.address();
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        response.end(
            [
                "#EXTM3U",
                "#EXT-X-TARGETDURATION:10",
                "#EXT-X-MEDIA-SEQUENCE:0",
                "#EXTINF:10,",
                `http://127.0.0.1:${address.port}/0.ts`,
            ].join("\n")
        );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-live-stop-"));
    const output = path.join(root, "live.ts");
    try {
        const downloader = createLiveDownloader(`http://127.0.0.1:${server.address().port}/playlist.m3u8`, {
            output,
            tempDir: root,
        });
        downloader.once("chunk-downloaded", () => downloader.stop());
        await downloader.download();
        const snapshot = downloader.getSnapshot();
        assert.strictEqual(playlistRequests, 1);
        assert.strictEqual(snapshot.status, "finished");
        assert.strictEqual(snapshot.completedChunkCount, 1);
        assert.strictEqual(snapshot.isEnd, true);
        assert.deepStrictEqual(fs.readFileSync(output), chunk);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testRecoverySurfaceRemoved() {
    const downloader = createArchiveDownloader("http://127.0.0.1/playlist.m3u8");
    assert.strictEqual(downloader.resume, undefined);
    assert.strictEqual("isResumed" in downloader.getSnapshot(), false);
}

async function testTaskPersistenceRemoved() {
    await withMediaServer(async (playlistUrl) => {
        for (const [createDownloader, name] of [
            [createArchiveDownloader, "archive"],
            [createLiveDownloader, "live"],
        ]) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `minyami-no-task-state-${name}-`));
            try {
                const downloader = createDownloader(playlistUrl, {
                    noMerge: true,
                    output: path.join(root, `${name}.ts`),
                    tempDir: root,
                });
                await downloader.download();
                assert.strictEqual(fs.existsSync(path.join(downloader.getSnapshot().tempPath, "task.json")), false);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    });
}

async function testChunkRetryLimit() {
    let chunkRequests = 0;
    const server = http.createServer((request, response) => {
        if (request.url === "/failed.ts") {
            chunkRequests++;
            response.statusCode = 500;
            response.end("failed");
            return;
        }
        const address = server.address();
        response.setHeader("content-type", "application/vnd.apple.mpegurl");
        response.end(
            [
                "#EXTM3U",
                "#EXT-X-TARGETDURATION:1",
                "#EXT-X-MEDIA-SEQUENCE:0",
                "#EXTINF:1,",
                `http://127.0.0.1:${address.port}/failed.ts`,
                "#EXT-X-ENDLIST",
            ].join("\n")
        );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        for (const [createDownloader, name] of [
            [createArchiveDownloader, "archive"],
            [createLiveDownloader, "live"],
        ]) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `minyami-retry-limit-${name}-`));
            chunkRequests = 0;
            let chunkErrors = 0;
            try {
                const downloader = createDownloader(`http://127.0.0.1:${server.address().port}/playlist.m3u8`, {
                    noMerge: true,
                    retries: 2,
                    tempDir: root,
                });
                downloader.on("chunk-error", () => chunkErrors++);
                await downloader.download();
                assert.strictEqual(chunkRequests, 2);
                assert.strictEqual(chunkErrors, 2);
                const snapshot = downloader.getSnapshot();
                assert.strictEqual(snapshot.completedChunkCount, 1);
                assert.strictEqual(snapshot.successfulChunkCount, 0);
                assert.strictEqual(snapshot.droppedChunkCount, 1);
                assert.strictEqual(snapshot.successfulDuration, 0);
                assert.strictEqual(snapshot.totalChunkCount, 1);
                assert.strictEqual(snapshot.status, "finished");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function testHttpIsolation() {
    const originalHeader = axios.defaults.headers.common["X-Minyami-Smoke"];
    createArchiveDownloader("http://127.0.0.1/playlist.m3u8", {
        headers: "X-Minyami-Smoke: isolated",
    });
    assert.strictEqual(axios.defaults.headers.common["X-Minyami-Smoke"], originalHeader);
}

async function testEncryptedArchive() {
    const key = Buffer.from("0123456789abcdef");
    const iv = Buffer.alloc(16);
    iv[15] = 1;
    const expected = Buffer.from("encrypted chunk payload");
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
    const server = http.createServer((request, response) => {
        const address = server.address();
        if (request.url === "/key") {
            response.end(key);
        } else if (request.url === "/0.ts") {
            response.end(encrypted);
        } else {
            response.end(
                [
                    "#EXTM3U",
                    `#EXT-X-KEY:METHOD=AES-128,URI=\"http://127.0.0.1:${address.port}/key\",IV=0x00000000000000000000000000000001`,
                    "#EXTINF:1,",
                    `http://127.0.0.1:${address.port}/0.ts`,
                    "#EXT-X-ENDLIST",
                ].join("\n")
            );
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-encrypted-"));
    const output = path.join(root, "encrypted.ts");
    try {
        const downloader = createArchiveDownloader(`http://127.0.0.1:${server.address().port}/playlist.m3u8`, {
            output,
            tempDir: root,
        });
        await downloader.download();
        assert.deepStrictEqual(fs.readFileSync(output), expected);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function testFailureContract() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-failure-"));
    try {
        const downloader = createArchiveDownloader(path.join(root, "missing.m3u8"), {
            tempDir: root,
        });
        let criticalError;
        downloader.once("critical-error", (error) => {
            criticalError = error;
        });
        assert.strictEqual(downloader.getSnapshot().status, "idle");
        await assert.rejects(() => downloader.download(), /not found/);
        assert(criticalError instanceof Error);
        assert.strictEqual(downloader.getSnapshot().status, "failed");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function main() {
    await testScheduler();
    testDownloadLayerProtocolBoundary();
    await testRejectsUnpreparedEncryptedItem();
    await testArchiveSliceBoundary();
    await testFixedMixedChunkNaming();
    testRecoverySurfaceRemoved();
    testHttpIsolation();
    await testDownloader(createArchiveDownloader, "archive");
    await testDownloader(createLiveDownloader, "live");
    await testCustomSource();
    await testLiveIncrementalDiscovery();
    await testLiveGracefulStop();
    await testEncryptedArchive();
    await testTaskPersistenceRemoved();
    await testChunkRetryLimit();
    await testFailureContract();
    process.stdout.write("Smoke tests passed.\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
