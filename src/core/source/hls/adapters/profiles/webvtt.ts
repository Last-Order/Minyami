import { WEBVTT_CONTAINER } from "@/core/media_container";
import { createHLSKeyResolver } from "@/core/source/hls/key_resolver";
import { DownloadOutputTransform } from "@/core/source/types";
import { toAes128DownloadItem } from "./single_file";
import { HLSProfileAdapter } from "./types";

export const webVttHLSProfile: HLSProfileAdapter = {
    id: "webvtt",
    prepare: ({ explicitKeys, http }) => {
        const keys = createHLSKeyResolver(explicitKeys, http);
        return {
            id: "webvtt",
            container: WEBVTT_CONTAINER,
            ensureKeys: async (playlist, context) => {
                if (playlist.segments.some((segment) => segment.encryption?.method === "SAMPLE-AES")) {
                    throw new Error("SAMPLE-AES is not supported for HLS WebVTT subtitles.");
                }
                await keys.ensure(playlist, context);
            },
            toDownloadItem: toAes128DownloadItem,
            createOutputTransform: createWebVttOutputTransform,
        };
    },
};

const TIMESTAMP = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/;
const CUE_TIMING = /^(\S+)[ \t]+-->[ \t]+(\S+)([ \t].*)?$/;
const INLINE_TIMESTAMP = /<((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})>/g;
const WEBVTT = /^WEBVTT(?:[ \t].*)?$/;

function timestampMs(value: string): number {
    const match = TIMESTAMP.exec(value);
    if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) {
        throw new Error(`Invalid WebVTT timestamp: ${value}.`);
    }
    const milliseconds = ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000;
    if (!Number.isSafeInteger(milliseconds + Number(match[4]))) {
        throw new Error(`WebVTT timestamp is out of range: ${value}.`);
    }
    return milliseconds + Number(match[4]);
}

function formatTimestamp(milliseconds: number): string {
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor(milliseconds / 60000) % 60;
    const seconds = Math.floor(milliseconds / 1000) % 60;
    const time = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
    return `${time}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

function splitWebVtt(data: Buffer): { header?: string; blocks: string[] } {
    const text = data
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .trimEnd();
    const blocks = text ? text.split(/\n(?:[ \t]*\n)+/) : [];
    if (blocks.length && WEBVTT.test(blocks[0].split("\n")[0])) {
        return { header: blocks[0], blocks: blocks.slice(1) };
    }
    return { blocks };
}

function timestampOffsetMs(header: string): number {
    const map = header.split("\n").find((line) => line.startsWith("X-TIMESTAMP-MAP="));
    if (!map) {
        return 0;
    }
    const values = map.slice("X-TIMESTAMP-MAP=".length).split(",");
    const local = values.find((value) => value.startsWith("LOCAL:"))?.slice("LOCAL:".length);
    const mpegTs = values.find((value) => value.startsWith("MPEGTS:"))?.slice("MPEGTS:".length);
    if (!local || !mpegTs || !/^\d+$/.test(mpegTs) || Number(mpegTs) >= 2 ** 33) {
        throw new Error("Invalid WebVTT X-TIMESTAMP-MAP.");
    }
    return Number(mpegTs) / 90 - timestampMs(local);
}

/** A VOD track uses one media timeline. Its time origin stays shared with the audio and video mux inputs. */
export function createWebVttOutputTransform(): DownloadOutputTransform {
    let headerWritten = false;
    let previousCues = new Set<string>();
    const definitions = new Set<string>();

    return (data, prefixes) => {
        const initialization = prefixes[0] ? splitWebVtt(prefixes[0]) : undefined;
        const segment = splitWebVtt(data);
        const header = segment.header ?? initialization?.header;
        if (!header) {
            throw new Error("Expected a WebVTT header in the subtitle segment or its EXT-X-MAP.");
        }
        const offset = timestampOffsetMs(header);
        const newCues = new Set<string>();
        const cues: string[] = [];
        for (const block of [...(initialization?.blocks ?? []), ...segment.blocks]) {
            if (/^NOTE(?:[ \t\n]|$)/.test(block)) {
                continue;
            }
            if (/^(?:STYLE|REGION)\n/.test(block)) {
                if (headerWritten && !definitions.has(block)) {
                    throw new Error("WebVTT STYLE or REGION definitions changed after the output header.");
                }
                definitions.add(block);
                continue;
            }
            const lines = block.split("\n");
            const index = lines[0].includes("-->") ? 0 : 1;
            const timing = CUE_TIMING.exec(lines[index] ?? "");
            if (!timing) {
                throw new Error("Invalid WebVTT cue in subtitle segment.");
            }
            const start = timestampMs(timing[1]);
            const end = timestampMs(timing[2]);
            if (end <= start) {
                throw new Error("WebVTT cue end time must follow its start time.");
            }
            const mappedStart = Math.max(0, Math.round(start + offset));
            const mappedEnd = Math.round(end + offset);
            if (mappedEnd <= mappedStart) {
                continue;
            }
            lines[index] = `${formatTimestamp(mappedStart)} --> ${formatTimestamp(mappedEnd)}${timing[3] ?? ""}`;
            for (let lineIndex = index + 1; lineIndex < lines.length; lineIndex++) {
                lines[lineIndex] = lines[lineIndex].replace(INLINE_TIMESTAMP, (_, value: string) => {
                    const timestamp = Math.round(timestampMs(value) + offset);
                    return timestamp > mappedStart && timestamp < mappedEnd ? `<${formatTimestamp(timestamp)}>` : "";
                });
            }
            const cue = lines.join("\n");
            if (!previousCues.has(cue) && !newCues.has(cue)) {
                cues.push(cue);
            }
            newCues.add(cue);
        }
        // A cue crossing a boundary may appear with the same full interval in both fragments.
        previousCues = newCues;
        if (!headerWritten) {
            headerWritten = true;
            return Buffer.from(["WEBVTT", ...definitions, ...cues, ""].join("\n\n"));
        }
        return Buffer.from(cues.length ? [...cues, ""].join("\n\n") : "");
    };
}
