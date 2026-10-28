import chalk from "chalk";

class ConsoleLogger {
    private isDebugMode = false;
    private progressDisplayCount = 0;

    debug(message: unknown) {
        this.isDebugMode && console.debug(chalk.gray(`[MINYAMI][DEBUG] ${String(message)}`));
    }

    info(message: string) {
        console.info(chalk.white(`[MINYAMI][INFO] ${message}`));
    }

    progress(message: string) {
        if (this.progressDisplayCount === 0) {
            this.info(message);
        }
    }

    warning(message: string) {
        console.warn(chalk.yellow(`[MINYAMI][WARN] ${message}`));
    }

    error(message: string, error?: Error) {
        if (error !== undefined) {
            this.isDebugMode && console.debug(error);
        }
        // Fatal errors must retain a concise cause outside debug mode; only the stack trace is debug-only.
        const reason = error?.message ? ` ${error.message}` : "";
        console.info(chalk.red(`[MINYAMI][ERROR] ${message}${reason}`));
    }

    enableDebugMode() {
        this.isDebugMode = true;
    }

    /** An active CLI display replaces only chunk progress; ordinary logs retain their console routing. */
    suppressProgressLogs(): () => void {
        this.progressDisplayCount++;
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.progressDisplayCount--;
            }
        };
    }
}

export default new ConsoleLogger();
