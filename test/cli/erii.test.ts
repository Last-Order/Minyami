import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Erii, type TypedCommandHandler } from "erii";
import type { MinyamiCliSchema } from "@/cli/schema";

interface TestCliSchema extends MinyamiCliSchema {
    commands: MinyamiCliSchema["commands"] & { other: {} };
}

// Keep parsing real; only terminal rendering needs a stub for clui's legacy octal escapes in Jest.
jest.mock("clui", () => ({}));

/** Dependency contracts: changes here require reviewing CLI compatibility before upgrading Erii. */
describe("Erii compatibility contracts", () => {
    const originalArgv = process.argv;
    const handler = jest.fn<TypedCommandHandler<TestCliSchema, "download">>();
    const otherHandler = jest.fn<TypedCommandHandler<TestCliSchema, "other">>();
    const fallback = jest.fn<() => void>();

    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        process.argv = originalArgv;
    });

    function create(args: string[]) {
        process.argv = [originalArgv[0], "minyami", ...args];
        const cli = new Erii<TestCliSchema>();
        cli.bind({ name: ["download", "d"], argument: { name: "input", description: "" } }, handler);
        cli.bind({ name: "other" }, otherHandler);
        cli.addOption({ name: ["verbose", "debug"] });
        cli.default(fallback);
        return cli;
    }

    function options() {
        expect(handler).toHaveBeenCalledTimes(1);
        return handler.mock.calls[0][1];
    }

    test("captures argv at construction, before commands and options are registered", () => {
        const cli = create(["-d", "original.m3u8", "--threads", "8"]);
        cli.addOption({
            command: "download",
            name: "threads",
            argument: { name: "count", description: "", validate: "isInt" },
        });
        process.argv = [originalArgv[0], "minyami", "-d", "replacement.m3u8", "--threads", "2"];
        cli.okite();
        expect(options().threads).toBe(8);
        expect(handler.mock.calls[0][0].getArgument()).toBe("original.m3u8");
    });

    test.each(["--download", "-d"])("resolves %s arguments through canonical and alias context names", (command) => {
        create([command, "./my video.m3u8"]).okite();
        options();
        const context = handler.mock.calls[0][0];
        expect(context.getArgument()).toBe("./my video.m3u8");
        expect(context.getArgument("download")).toBe("./my video.m3u8");
        expect(context.getArgument("d")).toBe("./my video.m3u8");
    });

    test("does not manufacture values for omitted options, allowing config-file defaults", () => {
        const cli = create(["-d", "video.m3u8"]);
        cli.addOption({
            command: "download",
            name: "threads",
            argument: { name: "count", description: "", validate: "isInt" },
        });
        cli.addOption({ command: "download", name: "live" });
        cli.okite();
        const result = options();
        expect(Object.entries(result)).toEqual([]);
        expect(result.threads).toBeUndefined();
        expect(result.live).toBeUndefined();
        expect(result.verbose).toBeUndefined();
    });

    test("filters unregistered options and keeps global options available to other commands", () => {
        const cli = create(["--other", "--live", "--debug", "--unknown", "value"]);
        cli.addOption({ command: "download", name: "live" });
        cli.okite();
        expect(handler).not.toHaveBeenCalled();
        expect(otherHandler).toHaveBeenCalledTimes(1);
        expect({ ...otherHandler.mock.calls[0][1] }).toEqual({ verbose: true });
    });

    test("canonicalizes option aliases without publishing duplicate alias keys", () => {
        const cli = create(["-d", "video.m3u8", "-o", "my output", "--debug"]);
        cli.addOption({ command: "download", name: ["output", "o"], argument: { name: "path", description: "" } });
        cli.okite();
        expect({ ...options() }).toEqual({ output: "my output", verbose: true });
    });

    test("exposes kebab-case flags through camel-case access without boolean negation", () => {
        const cli = create(["-d", "video.m3u8", "--no-proxy", "--no-merge", "--keep-encrypted-chunks"]);
        for (const option of [
            { command: "download", name: "no-proxy" },
            { command: "download", name: "no-merge" },
            { command: "download", name: "keep-encrypted-chunks" },
        ] as const) {
            cli.addOption(option);
        }
        cli.okite();
        const result = options();
        expect(result.noProxy).toBe(true);
        expect(result.noMerge).toBe(true);
        expect(result.keepEncryptedChunks).toBe(true);
        expect(result.proxy).toBeUndefined();
        expect(Reflect.get(result, "merge")).toBeUndefined();
        // Erii's camel-case access is a proxy; enumeration still exposes the original option names.
        expect(Object.entries(result)).toEqual([
            ["no-proxy", true],
            ["no-merge", true],
            ["keep-encrypted-chunks", true],
        ]);
    });

    test.each([
        { command: "download", name: "headers", argument: { name: "value", description: "" } },
        { command: "download", name: "key", argument: { name: "value", description: "" } },
    ] as const)("keeps a single --$name value scalar and repeated values ordered", (option) => {
        const { name } = option;
        let cli = create(["-d", "video.m3u8", `--${name}`, "first:value"]);
        cli.addOption(option);
        cli.okite();
        expect(options()[name]).toBe("first:value");
        handler.mockClear();
        cli = create(["-d", "video.m3u8", `--${name}`, "first:value", `--${name}`, "second:value"]);
        cli.addOption(option);
        cli.okite();
        expect(options()[name]).toEqual(["first:value", "second:value"]);
    });

    test("converts numeric tokens to numbers before custom validation", () => {
        const validate = jest.fn<(value: unknown, logger: (message: string) => void) => boolean>(() => true);
        const cli = create(["-d", "video.m3u8", "--threads", "8"]);
        cli.addOption({ command: "download", name: "threads", argument: { name: "count", description: "", validate } });
        cli.okite();
        expect(validate).toHaveBeenCalledWith(8, expect.any(Function));
        expect(options().threads).toBe(8);
    });

    test.each(["8", "0", "-1"])("accepts integer token %s without imposing downloader limits", (value) => {
        const cli = create(["-d", "video.m3u8", "--threads", value]);
        cli.addOption({
            command: "download",
            name: "threads",
            argument: { name: "count", description: "", validate: "isInt" },
        });
        cli.okite();
        expect(options().threads).toBe(Number(value));
        expect(console.error).not.toHaveBeenCalled();
    });

    test("omits rejected options but still dispatches once with valid options", () => {
        const validate = jest.fn<(value: unknown, logger: (message: string) => void) => boolean>(() => false);
        const cli = create(["-d", "video.m3u8", "--output", "bad?name", "--threads", "1.5", "--debug"]);
        cli.addOption({ command: "download", name: "output", argument: { name: "path", description: "", validate } });
        cli.addOption({
            command: "download",
            name: "threads",
            argument: { name: "count", description: "", validate: "isInt" },
        });
        cli.okite();
        expect(validate).toHaveBeenCalledWith("bad?name", expect.any(Function));
        expect({ ...options() }).toEqual({ verbose: true });
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("option 'output'"));
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("option 'threads'"));
    });

    test("runs the fallback only for empty argv", () => {
        create([]).okite();
        expect(fallback).toHaveBeenCalledTimes(1);
        expect(handler).not.toHaveBeenCalled();
        create(["-d", "video.m3u8"]).okite();
        expect(fallback).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
