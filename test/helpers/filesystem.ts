import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export async function withTempDirectory<T>(prefix: string, run: (directory: string) => Promise<T>): Promise<T> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return await run(directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
