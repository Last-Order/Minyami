import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { MpegTsSampleAesHandler } from "@/core/download/encryption/sample_aes/mpeg_ts/handler";
import { decryptMpegTsSampleAes, mpegCrc32 } from "@/core/download/encryption/sample_aes/mpeg_ts/transport_stream";
import { decryptSampleAesH264 } from "@/core/download/encryption/sample_aes/mpeg_ts/h264";
import { withTempDirectory } from "../../../helpers/filesystem";

const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const iv = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");

describe("MpegTsSampleAesHandler", () => {
    test("uses the MPEG-2 CRC polynomial", () => {
        expect(mpegCrc32(Buffer.from("123456789"))).toBe(0x0376e6e7);
    });

    test("decrypts H.264 and AAC samples and publishes clear PMT stream types", () => {
        const fixture = createEncryptedTransportStream();
        const clear = decryptMpegTsSampleAes(fixture.encrypted, key, iv);

        expect(clear).toHaveLength(fixture.encrypted.length);
        expect(readPmtStreamTypes(clear)).toEqual([0x1b, 0x0f]);
        expect(readPesPayload(clear, 0x100)).toEqual(fixture.video);
        expect(readPesPayload(clear, 0x101)).toEqual(fixture.audio);
    });

    test.each([
        ["AC-3", 0xc1, 0x81, createAc3Frame],
        ["E-AC-3", 0xc2, 0x87, createEac3Frame],
    ] as const)(
        "decrypts %s samples and restores their clear stream type",
        (_name, protectedType, clearType, createFrame) => {
            const audio = createFrame();
            const encryptedAudio = Buffer.from(audio);
            encryptCbcBlocks(encryptedAudio, encryptedAudioBlockOffsets(audio.length));
            const encrypted = Buffer.concat([
                ...packetizePsi(0, createPatSection(0x64)),
                ...packetizePsi(0x64, createPmtSection([{ type: protectedType, pid: 0x101 }])),
                ...packetizePes(0x101, createPes(0xbd, encryptedAudio)),
            ]);

            const clear = decryptMpegTsSampleAes(encrypted, key, iv);

            expect(readPmtStreamTypes(clear)).toEqual([clearType]);
            expect(readPesPayload(clear, 0x101)).toEqual(audio);
        }
    );

    test("rejects malformed transport length and protected PES continuity", () => {
        const fixture = createEncryptedTransportStream();
        expect(() => decryptMpegTsSampleAes(fixture.encrypted.subarray(0, -1), key, iv)).toThrow(
            "188-byte MPEG transport stream"
        );

        const badContinuity = Buffer.from(fixture.encrypted);
        const videoPackets = packetsForPid(badContinuity, 0x100);
        videoPackets[1][3] = (videoPackets[1][3] & 0xf0) | ((videoPackets[0][3] + 2) & 0x0f);
        expect(() => decryptMpegTsSampleAes(badContinuity, key, iv)).toThrow("MPEG-TS continuity error");
    });

    test("keeps Annex-B leading and trailing zero bytes outside the encrypted NAL unit", () => {
        const nal = Buffer.alloc(240);
        nal[0] = 0x65;
        for (let index = 1; index < nal.length; index++) {
            nal[index] = (index % 251) + 1;
        }
        const encryptedNal = Buffer.from(nal);
        const blockOffsets = sampleAesH264BlockOffsets(encryptedNal.length);
        encryptCbcBlocks(encryptedNal, blockOffsets);
        const prefix = Buffer.from([0, 0, 0, 0, 1]);
        const trailingZeros = Buffer.from([0, 0]);
        const encrypted = Buffer.concat([prefix, applyEmulationPrevention(encryptedNal), trailingZeros]);

        expect(decryptSampleAesH264(encrypted, key, iv)).toEqual(Buffer.concat([prefix, nal, trailingZeros]));
    });

    test("commits an output file without removing the encrypted input", async () => {
        await withTempDirectory("minyami-sample-aes-handler-", async (directory) => {
            const fixture = createEncryptedTransportStream();
            const inputPath = path.join(directory, "encrypted.ts");
            const outputPath = path.join(directory, "clear.ts");
            fs.writeFileSync(inputPath, fixture.encrypted);

            const handler = new MpegTsSampleAesHandler();
            await handler.decrypt({
                inputPath,
                outputPath,
                encryption: {
                    scheme: "mpeg-ts-sample-aes",
                    keyId: "skd://fixture",
                    iv: iv.toString("hex"),
                },
                keys: new Map([["skd://fixture", key.toString("hex")]]),
            });

            expect(readPesPayload(fs.readFileSync(outputPath), 0x100)).toEqual(fixture.video);
            expect(fs.existsSync(inputPath)).toBe(true);
            expect(fs.existsSync(outputPath + ".t")).toBe(false);
        });
    });

    test("preserves the encrypted input and removes its owned temporary output after a transform failure", async () => {
        await withTempDirectory("minyami-sample-aes-handler-failure-", async (directory) => {
            const inputPath = path.join(directory, "encrypted.ts");
            const outputPath = path.join(directory, "clear.ts");
            fs.writeFileSync(inputPath, "not a transport stream");

            const handler = new MpegTsSampleAesHandler();
            await expect(
                handler.decrypt({
                    inputPath,
                    outputPath,
                    encryption: {
                        scheme: "mpeg-ts-sample-aes",
                        keyId: "skd://fixture",
                        iv: iv.toString("hex"),
                    },
                    keys: new Map([["skd://fixture", key.toString("hex")]]),
                })
            ).rejects.toThrow("188-byte MPEG transport stream");

            expect(fs.readFileSync(inputPath, "utf8")).toBe("not a transport stream");
            expect(fs.existsSync(outputPath)).toBe(false);
            expect(fs.readdirSync(directory).filter((name) => name.startsWith("clear.ts.t-"))).toEqual([]);
        });
    });

    test.each([
        ["invalid key", "z".repeat(32), iv.toString("hex"), "SAMPLE-AES key"],
        ["invalid IV", key.toString("hex"), "xy", "SAMPLE-AES IV"],
    ])("rejects an %s", (_name, invalidKey, invalidIv, message) => {
        const handler = new MpegTsSampleAesHandler();
        expect(() =>
            handler.validate(
                { scheme: "mpeg-ts-sample-aes", keyId: "skd://fixture", iv: invalidIv },
                new Map([["skd://fixture", invalidKey]])
            )
        ).toThrow(message);
    });
});

function createEncryptedTransportStream(): { encrypted: Buffer; video: Buffer; audio: Buffer } {
    const videoNal = Buffer.alloc(240);
    videoNal[0] = 0x65;
    for (let index = 1; index < videoNal.length; index++) {
        videoNal[index] = (index % 251) + 1;
    }
    const video = Buffer.concat([Buffer.from([0, 0, 0, 1]), videoNal]);
    const encryptedVideoNal = Buffer.from(videoNal);
    encryptCbcBlocks(encryptedVideoNal, sampleAesH264BlockOffsets(encryptedVideoNal.length));
    const encryptedVideo = Buffer.concat([Buffer.from([0, 0, 0, 1]), applyEmulationPrevention(encryptedVideoNal)]);

    const audio = createAdtsFrame(64);
    const encryptedAudio = Buffer.from(audio);
    const audioHeaderLength = 7;
    const audioEncryptedLength = Math.floor((audio.length - audioHeaderLength - 16) / 16) * 16;
    encryptCbcBlocks(
        encryptedAudio,
        Array.from({ length: audioEncryptedLength / 16 }, (_value, index) => audioHeaderLength + 16 + index * 16)
    );

    const packets = [
        ...packetizePsi(0, createPatSection(0x64)),
        ...packetizePsi(0x64, createPmtSection()),
        ...packetizePes(0x100, createPes(0xe0, encryptedVideo)),
        ...packetizePes(0x101, createPes(0xc0, encryptedAudio)),
    ];
    return { encrypted: Buffer.concat(packets), video, audio };
}

function sampleAesH264BlockOffsets(length: number): number[] {
    const offsets: number[] = [];
    let offset = 32;
    let remaining = length - offset;
    while (remaining > 0) {
        if (remaining > 16) {
            offsets.push(offset);
            offset += 16;
            remaining -= 16;
        }
        const clearLength = Math.min(144, remaining);
        offset += clearLength;
        remaining -= clearLength;
    }
    return offsets;
}

function encryptCbcBlocks(data: Buffer, offsets: readonly number[]): void {
    if (offsets.length === 0) {
        return;
    }
    const plaintext = Buffer.concat(offsets.map((offset) => data.subarray(offset, offset + 16)));
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    offsets.forEach((offset, index) => ciphertext.copy(data, offset, index * 16, index * 16 + 16));
}

function applyEmulationPrevention(data: Buffer): Buffer {
    const output: number[] = [];
    for (const value of data) {
        if (output.length >= 2 && output[output.length - 1] === 0 && output[output.length - 2] === 0 && value <= 3) {
            output.push(3);
        }
        output.push(value);
    }
    return Buffer.from(output);
}

function createAdtsFrame(length: number): Buffer {
    const frame = Buffer.alloc(length);
    const profile = 1;
    const sampleRateIndex = 4;
    const channelConfig = 2;
    frame[0] = 0xff;
    frame[1] = 0xf1;
    frame[2] = (profile << 6) | (sampleRateIndex << 2) | (channelConfig >> 2);
    frame[3] = ((channelConfig & 3) << 6) | (length >> 11);
    frame[4] = (length >> 3) & 0xff;
    frame[5] = ((length & 7) << 5) | 0x1f;
    frame[6] = 0xfc;
    for (let index = 7; index < frame.length; index++) {
        frame[index] = (index * 7 + 3) & 0xff;
    }
    return frame;
}

function createAc3Frame(): Buffer {
    const frame = createAudioPayload(128);
    frame[0] = 0x0b;
    frame[1] = 0x77;
    // 48 kHz and frame-size code 0 produce a 128-byte syncframe.
    frame[4] = 0;
    return frame;
}

function createEac3Frame(): Buffer {
    const length = 128;
    const frameSize = length / 2 - 1;
    const frame = createAudioPayload(length);
    frame[0] = 0x0b;
    frame[1] = 0x77;
    frame[2] = (frameSize >> 8) & 7;
    frame[3] = frameSize & 0xff;
    frame[4] = 0x30;
    return frame;
}

function createAudioPayload(length: number): Buffer {
    const frame = Buffer.alloc(length);
    for (let index = 0; index < frame.length; index++) {
        frame[index] = (index * 13 + 9) & 0xff;
    }
    return frame;
}

function encryptedAudioBlockOffsets(length: number): number[] {
    const encryptedLength = Math.floor((length - 16) / 16) * 16;
    return Array.from({ length: encryptedLength / 16 }, (_value, index) => 16 + index * 16);
}

function createPes(streamId: number, payload: Buffer): Buffer {
    const pes = Buffer.alloc(9 + payload.length);
    pes[0] = 0;
    pes[1] = 0;
    pes[2] = 1;
    pes[3] = streamId;
    pes.writeUInt16BE(3 + payload.length, 4);
    pes[6] = 0x80;
    pes[7] = 0;
    pes[8] = 0;
    payload.copy(pes, 9);
    return pes;
}

function createPatSection(pmtPid: number): Buffer {
    const section = Buffer.from([
        0x00,
        0xb0,
        0x0d,
        0x00,
        0x01,
        0xc1,
        0x00,
        0x00,
        0x00,
        0x01,
        0xe0 | (pmtPid >> 8),
        pmtPid & 0xff,
        0,
        0,
        0,
        0,
    ]);
    section.writeUInt32BE(mpegCrc32(section.subarray(0, -4)), section.length - 4);
    return section;
}

function createPmtSection(
    streams: readonly { readonly type: number; readonly pid: number }[] = [
        { type: 0xdb, pid: 0x100 },
        { type: 0xcf, pid: 0x101 },
    ]
): Buffer {
    const entries = Buffer.concat(
        streams.map(({ type, pid }) => Buffer.from([type, 0xe0 | (pid >> 8), pid & 0xff, 0xf0, 0x00]))
    );
    const section = Buffer.alloc(12 + entries.length + 4);
    const sectionLength = section.length - 3;
    section[0] = 0x02;
    section[1] = 0xb0 | (sectionLength >> 8);
    section[2] = sectionLength & 0xff;
    section.writeUInt16BE(1, 3);
    section[5] = 0xc1;
    section[8] = 0xe0 | (streams[0].pid >> 8);
    section[9] = streams[0].pid & 0xff;
    section[10] = 0xf0;
    entries.copy(section, 12);
    section.writeUInt32BE(mpegCrc32(section.subarray(0, -4)), section.length - 4);
    return section;
}

function packetizePsi(pid: number, section: Buffer): Buffer[] {
    return packetizePayload(pid, Buffer.concat([Buffer.from([0]), section]));
}

function packetizePes(pid: number, pes: Buffer): Buffer[] {
    return packetizePayload(pid, pes);
}

function packetizePayload(pid: number, payload: Buffer): Buffer[] {
    const packets: Buffer[] = [];
    let offset = 0;
    let continuityCounter = 0;
    while (offset < payload.length) {
        const packet = Buffer.alloc(188, 0xff);
        const payloadLength = Math.min(184, payload.length - offset);
        const stuffing = 184 - payloadLength;
        packet[0] = 0x47;
        packet[1] = ((packets.length === 0 ? 0x40 : 0) | (pid >> 8)) & 0x5f;
        packet[2] = pid & 0xff;
        if (stuffing === 0) {
            packet[3] = 0x10 | continuityCounter;
            payload.copy(packet, 4, offset, offset + payloadLength);
        } else {
            packet[3] = 0x30 | continuityCounter;
            packet[4] = stuffing - 1;
            if (stuffing > 1) {
                packet[5] = 0;
            }
            payload.copy(packet, 4 + stuffing, offset, offset + payloadLength);
        }
        packets.push(packet);
        continuityCounter = (continuityCounter + 1) & 0x0f;
        offset += payloadLength;
    }
    return packets;
}

function readPesPayload(stream: Buffer, pid: number): Buffer {
    const parts: Buffer[] = [];
    for (let offset = 0; offset < stream.length; offset += 188) {
        const packet = stream.subarray(offset, offset + 188);
        if ((((packet[1] & 0x1f) << 8) | packet[2]) !== pid) {
            continue;
        }
        const adaptationControl = (packet[3] >> 4) & 3;
        const payloadOffset = adaptationControl === 3 ? 5 + packet[4] : 4;
        if (adaptationControl === 1 || (adaptationControl === 3 && payloadOffset < 188)) {
            parts.push(packet.subarray(payloadOffset));
        }
    }
    const pes = Buffer.concat(parts);
    const length = pes.readUInt16BE(4);
    const end = length === 0 ? pes.length : 6 + length;
    return pes.subarray(9 + pes[8], end);
}

function readPmtStreamTypes(stream: Buffer): number[] {
    for (let offset = 0; offset < stream.length; offset += 188) {
        const packet = stream.subarray(offset, offset + 188);
        const pid = ((packet[1] & 0x1f) << 8) | packet[2];
        if (pid !== 0x64) {
            continue;
        }
        const adaptationControl = (packet[3] >> 4) & 3;
        const payloadOffset = adaptationControl === 3 ? 5 + packet[4] : 4;
        const payload = packet.subarray(payloadOffset);
        const section = payload.subarray(1 + payload[0]);
        const sectionLength = 3 + (((section[1] & 0x0f) << 8) | section[2]);
        const programInfoLength = ((section[10] & 0x0f) << 8) | section[11];
        const types: number[] = [];
        let sectionOffset = 12 + programInfoLength;
        while (sectionOffset < sectionLength - 4) {
            types.push(section[sectionOffset]);
            const infoLength = ((section[sectionOffset + 3] & 0x0f) << 8) | section[sectionOffset + 4];
            sectionOffset += 5 + infoLength;
        }
        return types;
    }
    throw new Error("Missing test PMT.");
}

function packetsForPid(stream: Buffer, pid: number): Buffer[] {
    const packets: Buffer[] = [];
    for (let offset = 0; offset < stream.length; offset += 188) {
        const packet = stream.subarray(offset, offset + 188);
        if ((((packet[1] & 0x1f) << 8) | packet[2]) === pid) {
            packets.push(packet);
        }
    }
    return packets;
}
