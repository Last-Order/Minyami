export function timeStringToSeconds(timeString: string): number {
    const parts = timeString.split(":");
    if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) {
        throw new Error("Invalid time string");
    }
    return parts.reduce((seconds, part) => seconds * 60 + Number(part), 0);
}
