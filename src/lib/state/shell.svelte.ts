/**
 * App-shell chrome that routes can temporarily take over.
 *
 * Today that is just the mobile bottom nav: a full-screen surface with its own
 * bottom bar (the trainer) hides the nav bar for as long as it is mounted, so
 * the two bars never stack. Suppression is ref-counted rather than a boolean so
 * overlapping owners can't restore the bar out from under each other.
 *
 * The count itself is deliberately NOT reactive. Owners register from an
 * `$effect`, and a `$state` counter would make that effect read the same signal
 * its `+=` writes — a self-triggering loop. Only the derived visibility flag is
 * reactive, and it is assigned solely on a real transition, so registering never
 * invalidates the registrant.
 */
class ShellStore {
    #navSuppressors = 0;
    #navHidden = $state(false);

    /** Whether the mobile bottom nav should render. */
    get mobileNavVisible() {
        return !this.#navHidden;
    }

    /** Hide the mobile bottom nav; call the returned disposer to release. */
    suppressMobileNav(): () => void {
        this.#navSuppressors += 1;
        if (this.#navSuppressors === 1) this.#navHidden = true;

        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.#navSuppressors -= 1;
            if (this.#navSuppressors === 0) this.#navHidden = false;
        };
    }
}

export const shell = new ShellStore();
