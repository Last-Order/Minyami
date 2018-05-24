#!/usr/bin/env node
import Erii from 'erii';
import Downloader from './core/downloader';

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
    const downloader = new Downloader(path);
    await downloader.init();
    await downloader.download();
});

Erii.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});

Erii.addOption({
    name: ['threads'],
    description: 'Threads limit',
    argument: {
        name: 'limit',
        description: 'Limit of threads',
        validate: 'isInt'
    }
})

Erii.start();