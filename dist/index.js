#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const erii_1 = require("erii");
const downloader_1 = require("./core/downloader");
erii_1.default.setMetaInfo({
    version: '1.0.0',
    name: 'Minyami / A lovely video downloader'
});
erii_1.default.bind({
    name: ['help', 'h'],
    description: 'Show help documentation',
}, (ctx) => {
    ctx.showHelp();
});
erii_1.default.bind({
    name: ['download', 'd'],
    description: 'Download video',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path',
        validate: () => true
    }
}, (ctx) => {
    const path = ctx.getArgument('download');
    const downloader = new downloader_1.default(path);
});
erii_1.default.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});
erii_1.default.start();
//# sourceMappingURL=index.js.map