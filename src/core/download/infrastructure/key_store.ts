export class KeyStore {
    private readonly keys = new Map<string, string>();

    set(id: string, key: string): void {
        this.keys.set(id, key);
    }

    get(id: string): string | undefined {
        return this.keys.get(id);
    }

    has(id: string): boolean {
        return this.keys.has(id);
    }

    setMany(keys: Readonly<Record<string, string>>): void {
        for (const [id, key] of Object.entries(keys)) {
            this.set(id, key);
        }
    }
}
