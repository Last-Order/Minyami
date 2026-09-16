#!/usr/bin/env node
import * as fs from "fs";
import { Erii } from "erii";
import { normalizeCliArguments } from "./cli/arguments";
import { runDownloadCommand } from "./cli/download_command";
import { configureCli } from "./cli/program";
import type { MinyamiCliSchema } from "./cli/schema";

process.argv = [...process.argv.slice(0, 2), ...normalizeCliArguments(process.argv.slice(2))];
const cli = new Erii<MinyamiCliSchema>();

cli.setMetaInfo({
    version:
        JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)).toString())["version"] +
        "\nうめにゃん~ (虎>ω<)",
    name: "Minyami / A lovely video downloader",
});

configureCli(cli, runDownloadCommand);

cli.okite();
