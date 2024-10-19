#!/usr/bin/env node
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Erii from "erii";
import ArchiveDownloader from "./core/archive";
import LiveDownloader from "./core/live";
import { exec, forceDeleteDirectory, readConfigFile } from "./utils/system";
import logger from "./utils/log";
import { timeStringToSeconds } from "./utils/time";
import ProxyAgent from "./utils/agent";

Erii.setMetaInfo({
    version:
        JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json")).toString())["version"] +
        "\nうめにゃん~ (虎>ω<)",
    name: "Minyami / A lovely video downloader",
});

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
    }
);

Erii.bind(
    {
        name: ["version"],
        description: "Show version",
    },
    (ctx) => {
        ctx.showVersion();
    }
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
        const path = ctx.getArgument().toString();
        if (options.verbose) {
            logger.setDebugMode(true);
        }
        if (!options.noProxy && !process.env.NO_PROXY) {
            if (process.platform === "win32") {
                await ProxyAgent.readWindowsSystemProxy();
            }
            ProxyAgent.readProxyConfigurationFromEnv();
        }
        const fileOptions = readConfigFile();
        if (Object.keys(fileOptions).length > 0) {
            logger.debug(`Read config file: ${JSON.stringify(fileOptions)}`);
        }
        for (const key of Object.keys(fileOptions)) {
            if (options[key] === undefined) {
                options[key] = fileOptions[key];
            }
        }
        const finalOptions = Object.assign(options, { cliMode: true, logger });
        if (options.live) {
            const downloader = new LiveDownloader(path, finalOptions);
            downloader.on("finished", () => {
                process.exit();
            });
            downloader.on("critical-error", () => {
                process.exit(1);
            });
            await downloader.download();
        } else {
            const downloader = new ArchiveDownloader(path, finalOptions);
            downloader.on("finished", () => {
                process.exit();
            });
            downloader.on("critical-error", () => {
                process.exit(1);
            });
            await downloader.init();
            await downloader.download();
        }
    }
);

Erii.bind(
    {
        name: ["resume", "r"],
        description: "Resume a download. (Archive)",
        argument: {
            name: "input_path",
            description: "m3u8 file path",
        },
    },
    async (ctx, options) => {
        const path = ctx.getArgument().toString();
        const downloader = new ArchiveDownloader(undefined, {
            cliMode: true,
        });
        downloader.on("finished", () => {
            process.exit();
        });
        downloader.on("critical-error", () => {
            process.exit(1);
        });
        downloader.resume(path);
    }
);

Erii.bind(
    {
        name: ["clean"],
        description: "Clean cache files",
    },
    (ctx, options) => {
        if (options.verbose) {
            logger.setDebugMode(true);
        }
        const fileOptions = readConfigFile();
        if (Object.keys(fileOptions).length > 0) {
            logger.debug(`Read config file: ${JSON.stringify(fileOptions)}`);
        }
        for (const file of fs.readdirSync(path.resolve(fileOptions.tempDir || os.tmpdir()))) {
            if (file.startsWith("minyami_")) {
                forceDeleteDirectory(path.resolve(os.tmpdir(), `./${file}`));
            }
        }
        fs.writeFileSync(path.resolve(__dirname, "../tasks.json"), "[]");
    }
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
    description: "Retry limit",
    argument: {
        name: "limit",
        description: "(Optional) Limit of retry times",
        validate: "isInt",
    },
});

Erii.addOption({
    name: ["output", "o"],
    command: "download",
    description: "Output path",
    argument: {
        name: "path",
        description: "(Optional) Output file path, defaults to ./output.mkv",
        validate: (outputPath: string, validateLogger) => {
            if (!outputPath.endsWith(".mkv") && !outputPath.endsWith(".ts")) {
                validateLogger("Output filename must ends with .mkv or .ts.");
                return false;
            }
            if (outputPath.endsWith("mkv")) {
                exec("mkvmerge --version")
                    .then(() => {
                        //
                    })
                    .catch((e) => {
                        logger.error("Missing dependence: mkvmerge");
                    });
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
        description: "(Optional) Temporary file path, defaults to env.TEMP",
    },
});

Erii.addOption({
    name: ["key"],
    command: "download",
    description: "Set key manually (Internal use)",
    argument: {
        name: "key",
        description: "(Optional) Key for decrypt video.",
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
    name: ["format"],
    command: "download",
    description: "(Optional) Set output format. default: ts",
    argument: {
        name: "format_name",
        description: "Format name. ts or mkv.",
        validate: (formatString: string) => {
            return ["mkv", "ts"].includes(formatString);
        },
    },
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
        validate: (timeString: string, logger) => {
            if (!timeString.includes("-")) {
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

Erii.addOption({
    name: ["chunk-naming-strategy"],
    command: "download",
    description: "Temporary file naming strategy. Defaults to 1.",
});

Erii.default(() => {
    Erii.showHelp();
});

Erii.okite();
