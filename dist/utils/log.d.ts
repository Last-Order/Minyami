declare abstract class Logger {
    abstract debug(message: string): any;
    abstract info(message: string, infoObj?: any): any;
    abstract warning(message: string): any;
    abstract error(message: string, error?: any): any;
}
export declare class ConsoleLogger extends Logger {
    debug(message: string): void;
    info(message: string, infoObj?: any): void;
    warning(message: string): void;
    error(message: string, error?: any): void;
}
export default Logger;
