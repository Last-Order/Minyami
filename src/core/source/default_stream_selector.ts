import { StreamCatalog, TrackSelection } from "./stream_selection";

/** Selects the highest-bandwidth compatible option without consulting a user interface. */
export function selectDefaultStream(catalog: StreamCatalog): TrackSelection | undefined {
    const option = [...catalog.options].sort((a, b) => effectiveBandwidth(b) - effectiveBandwidth(a))[0];
    if (!option?.tracks.some((track) => track.type === "subtitle")) {
        return option?.tracks;
    }
    const [primary, ...otherTracks] = option.tracks.filter((track) => track.type !== "subtitle");
    return primary ? [primary, ...otherTracks] : option.tracks;
}

function effectiveBandwidth(option: StreamCatalog["options"][number]): number {
    if (option.bandwidth !== undefined) {
        return option.bandwidth;
    }
    return option.tracks.reduce((total, track) => total + (track.bandwidth ?? 0), 0);
}
