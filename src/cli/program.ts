import * as path from "path";
import type { Erii } from "erii";
import { timeStringToSeconds } from "../utils/time";
import type { CliOptions } from "./arguments";
import type { MinyamiCliSchema } from "./schema";

/** Share the production command definitions with parser tests without starting a download. */
export function configureCli(
    Erii: Erii<MinyamiCliSchema>,
    download: (sourcePath: string, options: CliOptions) => Promise<void>,
): void {
    Erii.bind(
        {
            name: ["help", "h"],
            description: "Show help documentation",
            argument: {
                name: "command",
                description: "Show help of a specified command",
            },
        },
        (ctx) => {
            ctx.showHelp();
        },
    );

    Erii.bind(
        {
            name: ["version"],
            description: "Show version",
        },
        (ctx) => {
            ctx.showVersion();
        },
    );

    Erii.bind(
        {
            name: ["download", "d"],
            description: "Download video",
            argument: {
                name: "input_path",
                description: "m3u8 file path",
            },
        },
        async (ctx, options) => {
            const input = ctx.getArgument();
            // Bare command flags parse as booleans; neither they nor missing values identify an input.
            if (input === undefined || typeof input === "boolean") {
                console.error("A download URL or local playlist path is required.");
                ctx.showHelp();
                return;
            }
            await download(input.toString(), options);
        },
    );

    Erii.addOption({
        name: ["verbose", "debug"],
        description: "Debug output",
    });

    Erii.addOption({
        name: ["threads"],
        command: "download",
        description: "Threads limit",
        argument: {
            name: "limit",
            description: "(Optional) Limit of threads, defaults to 5",
            validate: "isInt",
        },
    });

    Erii.addOption({
        name: ["retries"],
        command: "download",
        description: "Maximum attempts for source requests and download tasks",
        argument: {
            name: "limit",
            description: "(Optional) Attempt count for both retry policies, defaults to 5",
            validate: "isInt",
        },
    });

    Erii.addOption({
        name: ["output", "o"],
        command: "download",
        description: "Output basename",
        argument: {
            name: "path",
            description: "(Optional) Output basename, defaults to ./output",
            validate: (outputPath, validateLogger) => {
                if (typeof outputPath !== "string") {
                    validateLogger("Output basename must be a string.");
                    return false;
                }
                if (path.basename(outputPath).match(/[\*\:|\?<>]/)) {
                    validateLogger("Filename should't contain :, |, <, >.");
                    return false;
                }
                return true;
            },
        },
    });

    Erii.addOption({
        name: ["temp-dir"],
        command: "download",
        description: "Temporary file path",
        argument: {
            name: "path",
            description: "(Optional) Temporary file path, defaults to the current working directory",
        },
    });

    Erii.addOption({
        name: ["key"],
        command: "download",
        description: "Set an explicit HLS decryption key",
        argument: {
            name: "key | kid:key",
            description: "Repeat --key in HLS key-URI order; use kid:key for multiple fMP4 SAMPLE-AES keys.",
        },
    });

    Erii.addOption({
        name: ["cookies"],
        command: "download",
        description: "Cookies used to download",
        argument: {
            name: "cookies",
            description: "",
        },
    });

    Erii.addOption({
        name: ["headers", "H"],
        command: "download",
        description: "HTTP Header used to download",
        argument: {
            name: "headers",
            description: 'Custom header. eg. "User-Agent: xxxxx". This option will override --cookies.',
        },
    });

    Erii.addOption({
        name: ["live"],
        command: "download",
        description: "Download live",
    });

    Erii.addOption({
        name: ["proxy"],
        command: "download",
        description: "Use the specified HTTP/HTTPS/SOCKS5 proxy",
        argument: {
            name: "proxy-server",
            description: 'Set proxy in [protocol://<host>:<port>] format. eg. --proxy "http://127.0.0.1:1080".',
        },
    });

    Erii.addOption({
        name: ["no-proxy"],
        command: "download",
        description: "Disable reading proxy configuration from system environment variables or system settings.",
    });

    Erii.addOption({
        name: ["slice"],
        command: "download",
        description: "Download specified part of the stream",
        argument: {
            name: "range",
            description: 'Set time range in [<hh:mm:ss>-<hh:mm:ss> format]. eg. --slice "45:00-53:00"',
            validate: (timeString, logger) => {
                if (typeof timeString !== "string" || !timeString.includes("-")) {
                    logger(`Invalid time range`);
                    return false;
                }
                try {
                    const start = timeString.split("-")[0];
                    const end = timeString.split("-")[1];
                    timeStringToSeconds(start);
                    timeStringToSeconds(end);
                    return true;
                } catch (e) {
                    logger(`Invalid time range`);
                    return false;
                }
            },
        },
    });

    Erii.addOption({
        name: ["no-merge"],
        command: "download",
        description: "Do not merge m3u8 chunks.",
    });

    Erii.addOption({
        name: ["keep", "k"],
        command: "download",
        description: "Keep temporary files.",
    });

    Erii.addOption({
        name: ["keep-encrypted-chunks"],
        command: "download",
        description: "Do not delete encrypted chunks after decryption.",
    });

    Erii.default(() => {
        Erii.showHelp();
    });
}
