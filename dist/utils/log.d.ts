declare abstract class Logger {
    private static instance;
    static getInstance(): Logger;
    static setInstance(logger: Logger): void;
    abstract debug(message: string): any;
    abstract info(message: string): any;
    abstract warning(message: string): any;
    abstract error(message: string, error?: any): any;
}
export declare class ConsoleLogger extends Logger {
    debug(message: string): void;
    info(message: string): void;
    warning(message: string): void;
    error(message: string, error?: any): void;
}
export default Logger;
