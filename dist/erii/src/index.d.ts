export interface Command {
    name: string | string[];
    description?: string;
    argument?: Argument;
    alias?: string[];
    redirect?: string;
    options?: Option[];
    handler?: (ctx: CommandCtx, options?: object) => any;
}
export interface Option {
    name: string | string[];
    description?: string;
    command?: string;
    argument?: Argument;
}
export interface CommandMap {
    [key: string]: Command;
}
export interface CommandCtx {
    showVersion: () => void;
    showHelp: () => void;
    getArgument: (commandName?: string) => string;
}
export interface Argument {
    name: string;
    description: string;
    validate?: string | ((value: any) => boolean);
}
export declare class Erii {
    rawArguments: string[];
    parsedArguments: {
        _?: string[];
        [key: string]: string | string[];
    };
    private version;
    private name;
    commands: CommandMap;
    commonOptions: Option[];
    validator: any;
    alwaysHandler: () => any;
    constructor();
    /**
     * 绑定命令处理函数
     * @param config
     * @param handler
     */
    bind(config: Command, handler: (ctx: CommandCtx, ...extraArguments) => any): void;
    /**
     * 总是执行
     * @param handler
     */
    always(handler: () => any): void;
    /**
     * 增加设置项
     * @param config
     */
    addOption(config: Option): void;
    /**
     *
     * @param command
     */
    private commandCtx(command);
    /**
     * 设定基础信息
     * @param metaInfo
     */
    setMetaInfo({version, name}?: {
        version?: string;
        name?: string;
    }): void;
    /**
     * 显示帮助信息
     */
    showHelp(command?: string): void;
    /**
     * 显示版本号
     */
    showVersion(): void;
    /**
     * 启动
     */
    start(): void;
    /**
     * 执行命令担当函数
     * @param command
     * @param extraArguments
     */
    private exec(command);
    validateArgument(argumentValue: any, argument: Argument): any;
    /**
     * 获得命令的参数
     * @param commandName
     * @param followRedirect 是否遵循重定向
     */
    getArgument(commandName: string, followRedirect?: boolean): string;
    /**
     * 启动
     * エリイ 起きてます❤
     */
    okite(): void;
}
declare const _default: Erii;
export default _default;
