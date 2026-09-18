import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/log";

/** Publish without overwrite, including when another session wins a filename after the conflict check. */
export async function publishOutput(source: string, requestedPath: string): Promise<string> {
    const parsed = path.parse(requestedPath);
    let destination = requestedPath;
    let suffix = 0;
    for (;;) {
        try {
            // Hard links provide an atomic, exclusive move on the same filesystem. Copy exclusively across devices.
            try {
                await fs.promises.link(source, destination);
            } catch (error) {
                if (!["EXDEV", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
                    throw error;
                }
                await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
            }
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                throw error;
            }
            destination = path.join(parsed.dir, `${parsed.name}_${++suffix}${parsed.ext}`);
        }
    }
    // A complete destination is already published; cleanup failure must not invalidate it.
    await fs.promises.unlink(source).catch(() => logger.warning(`Failed to delete staged output [${source}].`));
    return destination;
}
