const commandNames = ["help", "h", "version", "download", "d"];
const explicitCommands = new Set(commandNames.flatMap((name) => [`-${name}`, `--${name}`]));

export function normalizeCliArguments(args: readonly string[]): string[] {
    const input = args[0];
    // Erii reads process.argv during construction; route shorthand through its existing download command.
    if (
        !input ||
        input.startsWith("-") ||
        commandNames.includes(input) ||
        args.some((arg) => explicitCommands.has(arg))
    ) {
        return [...args];
    }
    return ["--download", ...args];
}
