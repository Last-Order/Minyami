import { SiteAdapter } from "./types";

export const abemaAdapter: SiteAdapter = {
    matches: ({ playlist }) => playlist.keys[0]?.id.startsWith("abematv-license") ?? false,
    prepare: () => ({
        // Apply this on every refresh because Abema may insert placeholders and advertisements into live playlists.
        adaptSegments: (segments) =>
            segments.filter((segment) => !segment.url.includes("/tspgsl/") && !segment.url.includes("/tsad/")),
    }),
};
