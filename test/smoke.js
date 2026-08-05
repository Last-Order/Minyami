const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const axios = require("axios");
const { createArchiveDownloader, createLiveDownloader } = require("../dist/exports");
const { sliceArchiveTasks } = require("../dist/core/download/archive_tasks");
const { TaskScheduler } = require("../dist/core/download/task_scheduler");
const taskStore = require("../dist/utils/task");

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

function testArchiveSliceBoundary() {
    const tasks = [0, 1].map((id) => ({
        id,
        filename: `${id}.ts`,
        retryCount: 0,
        chunk: {
            url: `http://127.0.0.1/${id}.ts`,
            length: 1,
            sequenceId: id,
            isInitialChunk: false,
            isEncrypted: false,
        },
    }));

    assert.deepStrictEqual(
        sliceArchiveTasks(tasks, 1, 2).map((task) => task.id),
        [1]
    );
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
            Buffer.concat(Object.values(chunks)),
            chunks
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
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
            downloader.once("finished", () => {
                finished = true;
            });
            await downloader.download();
            assert.strictEqual(finished, true);
            assert.strictEqual(downloader.getSnapshot().status, "finished");
            assert.strictEqual(downloader.getSnapshot().finishedChunkCount, 2);
            assert.strictEqual(downloader.getSnapshot().pendingTaskCount, 0);
            assert.deepStrictEqual(fs.readFileSync(output), expectedOutput);
            assert.deepStrictEqual(fs.readdirSync(root), [`${name}.ts`]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

function createResumeTasks(playlistUrl) {
    const baseUrl = new URL(playlistUrl);
    return [0, 1].map((id) => ({
        id,
        filename: `${id.toString().padStart(6, "0")}_${id}.ts`,
        retryCount: 0,
        chunk: {
            url: new URL(`/${id}.ts`, baseUrl).toString(),
            length: 1,
            sequenceId: id,
            isInitialChunk: false,
            isEncrypted: false,
        },
    }));
}

function createSavedArchiveTask(playlistUrl, tempPath, outputPath, tasks) {
    return {
        id: playlistUrl,
        tempPath,
        m3u8Path: playlistUrl,
        outputPath,
        threads: 1,
        headers: {},
        startedAt: Date.now() - 1000,
        finishedChunksCount: 1,
        finishedChunkLength: 1,
        totalChunksCount: tasks.length,
        retries: 2,
        timeout: 60000,
        proxy: "",
        downloadTasks: [tasks[1]],
        allDownloadTasks: tasks,
        finishedFilenames: { [tasks[0].filename]: true },
        droppedFilenames: {},
    };
}

async function withMockedArchiveTask(savedTask, run) {
    const originalGetTask = taskStore.getTask;
    const originalSaveTask = taskStore.saveTask;
    const originalDeleteTask = taskStore.deleteTask;
    const calls = { saved: [], deleted: [] };
    taskStore.getTask = () => savedTask;
    taskStore.saveTask = (task) => calls.saved.push(task);
    taskStore.deleteTask = (id) => calls.deleted.push(id);
    try {
        await run(calls);
    } finally {
        taskStore.getTask = originalGetTask;
        taskStore.saveTask = originalSaveTask;
        taskStore.deleteTask = originalDeleteTask;
    }
}

async function testArchiveResumeIntegrity() {
    await withMediaServer(async (playlistUrl, expectedOutput, chunks) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-resume-"));
        const tempPath = path.join(root, "session");
        const outputPath = path.join(root, "resumed.ts");
        const partialOutputPath = path.join(root, "resumed_0.ts");
        const tasks = createResumeTasks(playlistUrl);
        fs.mkdirSync(tempPath);
        fs.writeFileSync(path.join(tempPath, tasks[0].filename), chunks["/0.ts"]);
        fs.writeFileSync(partialOutputPath, "stale-partial-output");
        const savedTask = createSavedArchiveTask(playlistUrl, tempPath, outputPath, tasks);

        try {
            await withMockedArchiveTask(savedTask, async (calls) => {
                const downloader = createArchiveDownloader(undefined, { keep: true });
                await downloader.resume(playlistUrl);
                assert.deepStrictEqual(fs.readFileSync(outputPath), expectedOutput);
                assert.strictEqual(downloader.getSnapshot().pendingTaskCount, 0);
                assert.strictEqual(fs.existsSync(path.join(tempPath, tasks[0].filename)), true);
                assert.strictEqual(fs.existsSync(path.join(tempPath, tasks[1].filename)), true);
                assert.deepStrictEqual(calls.deleted, [playlistUrl]);
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

async function testArchiveResumeOptions() {
    await withMediaServer(async (playlistUrl, _expectedOutput, chunks) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-resume-options-"));
        const tempPath = path.join(root, "session");
        const outputPath = path.join(root, "should-not-be-created.ts");
        const tasks = createResumeTasks(playlistUrl);
        fs.mkdirSync(tempPath);
        fs.writeFileSync(path.join(tempPath, tasks[0].filename), chunks["/0.ts"]);
        const savedTask = createSavedArchiveTask(playlistUrl, tempPath, outputPath, tasks);

        try {
            await withMockedArchiveTask(savedTask, async (calls) => {
                const downloader = createArchiveDownloader(undefined, { noMerge: true, keep: true });
                await downloader.resume(playlistUrl);
                assert.strictEqual(fs.existsSync(outputPath), false);
                assert.strictEqual(fs.existsSync(path.join(tempPath, tasks[0].filename)), true);
                assert.strictEqual(fs.existsSync(path.join(tempPath, tasks[1].filename)), true);
                assert.strictEqual(calls.deleted.length, 0);
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

async function testArchiveResumeMissingChunkFailure() {
    await withMediaServer(async (playlistUrl) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "minyami-resume-missing-"));
        const tempPath = path.join(root, "session");
        const outputPath = path.join(root, "missing.ts");
        const tasks = createResumeTasks(playlistUrl);
        fs.mkdirSync(tempPath);
        const savedTask = createSavedArchiveTask(playlistUrl, tempPath, outputPath, tasks);

        try {
            await withMockedArchiveTask(savedTask, async () => {
                const downloader = createArchiveDownloader(undefined, { keep: true });
                await assert.rejects(() => downloader.resume(playlistUrl), /completed chunk .* is missing/);
                assert.strictEqual(downloader.getSnapshot().status, "failed");
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

async function testArchiveResumeRequiresKeep() {
    const downloader = createArchiveDownloader();
    await assert.rejects(() => downloader.resume("http://127.0.0.1/playlist.m3u8"), /keep: true/);
    assert.strictEqual(downloader.getSnapshot().status, "failed");
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
    testArchiveSliceBoundary();
    testHttpIsolation();
    await testDownloader(createArchiveDownloader, "archive");
    await testDownloader(createLiveDownloader, "live");
    await testEncryptedArchive();
    await testArchiveResumeIntegrity();
    await testArchiveResumeOptions();
    await testArchiveResumeMissingChunkFailure();
    await testArchiveResumeRequiresKeep();
    await testFailureContract();
    process.stdout.write("Smoke tests passed.\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
