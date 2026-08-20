import { describe, expect, test } from "bun:test";

// Runes aren't compiled here, so `$state` is stubbed as identity (same pattern
// as shell.test.ts / whiteboard.test.ts).
const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { modal } = await import("./modal.svelte");

describe("modal.confirm", () => {
    test("resolves true when the user accepts", async () => {
        const pending = modal.confirm({
            title: "Skip problem",
            message: "Are you sure?",
            confirmLabel: "Skip",
        });

        expect(modal.activeModal).not.toBeNull();
        expect(modal.activeModal?.options?.title).toBe("Skip problem");
        modal.activeModal?.props?.onDecide(true);

        await expect(pending).resolves.toBe(true);
        expect(modal.activeModal).toBeNull();
    });

    test("resolves false when the user cancels or dismisses", async () => {
        const pending = modal.confirm({
            message: "Delete this?",
            confirmVariant: "destructive",
        });

        expect(modal.activeModal?.options?.title).toBe("Confirm");
        modal.activeModal?.props?.onDecide(false);

        await expect(pending).resolves.toBe(false);
        expect(modal.activeModal).toBeNull();
    });

    test("resolves false when the modal is closed without deciding", async () => {
        const pending = modal.confirm({ message: "Continue?" });
        modal.close();
        await expect(pending).resolves.toBe(false);
    });
});
