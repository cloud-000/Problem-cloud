import { beforeEach, describe, expect, test } from "bun:test";
import { mapOnboardingRow, resetOnboardingRowCache, saveOnboarding } from "./data";
import { emptyOnboarding } from "./types";
import { skipWelcome } from "./welcome";

type InsertResult = { error: { code: string; message: string } | null };
type UpdateResult = { error: { code: string; message: string } | null };

function mockClient(options: {
    insert: InsertResult;
    update?: UpdateResult;
}) {
    const calls: { method: "add-row" | "patch-row"; payload: unknown }[] = [];
    const client = {
        calls,
        from(table: string) {
            expect(table).toBe("user_onboarding");
            return {
                insert(payload: unknown) {
                    calls.push({ method: "add-row", payload });
                    return Promise.resolve(options.insert);
                },
                update(payload: unknown) {
                    calls.push({ method: "patch-row", payload });
                    return {
                        eq(column: string, value: string) {
                            expect(column).toBe("user_id");
                            expect(value).toBe("user-1");
                            return Promise.resolve(options.update ?? { error: null });
                        },
                    };
                },
            };
        },
    };
    return client;
}

describe("saveOnboarding", () => {
    const state = skipWelcome(emptyOnboarding(), "2026-08-31T12:00:00.000Z");

    beforeEach(() => {
        resetOnboardingRowCache();
    });

    test("inserts a new row instead of upserting", async () => {
        const client = mockClient({ insert: { error: null } });
        await saveOnboarding(client as never, "user-1", state);
        expect(client.calls.map((call) => call.method)).toEqual(["add-row"]);
        const row = client.calls[0]?.payload as { user_id: string; welcome_status: string };
        expect(row.user_id).toBe("user-1");
        expect(row.welcome_status).toBe("dismissed");
        expect(row).not.toHaveProperty("created_at");
    });

    test("updates when the insert collides on user_id", async () => {
        const client = mockClient({
            insert: { error: { code: "23505", message: "duplicate" } },
            update: { error: null },
        });
        await saveOnboarding(client as never, "user-1", state);
        expect(client.calls.map((call) => call.method)).toEqual(["add-row", "patch-row"]);
        const patch = client.calls[1]?.payload as { welcome_status: string; user_id?: string };
        expect(patch.welcome_status).toBe("dismissed");
        expect(patch.user_id).toBeUndefined();
    });

    test("throws other insert errors", async () => {
        const client = mockClient({
            insert: { error: { code: "42501", message: "permission denied" } },
        });
        await expect(saveOnboarding(client as never, "user-1", state)).rejects.toMatchObject({
            code: "42501",
        });
        expect(client.calls.map((call) => call.method)).toEqual(["add-row"]);
    });

    test("updates directly after the row is known", async () => {
        const client = mockClient({
            insert: { error: null },
            update: { error: null },
        });
        await saveOnboarding(client as never, "user-1", state);
        await saveOnboarding(client as never, "user-1", state);
        expect(client.calls.map((call) => call.method)).toEqual(["add-row", "patch-row"]);
    });
});

describe("mapOnboardingRow", () => {
    test("falls back to defaults for unknown status or version", () => {
        const mapped = mapOnboardingRow({
            user_id: "user-1",
            content_version: 0,
            welcome_status: "nope",
            last_completed_tour_step: null,
            getting_started_dismissed_at: null,
            acknowledged_tips: null as unknown as string[],
            welcome_started_at: null,
            welcome_completed_at: null,
            welcome_dismissed_at: null,
            created_at: "2026-08-31T12:00:00.000Z",
            updated_at: "2026-08-31T12:00:00.000Z",
        });
        expect(mapped.contentVersion).toBe(1);
        expect(mapped.welcomeStatus).toBe("unseen");
        expect(mapped.acknowledgedTips).toEqual([]);
    });
});
