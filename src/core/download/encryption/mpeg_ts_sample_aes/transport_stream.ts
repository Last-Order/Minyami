import { decryptSampleAesAudio, SampleAesAudioCodec } from "./audio";
import { decryptSampleAesH264 } from "./h264";

// ITU-T H.222.0 §2.4.3.2/Table 2-2 fixes each transport packet at 188 bytes and sync_byte at 0x47.
// https://www.itu.int/rec/T-REC-H.222.0/en
const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;

type ProtectedCodec = "h264" | SampleAesAudioCodec;

interface TransportPacket {
    readonly index: number;
    readonly data: Buffer;
    readonly pid: number;
    readonly payloadUnitStart: boolean;
}

interface PayloadPacket extends TransportPacket {
    readonly continuityCounter: number;
    readonly discontinuity: boolean;
    readonly payloadOffset: number;
    readonly originalAdaptationLength?: number;
}

interface ProgramMap {
    readonly pid: number;
    readonly streams: ReadonlyMap<number, ProtectedCodec>;
}

export function decryptMpegTsSampleAes(input: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (input.length === 0 || input.length % TS_PACKET_SIZE !== 0) {
        throw new Error("SAMPLE-AES input is not a 188-byte MPEG transport stream.");
    }
    // Apple SAMPLE-AES §2.1 fixes AES-128 key and CBC IV size at 16 bytes.
    // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
    if (key.length !== 16 || iv.length !== 16) {
        throw new Error("SAMPLE-AES requires a 16-byte key and IV.");
    }

    const output = Buffer.from(input);
    const packets = parseTransportPackets(output);
    const programMap = parseProgramMap(packets);
    if (programMap.streams.size === 0) {
        throw new Error("MPEG-TS PMT does not contain a supported SAMPLE-AES stream.");
    }

    for (const [pid, codec] of programMap.streams) {
        decryptProtectedPid(packets, pid, codec, key, iv);
    }
    rewriteProgramMaps(packets, programMap.pid);
    return output;
}

function parseTransportPackets(data: Buffer): TransportPacket[] {
    const packets: TransportPacket[] = [];
    for (let offset = 0, index = 0; offset < data.length; offset += TS_PACKET_SIZE, index++) {
        const packet = data.subarray(offset, offset + TS_PACKET_SIZE);
        // H.222.0 §2.4.3.2/Table 2-2: byte 1 carries PUSI and PID[12..8]. Only those routing fields
        // are read here; sync/adaptation/error fields are checked later only for PAT, PMT, or a protected PID.
        // https://www.itu.int/rec/T-REC-H.222.0/en
        packets.push({
            index,
            data: packet,
            pid: ((packet[1] & 0x1f) << 8) | packet[2],
            payloadUnitStart: (packet[1] & 0x40) !== 0,
        });
    }
    return packets;
}

function readTransportPayload(packet: TransportPacket): PayloadPacket | undefined {
    // H.222.0 §2.4.3.2/Table 2-2: adaptation_field_control 01/11 carries payload. Packets without
    // payload are irrelevant to PES assembly, so their adaptation field and flags are deliberately not parsed.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    if (packet.data[0] !== TS_SYNC_BYTE) {
        throw new Error(`Invalid MPEG-TS sync byte at packet ${packet.index}.`);
    }
    const adaptationControl = (packet.data[3] >> 4) & 3;
    if (adaptationControl !== 1 && adaptationControl !== 3) {
        return undefined;
    }
    if ((packet.data[1] & 0x80) !== 0) {
        throw new Error(`MPEG-TS transport error indicator is set at packet ${packet.index}.`);
    }

    let payloadOffset = 4;
    let adaptationLength: number | undefined;
    let discontinuity = false;
    if (adaptationControl === 3) {
        // H.222.0 §2.4.3.4/Table 2-6: adaptation_field_length follows the four-byte header, and
        // flag bit 7 is discontinuity_indicator. These values affect payload location/continuity handling.
        adaptationLength = packet.data[4];
        payloadOffset = 5 + adaptationLength;
        if (payloadOffset > TS_PACKET_SIZE) {
            throw new Error(`Invalid MPEG-TS adaptation field at packet ${packet.index}.`);
        }
        if (adaptationLength > 0) {
            discontinuity = (packet.data[5] & 0x80) !== 0;
        }
    }
    if (payloadOffset === TS_PACKET_SIZE) {
        return undefined;
    }
    return {
        ...packet,
        payloadOffset,
        continuityCounter: packet.data[3] & 0x0f,
        discontinuity,
        ...(adaptationLength !== undefined ? { originalAdaptationLength: adaptationLength } : {}),
    };
}

function parseProgramMap(packets: readonly TransportPacket[]): ProgramMap {
    // H.222.0 §2.4.4.3/Table 2-30 assigns PAT to PID 0x0000 and table_id 0x00.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    const patPackets = packets.filter((packet) => packet.pid === 0 && packet.payloadUnitStart);
    if (patPackets.length === 0) {
        throw new Error("MPEG-TS segment does not contain a PAT.");
    }
    const pat = readPsiSection(patPackets[0], 0x00);
    // PAT syntax is 8 bytes through last_section_number, four bytes per program, then a four-byte CRC.
    if (pat.length < 12) {
        throw new Error("Invalid MPEG-TS PAT length.");
    }
    let programPid: number | undefined;
    for (let offset = 8; offset + 4 <= pat.length - 4; offset += 4) {
        const programNumber = pat.readUInt16BE(offset);
        if (programNumber !== 0) {
            // Table 2-30 stores the 13-bit program_map_PID after three bits not needed for routing.
            programPid = ((pat[offset + 2] & 0x1f) << 8) | pat[offset + 3];
            break;
        }
    }
    if (programPid === undefined) {
        throw new Error("MPEG-TS PAT does not identify a program map.");
    }

    const pmtPacket = packets.find((packet) => packet.pid === programPid && packet.payloadUnitStart);
    if (!pmtPacket) {
        throw new Error("MPEG-TS segment does not contain its PMT.");
    }
    // H.222.0 §2.4.4.8/Table 2-33 assigns PMT table_id 0x02; Apple SAMPLE-AES §3 requires it
    // to fit in one transport packet.
    // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/TransportStreamSignaling/TransportStreamSignaling.html
    const pmt = readPsiSection(pmtPacket, 0x02);
    // PMT syntax is 12 bytes through program_info_length plus a four-byte CRC, before any ES entries.
    if (pmt.length < 16) {
        throw new Error("Invalid MPEG-TS PMT length.");
    }
    const streams = new Map<number, ProtectedCodec>();
    const programInfoLength = ((pmt[10] & 0x0f) << 8) | pmt[11];
    let offset = 12 + programInfoLength;
    if (offset > pmt.length - 4) {
        throw new Error("Invalid MPEG-TS PMT program descriptor loop.");
    }
    while (offset < pmt.length - 4) {
        if (offset + 5 > pmt.length - 4) {
            throw new Error("Invalid MPEG-TS PMT elementary stream loop.");
        }
        const protectedStream = protectedCodecForStreamType(pmt[offset]);
        // Table 2-33 stores the 13-bit elementary_PID and 12-bit ES_info_length after bits not used here.
        const pid = ((pmt[offset + 1] & 0x1f) << 8) | pmt[offset + 2];
        const infoLength = ((pmt[offset + 3] & 0x0f) << 8) | pmt[offset + 4];
        if (offset + 5 + infoLength > pmt.length - 4) {
            throw new Error("Invalid MPEG-TS PMT descriptor loop.");
        }
        if (protectedStream) {
            // Descriptor contents (private indicators and audio setup) do not change SAMPLE-AES decryption.
            streams.set(pid, protectedStream);
        }
        offset += 5 + infoLength;
    }
    return { pid: programPid, streams };
}

function readPsiSection(packet: TransportPacket, expectedTableId: number): Buffer {
    const payloadPacket = readTransportPayload(packet);
    if (!payloadPacket) {
        throw new Error("MPEG-TS PSI packet does not contain a payload.");
    }
    const payload = packet.data.subarray(payloadPacket.payloadOffset);
    // H.222.0 §2.4.4.1/Table 2-29: on PUSI, pointer_field is one byte and counts to the first section byte.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    if (payload.length < 1) {
        throw new Error("Invalid MPEG-TS PSI pointer field.");
    }
    const sectionOffset = 1 + payload[0];
    if (sectionOffset + 3 > payload.length || payload[sectionOffset] !== expectedTableId) {
        throw new Error("Invalid MPEG-TS PSI section.");
    }
    // PAT/PMT Tables 2-30/2-33 place the 12-bit section_length in the low nibble plus the next byte;
    // it is needed only to bound this single-packet section and includes the trailing four-byte CRC_32.
    const sectionLength = ((payload[sectionOffset + 1] & 0x0f) << 8) | payload[sectionOffset + 2];
    const totalLength = 3 + sectionLength;
    if (sectionLength < 4 || sectionOffset + totalLength > payload.length) {
        // Apple SAMPLE-AES requires the PMT to fit in one TS packet; this transformer applies the same bound to PSI.
        throw new Error("Fragmented MPEG-TS PSI sections are not supported.");
    }
    const section = payload.subarray(sectionOffset, sectionOffset + totalLength);
    return section;
}

function decryptProtectedPid(
    packets: readonly TransportPacket[],
    pid: number,
    codec: ProtectedCodec,
    key: Buffer,
    iv: Buffer
): void {
    let current: PayloadPacket[] = [];
    let previousContinuity: number | undefined;
    for (const packet of packets) {
        if (packet.pid !== pid) {
            continue;
        }
        const payloadPacket = readTransportPayload(packet);
        if (!payloadPacket) {
            continue;
        }
        // H.222.0 §2.4.3.2 assigns transport_scrambling_control to byte-3 bits 7..6. Apple
        // SAMPLE-AES is sample-level encryption, so these transport-level bits must remain 00.
        // https://www.itu.int/rec/T-REC-H.222.0/en
        if ((payloadPacket.data[3] & 0xc0) !== 0) {
            throw new Error(`Transport-level scrambling is not supported for SAMPLE-AES PID ${pid}.`);
        }
        if (previousContinuity !== undefined && !payloadPacket.discontinuity) {
            // H.222.0 §2.4.3.2: continuity_counter is four bits and increments modulo 16 on payload packets.
            const expected = (previousContinuity + 1) & 0x0f;
            if (payloadPacket.continuityCounter !== expected) {
                throw new Error(`MPEG-TS continuity error on SAMPLE-AES PID ${pid}.`);
            }
        }
        previousContinuity = payloadPacket.continuityCounter;
        if (payloadPacket.payloadUnitStart) {
            if (current.length > 0) {
                decryptPes(current, codec, key, iv);
            }
            current = [payloadPacket];
        } else if (current.length > 0) {
            current.push(payloadPacket);
        } else {
            throw new Error(`SAMPLE-AES PID ${pid} starts with an incomplete PES packet.`);
        }
    }
    if (current.length === 0) {
        throw new Error(`SAMPLE-AES PID ${pid} does not contain a PES packet.`);
    }
    decryptPes(current, codec, key, iv);
}

function decryptPes(packets: readonly PayloadPacket[], codec: ProtectedCodec, key: Buffer, iv: Buffer): void {
    const available = Buffer.concat(packets.map((packet) => packet.data.subarray(packet.payloadOffset)));
    // H.222.0 §2.4.3.6/Table 2-21: PES starts with 24-bit packet_start_code_prefix 0x000001;
    // bytes 4..5 are the 16-bit PES_packet_length, and ordinary A/V PES optional headers start with marker bits 10.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    if (
        available.length < 9 ||
        available[0] !== 0 ||
        available[1] !== 0 ||
        available[2] !== 1 ||
        (available[6] & 0xc0) !== 0x80
    ) {
        throw new Error("Invalid SAMPLE-AES PES header.");
    }
    const declaredPacketLength = available.readUInt16BE(4);
    const pesLength = declaredPacketLength === 0 ? available.length : 6 + declaredPacketLength;
    if (pesLength > available.length) {
        throw new Error("SAMPLE-AES PES packet crosses the media-segment boundary.");
    }
    // Table 2-21 places the 8-bit PES_header_data_length at byte 8 after the six-byte fixed prefix.
    const headerLength = 9 + available[8];
    if (headerLength > pesLength) {
        throw new Error("Invalid SAMPLE-AES PES optional header length.");
    }
    const header = Buffer.from(available.subarray(0, headerLength));
    const encryptedPayload = available.subarray(headerLength, pesLength);
    const decryptedPayload =
        codec === "h264"
            ? decryptSampleAesH264(encryptedPayload, key, iv)
            : decryptSampleAesAudio(encryptedPayload, codec, key, iv);
    const decryptedPes = Buffer.concat([header, decryptedPayload]);
    if (declaredPacketLength !== 0) {
        // PES_packet_length is a 16-bit count starting immediately after its own field, hence the six-byte subtraction.
        const newLength = decryptedPes.length - 6;
        if (newLength > 0xffff) {
            throw new Error("Decrypted SAMPLE-AES PES packet is too large.");
        }
        decryptedPes.writeUInt16BE(newLength, 4);
    }
    rewritePesPayload(packets, decryptedPes);
}

function rewritePesPayload(packets: readonly PayloadPacket[], pes: Buffer): void {
    const totalCapacity = packets.reduce((total, packet) => total + (TS_PACKET_SIZE - packet.payloadOffset), 0);
    if (pes.length > totalCapacity) {
        throw new Error("Decrypted SAMPLE-AES PES packet exceeds its transport capacity.");
    }
    let sourceOffset = 0;
    for (const packet of packets) {
        const originalPayloadCapacity = TS_PACKET_SIZE - packet.payloadOffset;
        const payloadLength = Math.min(originalPayloadCapacity, pes.length - sourceOffset);
        const payload = pes.subarray(sourceOffset, sourceOffset + payloadLength);
        rewriteTransportPayload(packet, payload, originalPayloadCapacity - payloadLength);
        sourceOffset += payloadLength;
    }
    if (sourceOffset !== pes.length) {
        throw new Error("Failed to publish the complete decrypted SAMPLE-AES PES packet.");
    }
}

function rewriteTransportPayload(packet: PayloadPacket, payload: Buffer, extraStuffing: number): void {
    const data = packet.data;
    // H.222.0 Table 2-2: clear transport_scrambling_control is 00 (mask 0x3f); adaptation_field_control
    // is 01 for payload-only (0x10) or 11 for adaptation+payload (0x30), preserving the continuity nibble.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    data[3] &= 0x3f;
    const adaptationLength = packet.originalAdaptationLength;
    let payloadOffset: number;
    if (adaptationLength === undefined) {
        if (extraStuffing === 0) {
            data[3] = (data[3] & 0xcf) | 0x10;
            payloadOffset = 4;
        } else {
            data[3] = (data[3] & 0xcf) | 0x30;
            data[4] = extraStuffing - 1;
            if (extraStuffing > 1) {
                data[5] = 0;
                // H.222.0 §2.4.3.4 requires unused adaptation-field stuffing bytes to be 0xff.
                data.fill(0xff, 6, 4 + extraStuffing);
            }
            payloadOffset = 4 + extraStuffing;
        }
    } else {
        const newAdaptationLength = adaptationLength + extraStuffing;
        if (newAdaptationLength > 183) {
            throw new Error("Unable to fit SAMPLE-AES transport stuffing.");
        }
        data[3] = (data[3] & 0xcf) | 0x30;
        data[4] = newAdaptationLength;
        if (adaptationLength === 0 && newAdaptationLength > 0) {
            // Table 2-6: a zero-length field has no flags byte; growing it must add a zero flags byte before 0xff stuffing.
            data[5] = 0;
            data.fill(0xff, 6, 5 + newAdaptationLength);
        } else {
            data.fill(0xff, 5 + adaptationLength, 5 + newAdaptationLength);
        }
        payloadOffset = 5 + newAdaptationLength;
    }
    payload.copy(data, payloadOffset);
    if (payloadOffset + payload.length !== TS_PACKET_SIZE) {
        throw new Error("Invalid rewritten MPEG-TS packet size.");
    }
}

function rewriteProgramMaps(packets: readonly TransportPacket[], pmtPid: number): void {
    for (const packet of packets) {
        if (packet.pid !== pmtPid || !packet.payloadUnitStart) {
            continue;
        }
        // H.222.0 §2.4.4.8/Table 2-33: PMT program_info_length begins at bytes 10..11 and each
        // elementary-stream entry is five fixed bytes followed by ES_info_length descriptor bytes.
        // https://www.itu.int/rec/T-REC-H.222.0/en
        const pmt = readPsiSection(packet, 0x02);
        if (pmt.length < 16) {
            throw new Error("Invalid MPEG-TS PMT length.");
        }
        const programInfoLength = ((pmt[10] & 0x0f) << 8) | pmt[11];
        let offset = 12 + programInfoLength;
        if (offset > pmt.length - 4) {
            throw new Error("Invalid MPEG-TS PMT program descriptor loop.");
        }
        while (offset < pmt.length - 4) {
            if (offset + 5 > pmt.length - 4) {
                throw new Error("Invalid MPEG-TS PMT elementary stream loop.");
            }
            const infoLength = ((pmt[offset + 3] & 0x0f) << 8) | pmt[offset + 4];
            if (offset + 5 + infoLength > pmt.length - 4) {
                throw new Error("Invalid MPEG-TS PMT descriptor loop.");
            }
            const clearType = clearStreamType(pmt[offset]);
            if (clearType !== undefined) {
                pmt[offset] = clearType;
            }
            offset += 5 + infoLength;
        }
        pmt.writeUInt32BE(mpegCrc32(pmt.subarray(0, pmt.length - 4)), pmt.length - 4);
    }
}

function protectedCodecForStreamType(streamType: number): ProtectedCodec | undefined {
    // Apple SAMPLE-AES §3 assigns protected PMT stream_type values 0xdb, 0xcf, 0xc1, and 0xc2.
    // Descriptor contents are intentionally ignored because they do not affect the decryption algorithm.
    // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/TransportStreamSignaling/TransportStreamSignaling.html
    switch (streamType) {
        case 0xdb:
            return "h264";
        case 0xcf:
            return "aac";
        case 0xc1:
            return "ac3";
        case 0xc2:
            return "eac3";
        default:
            return undefined;
    }
}

function clearStreamType(streamType: number): number | undefined {
    // H.222.0 Table 2-35 assigns clear AVC 0x1b and ISO/IEC 13818-7 ADTS AAC 0x0f.
    // ATSC A/53 Part 3 §5.7 assigns clear AC-3 0x81 and E-AC-3 0x87 for decoder compatibility.
    // Apple SAMPLE-AES §3 defines the corresponding protected input values used in each case below.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    // https://www.atsc.org/wp-content/uploads/2023/02/A53-Part-3-2023-02.pdf
    // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/TransportStreamSignaling/TransportStreamSignaling.html
    switch (streamType) {
        case 0xdb:
            return 0x1b;
        case 0xcf:
            return 0x0f;
        case 0xc1:
            return 0x81;
        case 0xc2:
            return 0x87;
        default:
            return undefined;
    }
}

export function mpegCrc32(data: Uint8Array): number {
    // H.222.0 Annex A: CRC_32 starts with all ones, consumes each byte MSB-first, uses generator
    // x^32+x^26+x^23+x^22+x^16+x^12+x^11+x^10+x^8+x^7+x^5+x^4+x^2+x+1 (0x04c11db7), and has no final XOR.
    // https://www.itu.int/rec/T-REC-H.222.0/en
    let crc = 0xffffffff;
    for (const value of data) {
        crc = (crc ^ (value << 24)) >>> 0;
        for (let bit = 0; bit < 8; bit++) {
            crc = ((crc << 1) ^ ((crc & 0x80000000) !== 0 ? 0x04c11db7 : 0)) >>> 0;
        }
    }
    return crc >>> 0;
}
