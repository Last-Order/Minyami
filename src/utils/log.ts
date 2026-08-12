import chalk from "chalk";

class ConsoleLogger {
    private isDebugMode = false;
    debug(message: unknown) {
        this.isDebugMode && console.debug(chalk.gray(`[MINYAMI][DEBUG] ${String(message)}`));
    }

    info(message: string) {
        console.info(chalk.white(`[MINYAMI][INFO] ${message}`));
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
}

export default new ConsoleLogger();
