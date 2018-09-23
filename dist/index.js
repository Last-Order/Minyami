#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const erii_1 = require("erii");
const archive_1 = require("./core/archive");
const log_1 = require("./utils/log");
const live_1 = require("./core/live");
const system_1 = require("./utils/system");
const fs = require("fs");
const time_1 = require("./utils/time");
const path = require('path');
process.on('unhandledRejection', error => {
    console.log(error);
});
// Check dependencies
system_1.exec('mkvmerge --version').then(() => {
    system_1.exec('openssl version').then(() => {
        erii_1.default.start();
    }).catch(e => {
        log_1.default.error('Missing dependence: openssl');
    });
}).catch(e => {
    log_1.default.error('Missing dependence: mkvmerge');
});
erii_1.default.setMetaInfo({
    version: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json')).toString())['version'],
    name: 'Minyami / A lovely video downloader'
});
erii_1.default.bind({
    name: ['help', 'h'],
    description: 'Show help documentation',
    argument: {
        name: 'command',
        description: 'Show help of a specified command',
    }
}, (ctx) => {
    ctx.showHelp();
});
erii_1.default.bind({
    name: ['version'],
    description: 'Show version'
}, (ctx) => {
    ctx.showVersion();
});
erii_1.default.bind({
    name: ['download', 'd'],
    description: 'Download video',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path',
    }
}, (ctx, options) => __awaiter(this, void 0, void 0, function* () {
    const path = ctx.getArgument().toString();
    if (options.live) {
        const downloader = new live_1.default(path, options);
        yield downloader.download();
    }
    else {
        const downloader = new archive_1.default(path, options);
        yield downloader.init();
        yield downloader.download();
    }
}));
erii_1.default.bind({
    name: ['resume', 'r'],
    description: 'Resume a download. (Archive)',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path'
    }
}, (ctx, options) => __awaiter(this, void 0, void 0, function* () {
    const path = ctx.getArgument().toString();
    const downloader = new archive_1.default();
    downloader.resume(path);
}));
erii_1.default.bind({
    name: ['clean'],
    description: 'Clean cache files',
}, () => {
    for (const file of fs.readdirSync('.')) {
        if (file.startsWith('temp_')) {
            system_1.deleteDirectory(file);
        }
    }
    fs.writeFileSync('./tasks.json', '[]');
});
erii_1.default.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});
erii_1.default.addOption({
    name: ['threads'],
    command: 'download',
    description: 'Threads limit',
    argument: {
        name: 'limit',
        description: '(Optional) Limit of threads, defaults to 5',
        validate: 'isInt'
    }
});
erii_1.default.addOption({
    name: ['retries'],
    command: 'download',
    description: 'Retry limit',
    argument: {
        name: 'limit',
        description: '(Optional) Limit of retry times',
        validate: 'isInt'
    }
});
erii_1.default.addOption({
    name: ['output', 'o'],
    command: 'download',
    description: 'Output path',
    argument: {
        name: 'path',
        description: '(Optional) Output file path, defaults to ./output.mkv',
        validate: (path, logger) => {
            if (!path.endsWith('.mkv') && !path.endsWith('.ts')) {
                logger('Output filename must ends with .mkv or .ts.');
            }
            return !(!path.endsWith('.mkv') && !path.endsWith('.ts'));
        }
    },
});
erii_1.default.addOption({
    name: ['key'],
    command: 'download',
    description: 'Set key manually',
    argument: {
        name: 'key',
        description: '(Optional) Key for decrypt video.'
    }
});
erii_1.default.addOption({
    name: ['live'],
    command: 'download',
    description: 'Download live'
});
erii_1.default.addOption({
    name: ['nomux'],
    command: 'download',
    description: 'Merge chunks without remuxing'
});
erii_1.default.addOption({
    name: ['proxy'],
    command: 'download',
    description: 'Download via Socks proxy',
    argument: {
        name: 'socks-proxy',
        description: 'Set Socks Proxy in [<host>:<port>] format. eg. --proxy "127.0.0.1:1080".'
    }
});
erii_1.default.addOption({
    name: ['slice'],
    command: 'download',
    description: 'Download specified part of the stream',
    argument: {
        name: 'range',
        description: 'Set time range in [<hh:mm:ss>-<hh:mm:ss> format]. eg. --slice "45:00-53:00"',
        validate: (timeString, logger) => {
            if (!timeString.includes('-')) {
                logger(`Invalid time range`);
                return false;
            }
            try {
                const start = timeString.split('-')[0];
                const end = timeString.split('-')[1];
                time_1.timeStringToSeconds(start);
                time_1.timeStringToSeconds(end);
                return true;
            }
            catch (e) {
                logger(`Invalid time range`);
                return false;
            }
        }
    }
});
erii_1.default.default(() => {
    erii_1.default.showHelp();
});
//# sourceMappingURL=index.js.map