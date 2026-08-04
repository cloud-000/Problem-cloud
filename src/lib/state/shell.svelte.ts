/**
 * App-shell chrome that routes can temporarily take over.
 *
 * Suppression is ref-counted rather than a boolean so overlapping owners can't
 * restore a surface out from under each other.
 *
 * The count itself is deliberately NOT reactive. Owners register from an
 * `$effect`, and a `$state` counter would make that effect read the same signal
 * its `+=` writes — a self-triggering loop. Only the derived visibility flag is
 * reactive, and it is assigned solely on a real transition, so registering never
 * invalidates the registrant.
 */
class Suppressor {
    #count = 0;
    #suppressed = $state(false);

    get suppressed(): boolean {
        return this.#suppressed;
    }

    /** Suppress; call the returned disposer to release. Disposers are idempotent. */
    acquire(): () => void {
        this.#count += 1;
        if (this.#count === 1) this.#suppressed = true;

        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.#count -= 1;
            if (this.#count === 0) this.#suppressed = false;
        };
    }
}

class ShellStore {
    #nav = new Suppressor();
    #coach = new Suppressor();
    #coachLauncher = new Suppressor();

    /** Whether the mobile bottom nav should render. */
    get mobileNavVisible() {
        return !this.#nav.suppressed;
    }

    /**
     * Whether the Coach may be summoned here at all — gates the FAB *and* the
     * global Ctrl/Cmd+J. Exists because once the chord is global the layout can
     * no longer see route-local rules like the trainer's mid-test lock, and a
     * local handler whose only job is swallowing the chord would be worse.
     */
    get coachAvailable() {
        return !this.#coach.suppressed;
    }

    /**
     * Whether the floating Coach launcher (FAB) should render. Distinct from
     * `coachAvailable`: a surface that draws its own Coach entry point, or has
     * no room for a FAB, hides the button without turning the Coach off.
     */
    get coachLauncherVisible() {
        return !this.#coachLauncher.suppressed && !this.#coach.suppressed;
    }

    /**
     * Hide the mobile bottom nav — for a full-screen surface with its own bottom
     * bar (the trainer), so the two never stack.
     */
    suppressMobileNav(): () => void {
        return this.#nav.acquire();
    }

    /** "Coach is off-limits here." Gates the FAB and the global chord. */
    suppressCoach(): () => void {
        return this.#coach.acquire();
    }

    /** "This surface draws its own entry point, or has no room for a FAB." Gates the FAB only. */
    suppressCoachLauncher(): () => void {
        return this.#coachLauncher.acquire();
    }
}

export const shell = new ShellStore();
