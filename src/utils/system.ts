const util = require("util");
import * as path from "path";
import * as fs from "fs";
import logger from "./log";

export const exec = util.promisify(require("child_process").exec);

export const sleep = (deley) => new Promise((resolve) => setTimeout(resolve, deley));

export const deleteDirectory = (directoryPath: string, fileList: string[] = []) => {
    for (const filename of fileList) {
        try {
            fs.unlinkSync(path.resolve(directoryPath, filename));
        } catch (e) {
            logger.debug(e);
            logger.warning(`Delete ${path.resolve(directoryPath, filename)} failed, ignored`);
        }
    }
    if (fs.readdirSync(directoryPath).length === 0) {
        fs.rmdirSync(directoryPath);
    }
};

export const forceDeleteDirectory = (directoryPath: string) => {
    const fileList = fs.readdirSync(directoryPath);
    for (const filename of fileList) {
        fs.unlinkSync(path.resolve(directoryPath, filename));
    }
    fs.rmdirSync(directoryPath);
};
