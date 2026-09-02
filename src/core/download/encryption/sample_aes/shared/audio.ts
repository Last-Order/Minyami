import { CbcDecryptJob, decryptCbcJobs } from "./aes_blocks";

export type SampleAesAudioCodec = "aac" | "ac3" | "eac3";

interface ParsedAudioFrame {
    readonly length: number;
    readonly headerLength: number;
    readonly eac3?: {
        readonly streamType: number;
        readonly substreamId: number;
        readonly numBlocks: number;
    };
}

export function decryptSampleAesAudio(payload: Buffer, codec: SampleAesAudioCodec, key: Buffer, iv: Buffer): Buffer {
    const output = Buffer.from(payload);
    const jobs: CbcDecryptJob[] = [];
    let offset = 0;
    let eac3FrameOffsets: number[] | undefined;
    let eac3PrimaryBlocks = 0;

    while (offset < output.length) {
        const frame = parseFrame(output, offset, codec);
        if (codec === "eac3") {
            const info = frame.eac3!;
            // ETSI TS 102 366 Annex E, §E.1.3.1.5: numblkscod 0..3 means 1, 2, 3, or 6 blocks;
            // an E-AC-3 audio frame totals six blocks and starts with independent substream 0 (§E.1.3.1.2).
            // https://www.etsi.org/deliver/etsi_ts/102300_102399/102366/01.04.01_60/ts_102366v010401p.pdf
            if (info.streamType !== 1 && info.substreamId === 0) {
                if (eac3FrameOffsets === undefined || eac3PrimaryBlocks === 6) {
                    if (eac3FrameOffsets && eac3FrameOffsets.length > 0) {
                        jobs.push({ data: output, blockOffsets: eac3FrameOffsets, iv });
                    }
                    eac3FrameOffsets = [];
                    eac3PrimaryBlocks = 0;
                }
                eac3PrimaryBlocks += info.numBlocks;
                if (eac3PrimaryBlocks > 6) {
                    throw new Error("Invalid EAC3 audio-frame block count in SAMPLE-AES payload.");
                }
            } else if (!eac3FrameOffsets) {
                throw new Error("SAMPLE-AES EAC3 audio frame does not start with independent substream 0.");
            }
        }
        // Apple SAMPLE-AES §2.3 leaves the ADTS header (AAC only) and first 16 frame bytes clear, then
        // encrypts every complete 16-byte block; therefore at least 32 post-header bytes are needed.
        // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
        if (frame.length >= frame.headerLength + 32) {
            const encryptedOffset = offset + frame.headerLength + 16;
            const encryptedLength = Math.floor((frame.length - frame.headerLength - 16) / 16) * 16;
            const blockOffsets = Array.from(
                { length: encryptedLength / 16 },
                (_value, index) => encryptedOffset + index * 16,
            );
            if (codec === "eac3") {
                // Apple §2.3.1.3: the IV does not reset between syncframes in one E-AC-3 audio frame.
                // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
                eac3FrameOffsets!.push(...blockOffsets);
            } else {
                jobs.push({ data: output, blockOffsets, iv });
            }
        }
        offset += frame.length;
    }
    if (eac3FrameOffsets && eac3PrimaryBlocks !== 6) {
        throw new Error("Incomplete EAC3 audio frame in SAMPLE-AES payload.");
    }
    if (eac3FrameOffsets && eac3FrameOffsets.length > 0) {
        jobs.push({ data: output, blockOffsets: eac3FrameOffsets, iv });
    }
    decryptCbcJobs(key, jobs);
    return output;
}

function parseFrame(data: Buffer, offset: number, codec: SampleAesAudioCodec): ParsedAudioFrame {
    if (codec === "aac") {
        // ISO/IEC 14496-3:2019 Tables 1.A.5 and 1.A.6: syncword is 12 one-bits, while
        // protection_absent selects the 7-byte fixed/variable header or its 9-byte CRC form.
        // Other ADTS fields do not affect SAMPLE-AES block placement and are intentionally ignored.
        // https://www.iso.org/standard/76383.html
        if (offset + 7 > data.length || data[offset] !== 0xff || (data[offset + 1] & 0xf0) !== 0xf0) {
            throw new Error("Invalid ADTS frame in SAMPLE-AES AAC payload.");
        }
        const headerLength = data[offset + 1] & 1 ? 7 : 9;
        // ISO/IEC 14496-3:2019 Table 1.A.7 splits the 13-bit aac_frame_length across bytes 3..5.
        // https://www.iso.org/standard/76383.html
        const length = ((data[offset + 3] & 3) << 11) | (data[offset + 4] << 3) | (data[offset + 5] >> 5);
        validateFrameRange(data, offset, length, headerLength, "AAC");
        return { length, headerLength };
    }

    // ETSI TS 102 366 §4.4.1.1 and Annex E §E.1.2.1 define the 16-bit AC-3/E-AC-3 syncword as 0x0B77.
    // https://www.etsi.org/deliver/etsi_ts/102300_102399/102366/01.04.01_60/ts_102366v010401p.pdf
    if (offset + 6 > data.length || data[offset] !== 0x0b || data[offset + 1] !== 0x77) {
        throw new Error(`Invalid ${codec.toUpperCase()} syncframe in SAMPLE-AES payload.`);
    }
    const eac3 = codec === "eac3" ? parseEac3FrameInfo(data, offset) : undefined;
    const length = eac3?.length ?? parseAc3FrameLength(data, offset);
    validateFrameRange(data, offset, length, 0, codec.toUpperCase());
    return {
        length,
        headerLength: 0,
        ...(eac3
            ? {
                  eac3: {
                      streamType: eac3.streamType,
                      substreamId: eac3.substreamId,
                      numBlocks: eac3.numBlocks,
                  },
              }
            : {}),
    };
}

function parseAc3FrameLength(data: Buffer, offset: number): number {
    // ETSI TS 102 366 §4.3.1/§4.4.1: byte 4 carries 2-bit fscod and 6-bit frmsizecod; Table 4.13
    // gives the 32/44.1/48-kHz frame sizes used by the formulas below (one word is 16 bits).
    // https://www.etsi.org/deliver/etsi_ts/102300_102399/102366/01.04.01_60/ts_102366v010401p.pdf
    const fscod = data[offset + 4] >> 6;
    const frameSizeCode = data[offset + 4] & 0x3f;
    const bitrateIndex = frameSizeCode >> 1;
    const bitrates = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640];
    if (fscod === 3 || bitrateIndex >= bitrates.length) {
        throw new Error("Invalid AC-3 frame-size code in SAMPLE-AES payload.");
    }
    const bitrate = bitrates[bitrateIndex];
    if (fscod === 0) {
        return bitrate * 4;
    }
    if (fscod === 2) {
        return bitrate * 6;
    }
    // Table 4.13's 44.1-kHz column alternates the rounded 320/147 word count by frmsizecod parity.
    return (Math.floor((bitrate * 320) / 147) + (frameSizeCode & 1)) * 2;
}

function parseEac3FrameInfo(
    data: Buffer,
    offset: number,
): { length: number; streamType: number; substreamId: number; numBlocks: number } {
    // ETSI TS 102 366 Annex E, §E.1.2.2/§E.1.3.1: after the 16-bit syncword come strmtyp(2),
    // substreamid(3), frmsiz(11), fscod(2), and numblkscod/fscod2(2), all most-significant-bit first.
    // https://www.etsi.org/deliver/etsi_ts/102300_102399/102366/01.04.01_60/ts_102366v010401p.pdf
    const streamType = data[offset + 2] >> 6;
    const fscod = data[offset + 4] >> 6;
    const numBlocksCodeOrFscod2 = (data[offset + 4] >> 4) & 3;
    const blockCounts = [1, 2, 3, 6] as const;
    return {
        // §E.1.3.1.3: frmsiz is one less than the syncframe length measured in 16-bit words.
        length: ((((data[offset + 2] & 7) << 8) | data[offset + 3]) + 1) * 2,
        streamType,
        substreamId: (data[offset + 2] >> 3) & 7,
        numBlocks: fscod === 3 ? 6 : blockCounts[numBlocksCodeOrFscod2],
    };
}

function validateFrameRange(data: Buffer, offset: number, length: number, headerLength: number, codec: string): void {
    if (!Number.isSafeInteger(length) || length < headerLength || offset + length > data.length) {
        throw new Error(`Invalid ${codec} frame length in SAMPLE-AES payload.`);
    }
}
