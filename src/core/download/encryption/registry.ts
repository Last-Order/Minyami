import { DownloadEncryption } from "@/core/source/types";
import { Aes128CbcHandler } from "./aes_128_cbc/handler";
import { IsoBmffSampleAesHandler } from "./sample_aes/iso_bmff/handler";
import { MpegTsSampleAesHandler } from "./sample_aes/mpeg_ts/handler";
import { PackedAacSampleAesHandler } from "./sample_aes/packed_aac/handler";
import { EncryptionHandler } from "./types";

export interface ResolvedEncryption {
    readonly handler: EncryptionHandler;
    readonly keys: ReadonlyMap<string, string>;
}

interface EncryptionKeySource {
    get(id: string): string | undefined;
}

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

    /** Materializes only the keys required by one immutable encryption descriptor. */
    resolve(
        encryption: DownloadEncryption,
        source: EncryptionKeySource,
        missingKeyMessage: (keyId: string) => string = (keyId) => `Missing encryption key for ${keyId}`,
    ): ResolvedEncryption {
        const handler = this.require(encryption.scheme);
        const keys = new Map<string, string>();
        for (const keyId of handler.keyIds(encryption)) {
            const key = source.get(keyId);
            if (!key) {
                throw new Error(missingKeyMessage(keyId));
            }
            keys.set(keyId, key);
        }
        return { handler, keys };
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
