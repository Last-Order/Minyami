import { createRequire } from "node:module";

export interface EriiCommandContext {
    showVersion(): void;
    showHelp(): void;
    getArgument(commandName?: string): string;
}

export interface EriiArgument {
    name: string;
    description: string;
    validate?: string | ((value: string, logger: (message: string) => void) => boolean);
}

export interface EriiCommand {
    name: string | string[];
    description?: string;
    argument?: EriiArgument;
}

export interface EriiOption extends EriiCommand {
    command?: string;
}

export interface Erii<TOptions extends object> {
    bind(
        config: EriiCommand,
        handler: (context: EriiCommandContext, options: TOptions) => unknown | Promise<unknown>,
    ): void;
    addOption(config: EriiOption): void;
    default(handler: () => unknown): void;
    setMetaInfo(meta: { version?: string; name?: string }): void;
    showHelp(command?: string): void;
    okite(): void;
}

/**
 * Erii is CommonJS-only and its bundled declaration has an invalid strict index signature.
 * Keep the unchecked module shape at this runtime boundary while exposing only the API the CLI uses.
 */
export function createErii<TOptions extends object>(): Erii<TOptions> {
    const require = createRequire(import.meta.url);
    const EriiConstructor = (require("erii") as { Erii: new () => Erii<TOptions> }).Erii;
    return new EriiConstructor();
}
