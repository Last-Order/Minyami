export interface IsoBmffInitializationInfo {
    readonly trackIds: readonly number[];
    readonly protectedTrackIds: readonly number[];
    readonly protectionSchemes: readonly string[];
}

interface IsoBmffBox {
    readonly type: string;
    readonly start: number;
    readonly payloadStart: number;
    readonly end: number;
}

/** Reads only the initialization metadata needed to select and verify mp4decrypt inputs. */
export function inspectIsoBmffInitialization(data: Uint8Array): IsoBmffInitializationInfo {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const topLevel = readBoxes(buffer, 0, buffer.length);
    if (!topLevel.some((box) => box.type === "ftyp")) {
        throw new Error("ISO-BMFF initialization segment does not contain an ftyp box.");
    }
    const movie = topLevel.find((box) => box.type === "moov");
    if (!movie) {
        throw new Error("ISO-BMFF initialization segment does not contain a moov box.");
    }

    const trackIds: number[] = [];
    const protectedTrackIds = new Set<number>();
    const protectionSchemes = new Set<string>();
    for (const track of childrenOf(buffer, movie).filter((box) => box.type === "trak")) {
        const trackHeader = childrenOf(buffer, track).find((box) => box.type === "tkhd");
        if (!trackHeader) {
            throw new Error("ISO-BMFF track does not contain a tkhd box.");
        }
        const trackId = readTrackId(buffer, trackHeader);
        trackIds.push(trackId);

        const sampleDescription = findBoxAtPath(buffer, track, ["mdia", "minf", "stbl", "stsd"]);
        if (!sampleDescription) {
            throw new Error(`ISO-BMFF track ${trackId} does not contain an stsd box.`);
        }
        for (const entry of readSampleEntries(buffer, sampleDescription)) {
            if (entry.type !== "encv" && entry.type !== "enca") {
                continue;
            }
            protectedTrackIds.add(trackId);
            const scheme = readProtectionScheme(buffer, entry);
            if (!scheme) {
                throw new Error(`Protected ISO-BMFF track ${trackId} does not declare a protection scheme.`);
            }
            protectionSchemes.add(scheme);
        }
    }
    if (trackIds.length === 0) {
        throw new Error("ISO-BMFF initialization segment does not contain a track.");
    }
    if (new Set(trackIds).size !== trackIds.length) {
        throw new Error("ISO-BMFF initialization segment contains duplicate track ids.");
    }
    return {
        trackIds,
        protectedTrackIds: [...protectedTrackIds],
        protectionSchemes: [...protectionSchemes],
    };
}

/** Reads only the protected track ids needed for mp4decrypt selectors, ignoring unrelated container metadata. */
export function readIsoBmffDecryptionTrackIds(data: Uint8Array): readonly number[] {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const movie = readBoxes(buffer, 0, buffer.length).find((box) => box.type === "moov");
    if (!movie) {
        throw new Error("ISO-BMFF initialization segment does not contain a moov box.");
    }

    const protectedTrackIds = new Set<number>();
    for (const track of childrenOf(buffer, movie).filter((box) => box.type === "trak")) {
        const sampleDescription = findBoxAtPath(buffer, track, ["mdia", "minf", "stbl", "stsd"]);
        if (
            !sampleDescription ||
            !readSampleEntries(buffer, sampleDescription, false).some(
                (entry) => entry.type === "encv" || entry.type === "enca",
            )
        ) {
            continue;
        }
        const trackHeader = childrenOf(buffer, track).find((box) => box.type === "tkhd");
        if (!trackHeader) {
            throw new Error("Protected ISO-BMFF track does not contain a tkhd box.");
        }
        protectedTrackIds.add(readTrackId(buffer, trackHeader));
    }
    return [...protectedTrackIds];
}

export function validateClearIsoBmffInitialization(data: Uint8Array): void {
    const info = inspectIsoBmffInitialization(data);
    if (info.protectedTrackIds.length > 0) {
        throw new Error("mp4decrypt output still contains protected ISO-BMFF sample entries.");
    }
}

export function validateClearIsoBmffFragment(data: Uint8Array): void {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const boxes = readBoxes(buffer, 0, buffer.length);
    if (!boxes.some((box) => box.type === "moof") || !boxes.some((box) => box.type === "mdat")) {
        throw new Error("mp4decrypt output is not an ISO-BMFF media fragment.");
    }
}

function readBoxes(buffer: Buffer, start: number, end: number): IsoBmffBox[] {
    const boxes: IsoBmffBox[] = [];
    let offset = start;
    while (offset < end) {
        if (end - offset < 8) {
            throw new Error("Truncated ISO-BMFF box header.");
        }
        const size32 = buffer.readUInt32BE(offset);
        const type = buffer.toString("latin1", offset + 4, offset + 8);
        let headerSize = 8;
        let size: number;
        if (size32 === 0) {
            size = end - offset;
        } else if (size32 === 1) {
            if (end - offset < 16) {
                throw new Error(`Truncated large ISO-BMFF ${type} box header.`);
            }
            const largeSize = buffer.readBigUInt64BE(offset + 8);
            if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new Error(`ISO-BMFF ${type} box is too large.`);
            }
            size = Number(largeSize);
            headerSize = 16;
        } else {
            size = size32;
        }
        if (size < headerSize || offset + size > end) {
            throw new Error(`Invalid ISO-BMFF ${type} box size.`);
        }
        boxes.push({ type, start: offset, payloadStart: offset + headerSize, end: offset + size });
        offset += size;
    }
    return boxes;
}

function childrenOf(buffer: Buffer, box: IsoBmffBox): IsoBmffBox[] {
    return readBoxes(buffer, box.payloadStart, box.end);
}

function findBoxAtPath(buffer: Buffer, parent: IsoBmffBox, path: readonly string[]): IsoBmffBox | undefined {
    let current = parent;
    for (const type of path) {
        const child = childrenOf(buffer, current).find((candidate) => candidate.type === type);
        if (!child) {
            return undefined;
        }
        current = child;
    }
    return current;
}

function readTrackId(buffer: Buffer, trackHeader: IsoBmffBox): number {
    if (trackHeader.end - trackHeader.payloadStart < 16) {
        throw new Error("Invalid ISO-BMFF tkhd box.");
    }
    const version = buffer[trackHeader.payloadStart];
    const offset = trackHeader.payloadStart + (version === 1 ? 20 : 12);
    if ((version !== 0 && version !== 1) || offset + 4 > trackHeader.end) {
        throw new Error("Unsupported ISO-BMFF tkhd box version.");
    }
    const trackId = buffer.readUInt32BE(offset);
    if (trackId === 0) {
        throw new Error("ISO-BMFF track id must be non-zero.");
    }
    return trackId;
}

function readSampleEntries(buffer: Buffer, sampleDescription: IsoBmffBox, validateEntryCount = true): IsoBmffBox[] {
    const entriesStart = sampleDescription.payloadStart + 8;
    if (entriesStart > sampleDescription.end) {
        throw new Error("Invalid ISO-BMFF stsd box.");
    }
    const entries = readBoxes(buffer, entriesStart, sampleDescription.end);
    const expectedCount = buffer.readUInt32BE(sampleDescription.payloadStart + 4);
    if (validateEntryCount && entries.length !== expectedCount) {
        throw new Error("ISO-BMFF stsd entry count does not match its contents.");
    }
    return entries;
}

function readProtectionScheme(buffer: Buffer, sampleEntry: IsoBmffBox): string | undefined {
    const childrenStart = sampleEntryChildOffset(buffer, sampleEntry);
    const protection = readBoxes(buffer, childrenStart, sampleEntry.end).find((box) => box.type === "sinf");
    if (!protection) {
        return undefined;
    }
    const scheme = childrenOf(buffer, protection).find((box) => box.type === "schm");
    if (!scheme || scheme.payloadStart + 8 > scheme.end) {
        throw new Error("Invalid ISO-BMFF schm box.");
    }
    return buffer.toString("latin1", scheme.payloadStart + 4, scheme.payloadStart + 8);
}

function sampleEntryChildOffset(buffer: Buffer, sampleEntry: IsoBmffBox): number {
    if (sampleEntry.type === "encv") {
        const offset = sampleEntry.payloadStart + 78;
        if (offset > sampleEntry.end) {
            throw new Error("Invalid protected ISO-BMFF video sample entry.");
        }
        return offset;
    }
    if (sampleEntry.type !== "enca" || sampleEntry.payloadStart + 28 > sampleEntry.end) {
        throw new Error("Invalid protected ISO-BMFF audio sample entry.");
    }
    const version = buffer.readUInt16BE(sampleEntry.payloadStart + 8);
    const extensionSize = version === 0 ? 0 : version === 1 ? 16 : version === 2 ? 36 : -1;
    if (extensionSize < 0 || sampleEntry.payloadStart + 28 + extensionSize > sampleEntry.end) {
        throw new Error("Unsupported protected ISO-BMFF audio sample entry version.");
    }
    return sampleEntry.payloadStart + 28 + extensionSize;
}
