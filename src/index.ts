#!/usr/bin/env node
import * as fs from "fs";
import { CliOptions, normalizeCliArguments } from "./cli/arguments";
import { runDownloadCommand } from "./cli/download_command";
import { createErii } from "./cli/erii";
import { configureCli } from "./cli/program";

process.argv = [...process.argv.slice(0, 2), ...normalizeCliArguments(process.argv.slice(2))];
const Erii = createErii<CliOptions>();

Erii.setMetaInfo({
    version:
        JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)).toString())["version"] +
        "\nうめにゃん~ (虎>ω<)",
    name: "Minyami / A lovely video downloader",
});

configureCli(Erii, runDownloadCommand);

Erii.okite();
