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
}, (ctx) => {
    ctx.showHelp();
})

Erii.bind({
    name: ['download', 'd'],
    description: 'Download video',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path',
        validate: () => true
    }
}, (ctx) => {
    const path = ctx.getArgument('download');
    const downloader = new Downloader(path);
});

Erii.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});

Erii.start();