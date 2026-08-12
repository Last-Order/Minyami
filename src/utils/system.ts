import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import logger from "./log";

export const initMinyamiDirectory = () => {
    const minyamiPath = path.resolve(os.homedir(), "./.minyami/");
    if (!fs.existsSync(minyamiPath)) {
        fs.mkdirSync(minyamiPath);
    }
    return minyamiPath;
};

export const readConfigFile = () => {
    const minyamiPath = initMinyamiDirectory();
    const availableConfigFilenames = [".minyamirc", ".minyamirc.json", "minyami.config.json"];
    for (const filename of availableConfigFilenames) {
        const configFilePath = path.resolve(minyamiPath, filename);
        if (fs.existsSync(configFilePath)) {
            try {
                const content = JSON.parse(fs.readFileSync(configFilePath).toString());
                logger.debug(`Config file loaded: ${JSON.stringify(content)}`);
                return content;
            } catch {
                logger.debug(`Config file ${configFilePath} not exists or not valid, skip.`);
            }
        }
    }
    return {};
};
