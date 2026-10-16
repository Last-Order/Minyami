import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function initMinyamiDirectory(): string {
    const minyamiPath = path.resolve(os.homedir(), "./.minyami/");
    if (!fs.existsSync(minyamiPath)) {
        fs.mkdirSync(minyamiPath);
    }
    return minyamiPath;
}

export function readConfigFile(): Record<string, unknown> {
    let minyamiPath: string;
    try {
        minyamiPath = initMinyamiDirectory();
    } catch {
        // Configuration is optional even when its directory cannot be accessed or created.
        return {};
    }
    const availableConfigFilenames = [".minyamirc", ".minyamirc.json", "minyami.config.json"];
    for (const filename of availableConfigFilenames) {
        const configFilePath = path.resolve(minyamiPath, filename);
        if (fs.existsSync(configFilePath)) {
            try {
                const content: unknown = JSON.parse(fs.readFileSync(configFilePath).toString());
                if (typeof content !== "object" || content === null || Array.isArray(content)) {
                    throw new Error("Configuration root must be an object.");
                }
                return content as Record<string, unknown>;
            } catch {
                // Unreadable or malformed candidates behave like missing files; later defaults may still be usable.
            }
        }
    }
    return {};
}
