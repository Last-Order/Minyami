import { Aes128CbcHandler } from "./aes_128_cbc";
import { IsoBmffSampleAesHandler } from "./iso_bmff_sample_aes/handler";
import { MpegTsSampleAesHandler } from "./mpeg_ts_sample_aes/handler";
import { PackedAacSampleAesHandler } from "./packed_aac_sample_aes/handler";
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

export function createDefaultEncryptionHandlerRegistry(): EncryptionHandlerRegistry {
    return new EncryptionHandlerRegistry([
        new Aes128CbcHandler(),
        new MpegTsSampleAesHandler(),
        new PackedAacSampleAesHandler(),
        new IsoBmffSampleAesHandler(),
    ]);
}
