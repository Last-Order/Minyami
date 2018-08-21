#!/usr/bin/env node
import Erii from 'erii';
import ArchiveDownloader from './core/archive';
import Log from './utils/log';
import LiveDownloader from './core/live';
import { exec } from './utils/system';
const fs = require('fs');
const path = require('path');

// Check dependencies
exec('mkvmerge --version').catch(e => {
    Log.error('Missing dependence: mkvmerge');
});

exec('openssl version').catch(e => {
    Log.error('Missing dependence: openssl');
});

Erii.setMetaInfo({
    version: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json')).toString())['version'],
    name: 'Minyami / A lovely video downloader'
});

Erii.bind({
    name: ['help', 'h'],
    description: 'Show help documentation',
    argument: {
        name: 'command',
        description: 'Show help of a specified command',
    }
}, (ctx) => {
    ctx.showHelp();
});

Erii.bind({
    name: ['version'],
    description: 'Show version'
}, (ctx) => {
    ctx.showVersion();
})

Erii.bind({
    name: ['download', 'd'],
    description: 'Download video',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path',
    }
}, async (ctx, options) => {
    const path = ctx.getArgument().toString();
    if (options.live) {
        const downloader = new LiveDownloader(path, options);
        await downloader.download();
    } else {
        const downloader = new ArchiveDownloader(path, options);
        await downloader.init();
        await downloader.download();
    }
});

Erii.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});

Erii.addOption({
    name: ['threads'],
    command: 'download',
    description: 'Threads limit',
    argument: {
        name: 'limit',
        description: '(Optional) Limit of threads, default to 5',
        validate: 'isInt'
    }
});

Erii.addOption({
    name: ['output', 'o'],
    command: 'download',
    description: 'Output path',
    argument: {
        name: 'path',
        description: '(Optional) Output file path, default to ./output.mkv',
        validate: (path: string, logger) => {
            if (!path.endsWith('.mkv') && !path.endsWith('.ts')) {
                logger('Output filename must ends with .mkv or .ts.');
            }
            return !(!path.endsWith('.mkv') && !path.endsWith('.ts'));
        }
    },
});

Erii.addOption({
    name: ['key'],
    command: 'download',
    description: 'Set key manually',
    argument: {
        name: 'key',
        description: '(Optional) Key for decrypt video.'
    }
});

Erii.addOption({
    name: ['live'],
    command: 'download',
    description: 'Download live'
});

Erii.addOption({
    name: ['nomux'],
    command: 'download',
    description: 'Merge chunks without remuxing'
})

Erii.default(() => {
    Erii.showHelp();
})

Erii.start();