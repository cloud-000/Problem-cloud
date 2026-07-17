import { browser } from "$app/environment";
import { AI_PROVIDER_PRESETS } from "$lib/ai/presets";
import type { AIConnectionCredential, AIPresetId, StoredAIConnection } from "$lib/ai/types";

/**
 * Browser-held AI connections, including their API keys.
 *
 * Keys deliberately never reach the database. They live in localStorage and ride along
 * on each /api/ai request, where the server uses them in memory and discards them. The
 * trade-off is honest and must stay visible in the settings UI: localStorage has no
 * httpOnly equivalent, so any XSS on this app can read every key here.
 */

const STORAGE_KEY = "settings:aiConnections";
const ID_PATTERN = /^[a-z0-9_-]{1,40}$/;

/** Mirrors the server's `parseConnectionCredential`; bad rows are dropped, not thrown. */
function reviveConnection(value: unknown): StoredAIConnection | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const preset = row.preset as AIPresetId;
    if (!ID_PATTERN.test(id) || id === "mock") return null;
    if (!preset || !(preset in AI_PROVIDER_PRESETS)) return null;
    if (typeof row.baseURL !== "string" || typeof row.label !== "string") return null;
    return {
        id,
        preset,
        label: row.label,
        baseURL: row.baseURL,
        apiKey: typeof row.apiKey === "string" ? row.apiKey : "",
        models: Array.isArray(row.models) ? row.models.filter((m) => typeof m === "string") : undefined,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    };
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
}

class AICredentialStore {
    #connections = $state<StoredAIConnection[]>([]);

    constructor() {
        if (browser) {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const parsed: unknown = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        this.#connections = parsed
                            .map(reviveConnection)
                            .filter((entry): entry is StoredAIConnection => entry !== null);
                    }
                }
            } catch (_) {}
        }
    }

    #persist(): void {
        if (!browser) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#connections));
        } catch (_) {}
    }

    get connections(): readonly StoredAIConnection[] {
        return this.#connections;
    }

    get hasAny(): boolean {
        return this.#connections.length > 0;
    }

    /** The wire shape sent to the server: local bookkeeping stripped. */
    get wireConnections(): AIConnectionCredential[] {
        return this.#connections.map(({ createdAt: _createdAt, ...credential }) => credential);
    }

    get(id: string): StoredAIConnection | undefined {
        return this.#connections.find((connection) => connection.id === id);
    }

    /** A preset connects once under its own id; custom endpoints derive one from the label. */
    #allocateId(preset: AIPresetId, label: string): string {
        const base = preset === "custom" ? `custom-${slugify(label) || "endpoint"}` : preset;
        if (!this.get(base)) return base;
        for (let suffix = 2; suffix < 100; suffix += 1) {
            const candidate = `${base}-${suffix}`.slice(0, 40);
            if (!this.get(candidate)) return candidate;
        }
        return `${base}-${Date.now()}`.slice(0, 40);
    }

    add(input: Omit<StoredAIConnection, "id" | "createdAt">): string {
        const id = this.#allocateId(input.preset, input.label);
        this.#connections = [
            ...this.#connections,
            { ...input, id, createdAt: new Date().toISOString() },
        ];
        this.#persist();
        return id;
    }

    update(id: string, patch: Partial<Omit<StoredAIConnection, "id" | "createdAt">>): void {
        this.#connections = this.#connections.map((connection) =>
            connection.id === id ? { ...connection, ...patch } : connection,
        );
        this.#persist();
    }

    remove(id: string): void {
        this.#connections = this.#connections.filter((connection) => connection.id !== id);
        this.#persist();
    }

    /** Enough of the key to recognize it, never enough to use it. */
    maskedKey(id: string): string {
        const key = this.get(id)?.apiKey ?? "";
        if (!key) return "No key";
        return key.length <= 8 ? "•".repeat(key.length) : `${key.slice(0, 3)}…${key.slice(-4)}`;
    }
}

export const aiCredentials = new AICredentialStore();
