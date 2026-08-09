#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import Erii from "erii";
import { createArchiveDownloader } from "./core/archive";
import { createLiveDownloader } from "./core/live";
import { selectStreamInteractively } from "./core/source/stream_selector";
import { readConfigFile } from "./utils/system";
import logger from "./utils/log";
import { timeStringToSeconds } from "./utils/time";
import ProxyAgentHelper from "./utils/agent";

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
            logger.enableDebugMode();
        }

        const disableProxy = options.noProxy || process.env.NO_PROXY;

        if (!disableProxy) {
            if (process.platform === "win32") {
                await ProxyAgentHelper.readWindowsSystemProxy();
            }
            ProxyAgentHelper.readProxyConfigurationFromEnv();
        } else {
            ProxyAgentHelper.disableProxy();
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
        const finalOptions = Object.assign(options, {
            cliMode: true,
            logger,
            streamSelector: selectStreamInteractively,
        });
        if (options.live) {
            const downloader = createLiveDownloader(path, finalOptions);
            downloader.on("finished", () => {
                process.exit();
            });
            downloader.on("critical-error", () => {
                process.exit(1);
            });
            await downloader.download();
        } else {
            const downloader = createArchiveDownloader(path, finalOptions);
            downloader.on("finished", () => {
                process.exit();
            });
            downloader.on("critical-error", () => {
                process.exit(1);
            });
            await downloader.download();
        }
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
    description: "Output basename",
    argument: {
        name: "path",
        description: "(Optional) Output basename, defaults to ./output",
        validate: (outputPath: string, validateLogger) => {
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

Erii.default(() => {
    Erii.showHelp();
});

Erii.okite();
