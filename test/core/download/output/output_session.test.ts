import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { OutputSession } from "@/core/download/output/output_session";
import { MPEG_TS_CONTAINER } from "@/core/media_container";
import { withTempDirectory } from "../../../helpers/filesystem";

describe("staged output session", () => {
    test("retains merged output in the workspace when moving to the destination fails", async () => {
        await withTempDirectory("minyami-staged-failure-", async (directory) => {
            const session = new OutputSession({
                tempPath: directory,
                outputBasePath: path.join(directory, "missing", "media"),
                noMerge: false,
                keepTemporaryFiles: false,
                muxers: [],
            });
            await session.allocateWorkspace();
            session.configureTracks(
                [{ id: "main", sourcePath: "custom://test", mediaTrack: { id: "main", type: "video" } }],
                MPEG_TS_CONTAINER,
            );
            const chunk = path.join(session.getTrackTempPath("main"), "chunk");
            fs.writeFileSync(chunk, "recoverable");
            session.markTaskReady(
                {
                    id: 0,
                    trackId: "main",
                    trackIndex: 0,
                    filename: "chunk",
                    item: { kind: "media", url: "custom://test", duration: 1 },
                },
                chunk,
            );
            await expect(session.finalize(new Map([["main", 1]]))).rejects.toThrow();
            const [retained] = session.getOutputPaths();
            expect(path.dirname(retained)).toBe(session.tempPath);
            expect(fs.readFileSync(retained, "utf8")).toBe("recoverable");
            expect(fs.readdirSync(directory)).toEqual([path.basename(session.tempPath)]);
        });
    });

    test("keeps completed tracks in the workspace until muxing finishes and checks late conflicts", async () => {
        await withTempDirectory("minyami-staged-", async (directory) => {
            const output = path.join(directory, "media.ts");
            const session = new OutputSession({
                tempPath: directory,
                outputBasePath: path.join(directory, "media"),
                noMerge: false,
                keepTemporaryFiles: false,
                muxers: [
                    {
                        name: "test",
                        outputContainer: MPEG_TS_CONTAINER,
                        async isAvailable() {
                            return true;
                        },
                        async mux(request) {
                            expect(fs.readdirSync(directory)).toEqual([path.basename(session.tempPath)]);
                            expect(
                                request.inputs.every((input) => path.dirname(input.inputPath) === session.tempPath),
                            ).toBe(true);
                            expect(path.dirname(request.outputPath)).toBe(session.tempPath);
                            fs.writeFileSync(output, "late conflict");
                            fs.writeFileSync(request.outputPath, "muxed");
                        },
                    },
                ],
            });
            await session.allocateWorkspace();
            session.configureTracks(
                ["video", "audio"].map((id) => ({
                    id,
                    sourcePath: "custom://test",
                    mediaTrack: { id, type: id === "video" ? "video" : "audio" },
                })),
                MPEG_TS_CONTAINER,
            );
            for (const [id, trackId] of ["video", "audio"].entries()) {
                const chunk = path.join(session.getTrackTempPath(trackId), "chunk");
                fs.writeFileSync(chunk, trackId);
                session.markTaskReady(
                    {
                        id,
                        trackId,
                        trackIndex: 0,
                        filename: "chunk",
                        item: {
                            kind: "media",
                            url: "custom://test",
                            duration: 1,
                        },
                    },
                    chunk,
                );
            }
            await session.finalize(
                new Map([
                    ["video", 1],
                    ["audio", 1],
                ]),
            );
            expect(fs.readFileSync(output, "utf8")).toBe("late conflict");
            expect(session.getOutputPaths()).toEqual([path.join(directory, "media_1.ts")]);
            expect(fs.readFileSync(session.getOutputPaths()[0], "utf8")).toBe("muxed");
            session.cleanupEmptyWorkspace();
            expect(fs.existsSync(session.tempPath)).toBe(false);
        });
    });
});
