import chalk from "chalk";

class ConsoleLogger {
    private isDebugMode = false;
    debug(message: string) {
        this.isDebugMode && console.debug(chalk.gray(`[MINYAMI][DEBUG] ${message}`));
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
        console.info(chalk.red(`[MINYAMI][ERROR] ${message}`));
    }

    enableDebugMode() {
        this.isDebugMode = true;
    }

    setDebugMode(enabled: boolean): void {
        this.isDebugMode = enabled;
    }

    isDebugEnabled(): boolean {
        return this.isDebugMode;
    }
}

export default new ConsoleLogger();
