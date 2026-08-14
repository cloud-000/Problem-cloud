function persisted(key: string, initial: boolean): boolean {
    if (typeof window === "undefined") return initial;
    try {
        const saved = localStorage.getItem(key);
        return saved === null ? initial : saved === "true";
    } catch (_) {
        return initial;
    }
}

function persist(key: string, value: boolean): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(key, String(value));
    } catch (_) {}
}

class SettingsStore {
    #downloadedOnly = $state(persisted("settings:downloadedOnly", false));
    #showBetaFeatures = $state(persisted("settings:showBetaFeatures", false));
    /**
     * The account-wide master switch, owned by the settings page. It does not *show*
     * any inspector by itself — it decides whether a screen offers its debug affordance
     * at all (the trainer's Debug menu item, the Coach's system-prompt reveal); each
     * surface still has its own local toggle. Kept separate from `showBetaFeatures`,
     * which gates unfinished *product*: debug surfaces show internals and are not
     * something a student is meant to opt into by asking for early features.
     */
    #debugMode = $state(persisted("settings:debugMode", false));
    /**
     * The Coach's debug affordance: render the system and per-turn context rows in the
     * finalized model request captured at the provider boundary. Only reachable while
     * `debugMode` is on, and off by default so turning debug mode on for one screen
     * does not fill every conversation with prompt text.
     */
    #showModelRequest = $state(
        persisted("settings:showModelRequest", persisted("settings:showSystemPrompts", false)),
    );

    get showBetaFeatures() {
        return this.#showBetaFeatures;
    }

    /** Device-only read preference; never synchronized to the account. */
    get downloadedOnly() {
        return this.#downloadedOnly;
    }

    set downloadedOnly(value: boolean) {
        this.#downloadedOnly = value;
        persist("settings:downloadedOnly", value);
    }

    set showBetaFeatures(value: boolean) {
        this.#showBetaFeatures = value;
        persist("settings:showBetaFeatures", value);
    }

    get debugMode() {
        return this.#debugMode;
    }

    set debugMode(value: boolean) {
        this.#debugMode = value;
        persist("settings:debugMode", value);
    }

    get showModelRequest() {
        return this.#showModelRequest;
    }

    set showModelRequest(value: boolean) {
        this.#showModelRequest = value;
        persist("settings:showModelRequest", value);
    }
}

export const settings = new SettingsStore();
