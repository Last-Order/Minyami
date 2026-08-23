const ID3_HEADER_SIZE = 10;
const ID3_FOOTER_SIZE = 10;

export interface LeadingId3Tags {
    readonly payloadOffset: number;
}

/** Locates the elementary audio after complete leading ID3v2 tags without interpreting their HLS metadata. */
export function parseLeadingId3Tags(data: Buffer): LeadingId3Tags {
    let offset = 0;

    while (hasId3Signature(data, offset)) {
        if (offset + ID3_HEADER_SIZE > data.length) {
            throw new Error("Packed Audio contains a truncated ID3 header.");
        }
        const majorVersion = data[offset + 3];
        if (majorVersion < 2 || majorVersion > 4 || data[offset + 4] === 0xff) {
            throw new Error("Packed Audio contains an unsupported ID3 version.");
        }
        const sizeBytes = data.subarray(offset + 6, offset + 10);
        if (sizeBytes.some((value) => (value & 0x80) !== 0)) {
            throw new Error("Packed Audio contains an invalid ID3 syncsafe size.");
        }
        const bodySize = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
        const hasFooter = majorVersion === 4 && (data[offset + 5] & 0x10) !== 0;
        const tagSize = ID3_HEADER_SIZE + bodySize + (hasFooter ? ID3_FOOTER_SIZE : 0);
        if (offset + tagSize > data.length) {
            throw new Error("Packed Audio contains a truncated ID3 tag.");
        }
        offset += tagSize;
    }
    return { payloadOffset: offset };
}

/** Checks only the clear ADTS header fields that are available in a bounded source probe. */
export function hasAdtsHeader(data: Buffer, offset: number): boolean {
    if (offset < 0 || offset + 7 > data.length) {
        return false;
    }
    if (data[offset] !== 0xff || (data[offset + 1] & 0xf6) !== 0xf0) {
        return false;
    }
    const headerLength = data[offset + 1] & 1 ? 7 : 9;
    const frameLength = ((data[offset + 3] & 3) << 11) | (data[offset + 4] << 3) | (data[offset + 5] >> 5);
    return frameLength >= headerLength;
}

function hasId3Signature(data: Buffer, offset: number): boolean {
    return data[offset] === 0x49 && data[offset + 1] === 0x44 && data[offset + 2] === 0x33;
}
