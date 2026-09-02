import type { PracticeSettings } from "$lib/trainer";

export type GuestSession = {
    id: number;
    name: string | null;
    status: "active" | "ended";
    started_at: string;
    ended_at: string | null;
    settings: PracticeSettings;
    current_problem_id: number | null;
    current_elapsed_ms: number;
    draft: { problemId: number; answer: string; selectedChoice: number | null } | null;
    times_seen: number;
    times_reviewed: number;
    times_correct: number;
    times_skipped: number;
    total_time_ms: number;
};

export type GuestAttempt = {
    id?: number;
    sessionId: number;
    canonicalId: number;
    selectedChoice: number | null;
    answer: string;
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
    triesUsed: number;
    createdAt: string;
};

const DB_NAME = "problem-cloud-guest-practice";
const DB_VERSION = 1;

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error ?? new Error("Guest storage failed."));
    });
}

function complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Guest storage failed."));
        tx.onabort = () => reject(tx.error ?? new Error("Guest storage was aborted."));
    });
}

/** Browser-local guest practice only. This database never carries an account id. */
export class GuestPracticeRepository {
    #db: IDBDatabase;

    private constructor(db: IDBDatabase) {
        this.#db = db;
    }

    static async open(): Promise<GuestPracticeRepository> {
        if (typeof indexedDB === "undefined") {
            throw new Error("This browser cannot save guest practice because IndexedDB is unavailable.");
        }
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("sessions")) {
                db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
            }
            if (!db.objectStoreNames.contains("attempts")) {
                const attempts = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
                attempts.createIndex("sessionId", "sessionId", { unique: false });
                attempts.createIndex("canonicalId", "canonicalId", { unique: false });
            }
        };
        try {
            return new GuestPracticeRepository(await request(open));
        } catch (error) {
            throw new Error(`Could not open guest practice storage: ${String(error)}`);
        }
    }

    async sessions(): Promise<GuestSession[]> {
        const tx = this.#db.transaction("sessions", "readonly");
        const rows = await request(tx.objectStore("sessions").getAll()) as GuestSession[];
        await complete(tx);
        return rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
    }

    async session(id: number): Promise<GuestSession | null> {
        const tx = this.#db.transaction("sessions", "readonly");
        const row = await request(tx.objectStore("sessions").get(id)) as GuestSession | undefined;
        await complete(tx);
        return row ?? null;
    }

    async create(input: { name?: string | null; settings: PracticeSettings }): Promise<GuestSession> {
        const now = new Date().toISOString();
        const row: Omit<GuestSession, "id"> = {
            name: input.name ?? null,
            status: "active",
            started_at: now,
            ended_at: null,
            settings: input.settings,
            current_problem_id: null,
            current_elapsed_ms: 0,
            draft: null,
            times_seen: 0,
            times_reviewed: 0,
            times_correct: 0,
            times_skipped: 0,
            total_time_ms: 0,
        };
        const tx = this.#db.transaction("sessions", "readwrite");
        const id = await request(tx.objectStore("sessions").add(row));
        await complete(tx);
        return { ...row, id: id as number };
    }

    async save(session: GuestSession): Promise<void> {
        const tx = this.#db.transaction("sessions", "readwrite");
        await request(tx.objectStore("sessions").put(session));
        await complete(tx);
    }

    async remove(id: number): Promise<void> {
        const tx = this.#db.transaction(["sessions", "attempts"], "readwrite");
        tx.objectStore("sessions").delete(id);
        const index = tx.objectStore("attempts").index("sessionId");
        const cursor = index.openCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
            const value = cursor.result;
            if (!value) return;
            value.delete();
            value.continue();
        };
        await complete(tx);
    }

    async attempts(sessionId: number): Promise<GuestAttempt[]> {
        const tx = this.#db.transaction("attempts", "readonly");
        const rows = await request(tx.objectStore("attempts").index("sessionId").getAll(sessionId)) as GuestAttempt[];
        await complete(tx);
        return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async record(attempt: GuestAttempt): Promise<void> {
        const tx = this.#db.transaction(["sessions", "attempts"], "readwrite");
        await request(tx.objectStore("attempts").add(attempt));
        const session = await request(tx.objectStore("sessions").get(attempt.sessionId)) as GuestSession | undefined;
        if (!session) throw new Error("This guest practice session no longer exists.");
        session.current_problem_id = null;
        session.current_elapsed_ms = 0;
        session.draft = null;
        session.times_seen += 1;
        session.times_skipped += attempt.skipped ? 1 : 0;
        session.times_reviewed += attempt.isCorrect == null ? 0 : 1;
        session.times_correct += attempt.isCorrect === true ? 1 : 0;
        session.total_time_ms += Math.max(0, Math.round(attempt.elapsedMs));
        await request(tx.objectStore("sessions").put(session));
        await complete(tx);
    }
}

let repository: Promise<GuestPracticeRepository> | null = null;
export function guestPracticeRepository(): Promise<GuestPracticeRepository> {
    repository ??= GuestPracticeRepository.open();
    return repository;
}
