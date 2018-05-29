import chalk from 'chalk';
class Log {
    static debug(message: string) {
        console.debug(chalk.gray(`[MINYAMI][DEBUG] ${message}`));
    }

    static info(message: string) {
        console.info(chalk.blue(`[MINYAMI][INFO] ${message}`));
    }

    static error(message: string) {
        console.info(chalk.red(`[MINYAMI][ERROR] ${message}`));
        process.exit();
    }
}

export default Log;