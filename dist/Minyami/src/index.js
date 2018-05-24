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
const index_1 = require("../../erii/src/index");
const downloader_1 = require("./core/downloader");
index_1.default.setMetaInfo({
    version: '1.0.0',
    name: 'Minyami / A lovely video downloader'
});
index_1.default.bind({
    name: ['help', 'h'],
    description: 'Show help documentation',
    argument: {
        name: 'command',
        description: 'query help of a specified command',
    }
}, (ctx) => {
    console.log(index_1.default.parsedArguments);
    //ctx.showHelp();
});
index_1.default.bind({
    name: ['download', 'd'],
    description: 'Download video',
    argument: {
        name: 'input_path',
        description: 'm3u8 file path',
    }
}, (ctx, options) => __awaiter(this, void 0, void 0, function* () {
    const path = ctx.getArgument();
    console.log(index_1.default.parsedArguments);
    const downloader = new downloader_1.default(path);
    yield downloader.init();
}));
index_1.default.addOption({
    name: ['verbose', 'debug'],
    description: 'Debug output'
});
index_1.default.start();
//# sourceMappingURL=index.js.map