import chalk from 'chalk';
abstract class Logger {
    public abstract debug(message: string);
    public abstract info(message: string, infoObj?: any);
    public abstract warning(message: string);
    public abstract error(message: string, error?: any);
}



export class ConsoleLogger extends Logger {
    debug(message: string) {
        console.debug(chalk.gray(`[MINYAMI][DEBUG] ${message}`));
    }

    info(message: string, infoObj: any = undefined) {
        console.info(chalk.white(`[MINYAMI][INFO] ${message}`));
    }

    warning(message: string) {
        console.warn(chalk.yellow(`[MINYAMI][WARN] ${message}`));
    }

    error(message: string, error: any = undefined) {
        if(error!==undefined) console.log(error);
        console.info(chalk.red(`[MINYAMI][ERROR] ${message}`));
        process.exit();
    }
}

export default Logger;