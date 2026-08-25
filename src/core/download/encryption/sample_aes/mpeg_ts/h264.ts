import { CbcDecryptJob, decryptCbcJobs } from "../shared/aes_blocks";

interface AnnexBNalUnit {
    readonly prefix: Buffer;
    readonly data: Buffer;
}

interface AnnexBPayload {
    readonly units: readonly AnnexBNalUnit[];
    readonly trailingZeros: Buffer;
}

export function decryptSampleAesH264(payload: Buffer, key: Buffer, iv: Buffer): Buffer {
    const annexB = parseAnnexB(payload);
    const jobs: CbcDecryptJob[] = [];
    const outputUnits = annexB.units.map((unit) => {
        // ITU-T H.264 §7.3.1: nal_unit_type is the low 5 bits of the one-byte NAL header.
        // https://www.itu.int/dms_pubrec/itu-t/rec/h/T-REC-H.264-202408-I%21%21TOC-HTM-E.htm
        const type = unit.data[0] & 0x1f;
        // Apple SAMPLE-AES §2.2 protects only type 1/5 NAL units longer than 48 bytes.
        // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
        if ((type !== 1 && type !== 5) || unit.data.length <= 48) {
            return unit;
        }

        // Apple §2.2 requires removing the post-encryption emulation-prevention layer before locating CBC blocks.
        // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
        const data = removeEmulationPrevention(unit.data);
        const blockOffsets: number[] = [];
        // Apple Listing 2-1 leaves the NAL header plus 31 bytes clear, then repeats 16 encrypted bytes and
        // up to nine clear AES blocks (9 * 16 = 144); exactly 16 remaining bytes stay clear.
        // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
        let offset = 32;
        let remaining = data.length - offset;
        while (remaining > 0) {
            if (remaining > 16) {
                blockOffsets.push(offset);
                offset += 16;
                remaining -= 16;
            }
            const clearLength = Math.min(144, remaining);
            offset += clearLength;
            remaining -= clearLength;
        }
        jobs.push({ data, blockOffsets, iv });
        return { prefix: unit.prefix, data };
    });

    decryptCbcJobs(key, jobs);
    return Buffer.concat([...outputUnits.flatMap((unit) => [unit.prefix, unit.data]), annexB.trailingZeros]);
}

function parseAnnexB(payload: Buffer): AnnexBPayload {
    const starts: Array<{ prefixOffset: number; dataOffset: number }> = [];
    // ITU-T H.264 Annex B §B.1.1: a delimiter is zero_byte (optional) plus the 0x000001
    // start_code_prefix_one_3bytes; any additional preceding zeroes are leading/trailing_zero_8bits.
    // https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.264-202108-S%21%21PDF-E&lang=e&type=items
    for (let index = 0; index + 3 <= payload.length; ) {
        if (payload[index] === 0 && payload[index + 1] === 0 && payload[index + 2] === 1) {
            let prefixOffset = index;
            while (prefixOffset > 0 && payload[prefixOffset - 1] === 0) {
                prefixOffset--;
            }
            starts.push({ prefixOffset, dataOffset: index + 3 });
            index += 3;
            continue;
        }
        index++;
    }
    if (starts.length === 0 || starts[0].prefixOffset !== 0) {
        throw new Error("SAMPLE-AES H.264 payload is not an Annex-B access unit.");
    }

    // Annex B §B.1.1 excludes trailing_zero_8bits from the final nal_unit, so they must not alter its
    // 32/16/144-byte SAMPLE-AES pattern. They are preserved verbatim in the transformed byte stream.
    let payloadEnd = payload.length;
    while (payloadEnd > starts[starts.length - 1].dataOffset && payload[payloadEnd - 1] === 0) {
        payloadEnd--;
    }
    const units = starts.map((start, index) => {
        const dataEnd = starts[index + 1]?.prefixOffset ?? payloadEnd;
        if (start.dataOffset >= dataEnd) {
            throw new Error("SAMPLE-AES H.264 payload contains an empty NAL unit.");
        }
        return {
            prefix: payload.subarray(start.prefixOffset, start.dataOffset),
            data: Buffer.from(payload.subarray(start.dataOffset, dataEnd)),
        };
    });
    return { units, trailingZeros: payload.subarray(payloadEnd) };
}

function removeEmulationPrevention(input: Buffer): Buffer {
    const output = Buffer.allocUnsafe(input.length);
    let readOffset = 0;
    let writeOffset = 0;
    while (readOffset < input.length) {
        // ITU-T H.264 §7.3.1 inserts emulation_prevention_three_byte (0x03) after 0x0000 only when
        // the following byte is 0x00..0x03. Apple §2.2 reapplies exactly this process after encryption.
        // https://www.itu.int/dms_pubrec/itu-t/rec/h/T-REC-H.264-202408-I%21%21TOC-HTM-E.htm
        if (
            input.length - readOffset > 3 &&
            input[readOffset] === 0 &&
            input[readOffset + 1] === 0 &&
            input[readOffset + 2] === 3 &&
            input[readOffset + 3] <= 3
        ) {
            output[writeOffset++] = input[readOffset++];
            output[writeOffset++] = input[readOffset++];
            readOffset++;
        } else {
            output[writeOffset++] = input[readOffset++];
        }
    }
    return output.subarray(0, writeOffset);
}
