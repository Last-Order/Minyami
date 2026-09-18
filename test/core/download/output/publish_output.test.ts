import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { publishOutput } from "@/core/download/output/publish_output";
import { withTempDirectory } from "../../../helpers/filesystem";

afterEach(() => jest.restoreAllMocks());

describe("output publication", () => {
    test("concurrent publications preserve existing files and each completed output", async () => {
        await withTempDirectory("minyami-publish-", async (directory) => {
            const destination = path.join(directory, "media.ts");
            fs.writeFileSync(destination, "existing");
            fs.writeFileSync(path.join(directory, "media_1.ts"), "existing suffix");
            const sources = ["first", "second"].map((content) => {
                const source = path.join(directory, content);
                fs.writeFileSync(source, content);
                return source;
            });
            const results = await Promise.all(sources.map((source) => publishOutput(source, destination)));
            expect(new Set(results).size).toBe(2);
            expect(results.map((file) => fs.readFileSync(file, "utf8"))).toEqual(["first", "second"]);
            expect(fs.readFileSync(destination, "utf8")).toBe("existing");
            expect(fs.readFileSync(path.join(directory, "media_1.ts"), "utf8")).toBe("existing suffix");
            expect(sources.some((source) => fs.existsSync(source))).toBe(false);
        });
    });

    test("copies exclusively across filesystems before removing the staged file", async () => {
        await withTempDirectory("minyami-publish-copy-", async (directory) => {
            jest.spyOn(fs.promises, "link").mockRejectedValue(
                Object.assign(new Error("cross device"), { code: "EXDEV" }),
            );
            const source = path.join(directory, "staged");
            const destination = path.join(directory, "media.ts");
            fs.writeFileSync(source, "complete");
            fs.writeFileSync(destination, "existing");
            const result = await publishOutput(source, destination);
            expect(fs.readFileSync(result, "utf8")).toBe("complete");
            expect(fs.readFileSync(destination, "utf8")).toBe("existing");
            expect(fs.existsSync(source)).toBe(false);
        });
    });

    test("preserves the staged file when publication fails", async () => {
        await withTempDirectory("minyami-publish-failure-", async (directory) => {
            const source = path.join(directory, "staged");
            fs.writeFileSync(source, "recoverable");
            await expect(publishOutput(source, path.join(directory, "missing", "media.ts"))).rejects.toThrow();
            expect(fs.readFileSync(source, "utf8")).toBe("recoverable");
        });
    });
});
