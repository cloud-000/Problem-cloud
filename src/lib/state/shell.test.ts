import { describe, expect, test } from "bun:test";

// Runes aren't compiled here, so `$state` is stubbed as identity (same pattern
// as whiteboard.test.ts). That covers the ref-counting below; the reason the
// count is a plain field rather than `$state` — an `$effect` registering itself
// must not read the signal it writes — is a reactivity property this
// environment can't observe. See the comment in shell.svelte.ts.
const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { shell } = await import("./shell.svelte");

describe("shell.suppressMobileNav", () => {
    test("hides the nav until every owner releases", () => {
        expect(shell.mobileNavVisible).toBe(true);

        const releaseA = shell.suppressMobileNav();
        const releaseB = shell.suppressMobileNav();
        expect(shell.mobileNavVisible).toBe(false);

        releaseA();
        // B still holds it: overlapping owners must not restore the bar early.
        expect(shell.mobileNavVisible).toBe(false);

        releaseB();
        expect(shell.mobileNavVisible).toBe(true);
    });

    test("a disposer is idempotent", () => {
        const release = shell.suppressMobileNav();
        release();
        release();
        expect(shell.mobileNavVisible).toBe(true);

        // A stale double-release must not have driven the count negative and
        // left the next owner unable to hide the bar.
        const next = shell.suppressMobileNav();
        expect(shell.mobileNavVisible).toBe(false);
        next();
        expect(shell.mobileNavVisible).toBe(true);
    });
});
