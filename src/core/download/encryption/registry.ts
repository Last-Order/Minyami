import { Aes128CbcHandler } from "./aes_128_cbc/handler";
import { IsoBmffSampleAesHandler } from "./sample_aes/iso_bmff/handler";
import { MpegTsSampleAesHandler } from "./sample_aes/mpeg_ts/handler";
import { PackedAacSampleAesHandler } from "./sample_aes/packed_aac/handler";
import { EncryptionHandler } from "./types";

export class EncryptionHandlerRegistry {
    private readonly handlers = new Map<string, EncryptionHandler>();

    constructor(handlers: readonly EncryptionHandler[]) {
        for (const handler of handlers) {
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

export function createDefaultEncryptionHandlerRegistry(): EncryptionHandlerRegistry {
    return new EncryptionHandlerRegistry([
        new Aes128CbcHandler(),
        new MpegTsSampleAesHandler(),
        new PackedAacSampleAesHandler(),
        new IsoBmffSampleAesHandler(),
    ]);
}
