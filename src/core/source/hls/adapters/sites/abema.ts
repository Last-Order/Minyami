import { HLSSiteAdapter } from "./types";

export const abemaAdapter: HLSSiteAdapter = {
    id: "abema",
    matches: ({ playlist }) => playlist.keys.some((key) => key.id.startsWith("abematv-license")),
    prepare: () => ({
        // Apply the filter to every snapshot because live playlists may introduce new placeholders and advertisements.
        adaptSegments: (segments) =>
            segments.filter((segment) => !segment.url.includes("/tspgsl/") && !segment.url.includes("/tsad/")),
    }),
};
