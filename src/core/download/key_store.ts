export class KeyStore {
    private readonly keys = new Map<string, string>();

    set(url: string, key: string): void {
        this.keys.set(url, key);
    }

    get(url: string): string | undefined {
        return this.keys.get(url);
    }

    has(url: string): boolean {
        return this.keys.has(url);
    }

    setMany(keys: Record<string, string>): void {
        for (const [url, key] of Object.entries(keys)) {
            this.set(url, key);
        }
    }
}
