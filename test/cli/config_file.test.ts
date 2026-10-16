import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import { readConfigFile } from "@/cli/config_file";
import { withTempDirectory } from "../helpers/filesystem";

function configureHome(directory: string): string {
    jest.spyOn(require("os") as typeof os, "homedir").mockReturnValue(directory);
    const configDirectory = path.join(directory, ".minyami");
    fs.mkdirSync(configDirectory);
    return configDirectory;
}

describe("CLI configuration files", () => {
    test.each([".minyamirc", ".minyamirc.json", "minyami.config.json"])("loads defaults from %s", async (filename) => {
        await withTempDirectory("minyami-config-", async (directory) => {
            const configDirectory = configureHome(directory);
            const options = { noProxy: true, verbose: true, threads: 8 };
            fs.writeFileSync(path.join(configDirectory, filename), JSON.stringify(options));

            expect(readConfigFile()).toEqual(options);
        });
    });

    test("returns no defaults when no configuration file exists", async () => {
        await withTempDirectory("minyami-config-missing-", async (directory) => {
            configureHome(directory);
            expect(readConfigFile()).toEqual({});
        });
    });

    test.each(["{broken", "null", "[]", "true"])(
        "ignores an unusable config and continues to later candidates: %s",
        async (content) => {
            await withTempDirectory("minyami-config-invalid-", async (directory) => {
                const configDirectory = configureHome(directory);
                const invalidPath = path.join(configDirectory, ".minyamirc");
                fs.writeFileSync(invalidPath, content);
                expect(readConfigFile()).toEqual({});

                fs.writeFileSync(path.join(configDirectory, "minyami.config.json"), JSON.stringify({ threads: 10 }));
                expect(readConfigFile()).toEqual({ threads: 10 });
            });
        },
    );

    test.each([false, true])("ignores a file read failure with fallback config present: %s", async (hasFallback) => {
        await withTempDirectory("minyami-config-unreadable-", async (directory) => {
            const configDirectory = configureHome(directory);
            fs.writeFileSync(path.join(configDirectory, ".minyamirc"), JSON.stringify({ threads: 8 }));
            if (hasFallback) {
                fs.writeFileSync(path.join(configDirectory, "minyami.config.json"), JSON.stringify({ threads: 10 }));
            }
            jest.spyOn(require("fs") as typeof fs, "readFileSync").mockImplementationOnce(() => {
                throw Object.assign(new Error("Access denied"), { code: "EACCES" });
            });

            expect(readConfigFile()).toEqual(hasFallback ? { threads: 10 } : {});
        });
    });

    test("returns no defaults when the configuration directory cannot be created", async () => {
        await withTempDirectory("minyami-config-directory-", async (directory) => {
            jest.spyOn(require("os") as typeof os, "homedir").mockReturnValue(directory);
            jest.spyOn(require("fs") as typeof fs, "mkdirSync").mockImplementationOnce(() => {
                throw Object.assign(new Error("Access denied"), { code: "EACCES" });
            });

            expect(readConfigFile()).toEqual({});
        });
    });
});
