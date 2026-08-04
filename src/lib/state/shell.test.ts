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

describe("shell Coach suppressors", () => {
    test("each ref-counts independently", () => {
        expect(shell.coachAvailable).toBe(true);
        expect(shell.coachLauncherVisible).toBe(true);

        const coachA = shell.suppressCoach();
        const coachB = shell.suppressCoach();
        expect(shell.coachAvailable).toBe(false);

        coachA();
        expect(shell.coachAvailable).toBe(false);
        coachB();
        expect(shell.coachAvailable).toBe(true);

        const launcherA = shell.suppressCoachLauncher();
        const launcherB = shell.suppressCoachLauncher();
        expect(shell.coachLauncherVisible).toBe(false);

        launcherA();
        expect(shell.coachLauncherVisible).toBe(false);
        launcherB();
        expect(shell.coachLauncherVisible).toBe(true);
    });

    test("suppressing the launcher leaves the Coach itself summonable", () => {
        // The trainer draws its own Coach control, so it hides the FAB without
        // turning the chord off. Collapsing the two would break that.
        const release = shell.suppressCoachLauncher();
        expect(shell.coachLauncherVisible).toBe(false);
        expect(shell.coachAvailable).toBe(true);
        release();
    });

    test("suppressing the Coach also hides the launcher", () => {
        const release = shell.suppressCoach();
        expect(shell.coachAvailable).toBe(false);
        expect(shell.coachLauncherVisible).toBe(false);
        release();
        expect(shell.coachLauncherVisible).toBe(true);
    });

    test("the mobile nav is unaffected by either", () => {
        const coach = shell.suppressCoach();
        const launcher = shell.suppressCoachLauncher();
        expect(shell.mobileNavVisible).toBe(true);
        coach();
        launcher();
    });

    test("Coach disposers are idempotent", () => {
        const release = shell.suppressCoach();
        release();
        release();
        expect(shell.coachAvailable).toBe(true);

        const next = shell.suppressCoach();
        expect(shell.coachAvailable).toBe(false);
        next();
        expect(shell.coachAvailable).toBe(true);
    });
});
