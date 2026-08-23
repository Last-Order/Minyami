function box(type: string, payload: Buffer): Buffer {
    const result = Buffer.alloc(8 + payload.length);
    result.writeUInt32BE(result.length, 0);
    result.write(type, 4, 4, "latin1");
    payload.copy(result, 8);
    return result;
}

function fullBox(type: string, payload: Buffer): Buffer {
    return box(type, Buffer.concat([Buffer.alloc(4), payload]));
}

export function createProtectedInitialization(trackId = 1, scheme = "cbcs"): Buffer {
    const trackHeader = Buffer.alloc(20);
    trackHeader.writeUInt32BE(trackId, 12);
    const schemeBody = Buffer.alloc(8);
    schemeBody.write(scheme, 0, 4, "latin1");
    schemeBody.writeUInt32BE(0x10000, 4);
    const protection = box("sinf", fullBox("schm", schemeBody));
    const protectedEntry = box("encv", Buffer.concat([Buffer.alloc(78), protection]));
    const count = Buffer.alloc(4);
    count.writeUInt32BE(1);
    const sampleDescription = fullBox("stsd", Buffer.concat([count, protectedEntry]));
    const movie = box(
        "moov",
        box(
            "trak",
            Buffer.concat([
                fullBox("tkhd", trackHeader.subarray(4)),
                box("mdia", box("minf", box("stbl", sampleDescription))),
            ])
        )
    );
    return Buffer.concat([box("ftyp", Buffer.from("iso600000001iso6")), movie]);
}

export function createClearInitialization(trackId = 1): Buffer {
    const trackHeader = Buffer.alloc(20);
    trackHeader.writeUInt32BE(trackId, 12);
    const clearEntry = box("avc1", Buffer.alloc(78));
    const count = Buffer.alloc(4);
    count.writeUInt32BE(1);
    const sampleDescription = fullBox("stsd", Buffer.concat([count, clearEntry]));
    const movie = box(
        "moov",
        box(
            "trak",
            Buffer.concat([
                fullBox("tkhd", trackHeader.subarray(4)),
                box("mdia", box("minf", box("stbl", sampleDescription))),
            ])
        )
    );
    return Buffer.concat([box("ftyp", Buffer.from("iso600000001iso6")), movie]);
}

export function createMediaFragment(content: string): Buffer {
    return Buffer.concat([box("moof", Buffer.alloc(0)), box("mdat", Buffer.from(content))]);
}
