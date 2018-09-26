import chalk from 'chalk';
abstract class Logger {
    private static instance: Logger;

    public static getInstance(): Logger{
        if(!this.instance){
            throw new Error("Please initalize an instance of Logger first.");
        }
        return this.instance;
    }

    public static setInstance(logger: Logger){
        this.instance = logger;
    }


    public abstract debug(message: string);
    public abstract info(message: string);
    public abstract warning(message: string);
    public abstract error(message: string, error?: any);
}



export class ConsoleLogger extends Logger {
    debug(message: string) {
        console.debug(chalk.gray(`[MINYAMI][DEBUG] ${message}`));
    }

    info(message: string) {
        console.info(chalk.white(`[MINYAMI][INFO] ${message}`));
    }

    warning(message: string) {
        console.warn(chalk.yellow(`[MINYAMI][WARN] ${message}`));
    }

    error(message: string, error: any=undefined) {
        if(error!=undefined) console.log(error);
        console.info(chalk.red(`[MINYAMI][ERROR] ${message}`));
        process.exit();
    }
}

export default Logger;