import chalk from "chalk"

class ConsoleLogger {
    private isDebugMode = false;
    debug(message: string) {
        this.isDebugMode && console.debug(chalk.gray(`[MINYAMI][DEBUG] ${message}`));
    }

    info(message: string, infoObj: any = undefined) {
        console.info(chalk.white(`[MINYAMI][INFO] ${message}`));
    }

    warning(message: string) {
        console.warn(chalk.yellow(`[MINYAMI][WARN] ${message}`));
    }

    error(message: string, error: any = undefined) {
        if (error !== undefined) console.log(error);
        console.info(chalk.red(`[MINYAMI][ERROR] ${message}`));
        process.exit();
    }

    enableDebugMode() {
        this.isDebugMode = true;
    }
}

export default new ConsoleLogger();