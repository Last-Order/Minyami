#!/usr/bin/env node
import Erii from 'erii';
import Downloader from './core/downloader';
import Log from './utils/log';

Erii.setMetaInfo({
    version: '1.0.0',
    name: 'Minyami / A lovely video downloader'
});
Erii.bind({
    name: ['help', 'h'],
    description: 'Show help documentation',
    argument: {
        name: 'command',
        description: 'query help of a specified command',
    }
}, (ctx) => {
    ctx.showHelp();
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
    const downloader = new Downloader(path, options);
    await downloader.init();
    await downloader.download();
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
        validate: (path: string) => path.endsWith('.mkv')
    },
})

Erii.always(() => {
    if (Erii.parsedArguments['_'].length === 0 && Object.keys(Erii.parsedArguments).length === 1) {
        Erii.showHelp();
    }
})

Erii.start();