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
const fs = require('fs');
const path = require('path');
// Check dependencies
system_1.exec('mkvmerge --version').catch(e => {
    log_1.default.error('Missing dependence: mkvmerge');
});
system_1.exec('openssl --version').catch(e => {
    log_1.default.error('Missing dependence: openssl');
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
        description: 'query help of a specified command',
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
        description: '(Optional) Limit of threads, default to 5',
        validate: 'isInt'
    }
});
erii_1.default.addOption({
    name: ['output', 'o'],
    command: 'download',
    description: 'Output path',
    argument: {
        name: 'path',
        description: '(Optional) Output file path, default to ./output.mkv',
        validate: (path, logger) => {
            if (!path.endsWith('.mkv')) {
                logger('Output filename must ends with .mkv.');
            }
            return path.endsWith('.mkv');
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
erii_1.default.default(() => {
    erii_1.default.showHelp();
});
erii_1.default.start();
//# sourceMappingURL=index.js.map