import { EncryptionHandler } from "./types";

export class EncryptionHandlerRegistry {
    private readonly handlers = new Map<string, EncryptionHandler>();

    constructor(handlers: readonly EncryptionHandler[]) {
        for (const handler of handlers) {
            if (this.handlers.has(handler.scheme)) {
                throw new Error(`Duplicate encryption handler: ${handler.scheme}`);
            }
            this.handlers.set(handler.scheme, handler);
        }
    }

    require(scheme: string): EncryptionHandler {
        const handler = this.handlers.get(scheme);
        if (!handler) {
            throw new Error(`Unsupported encryption scheme: ${scheme}`);
        }
        return handler;
    }
}
