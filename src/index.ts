#!/usr/bin/env node
import Erii from 'erii';
import ArchiveDownloader from './core/archive';
import Log from './utils/log';
import LiveDownloader from './core/live';
import { exec } from './utils/system';
const fs = require('fs');
const path = require('path');
process.on('unhandledRejection', error => {
    console.log(error);
  });
// Check dependencies
exec('mkvmerge --version').then(() => {
    exec('openssl version').then(() => {
        Erii.start();
    }).catch(e => {
        Log.error('Missing dependence: openssl');
    });
}).catch(e => {
    Log.error('Missing dependence: mkvmerge');
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

Erii.bind({
    name: ['resume', 'r'],
    description: 'Resume a download. (Archive)',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path'
    }
}, async (ctx, options) => {
    const path = ctx.getArgument().toString();
    const downloader = new ArchiveDownloader();
    downloader.resume(path);
})

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
        description: '(Optional) Limit of threads, defaults to 5',
        validate: 'isInt'
    }
});

Erii.addOption({
    name: ['retries'],
    command: 'download',
    description: 'Retry limit',
    argument: {
        name: 'limit',
        description: '(Optional) Limit of retry times',
        validate: 'isInt'
    }
})

Erii.addOption({
    name: ['output', 'o'],
    command: 'download',
    description: 'Output path',
    argument: {
        name: 'path',
        description: '(Optional) Output file path, defaults to ./output.mkv',
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
});

Erii.addOption({
    name: ['proxy'],
    command: 'download',
    description: 'Download via Socks proxy',
    argument: {
        name: 'socks-proxy',
        description: 'Set Socks Proxy in [<host>:<port>] format. eg. --proxy "127.0.0.1:1080".'
    }
})

Erii.default(() => {
    Erii.showHelp();
});