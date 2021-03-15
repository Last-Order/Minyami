#!/usr/bin/env node
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Erii from "erii";
import ArchiveDownloader from "./core/archive";
import LiveDownloader from "./core/live";
import { exec, deleteDirectory } from "./utils/system";
import logger from "./utils/log";
import { timeStringToSeconds } from "./utils/time";
import ProxyAgent from "./utils/agent";

process.on("unhandledRejection", (error: Error) => {
    console.error(error.name, error.message, error.stack);
});

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
        ProxyAgent.readProxyConfigurationFromEnv();
        if (options.live) {
            const downloader = new LiveDownloader(path, {
                ...options,
                cliMode: true,
                logger,
            });
            downloader.on("finished", () => {
                process.exit();
            });
            await downloader.download();
        } else {
            const downloader = new ArchiveDownloader(path, {
                ...options,
                cliMode: true,
                logger,
            });
            downloader.on("finished", () => {
                process.exit();
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
        downloader.resume(path);
    }
);

Erii.bind(
    {
        name: ["clean"],
        description: "Clean cache files",
    },
    () => {
        for (const file of fs.readdirSync(path.resolve(os.tmpdir()))) {
            if (file.startsWith("minyami_")) {
                deleteDirectory(path.resolve(os.tmpdir(), `./${file}`));
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
    description: "Cookies to download",
    argument: {
        name: "cookies",
        description: "",
    },
});

Erii.addOption({
    name: ["headers"],
    command: "download",
    description: "HTTP Headers used to download",
    argument: {
        name: "headers",
        description:
            'Multiple headers should be splited with \\n. eg. --headers "Cookie: a=1\\nUser-Agent: X-UA". Don\'t forget to escape. This option will override --cookies.',
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
    description: "Download via Socks proxy (Deprecated)",
    argument: {
        name: "proxy-server",
        description: 'Set proxy in [protocol://<host>:<port>] format. eg. --proxy "http://127.0.0.1:1080".',
    },
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
    name: ["nomerge", "keep"],
    command: "download",
    description: "Do not merge m3u8 chunks.",
});

Erii.default(() => {
    Erii.showHelp();
});

Erii.okite();
