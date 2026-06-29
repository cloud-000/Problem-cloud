import { browser } from "$app/environment";

class SettingsStore {
    #showBetaFeatures = $state(false);

    constructor() {
        if (browser) {
            try {
                const saved = localStorage.getItem("settings:showBetaFeatures");
                if (saved !== null) {
                    this.#showBetaFeatures = saved === "true";
                }
            } catch (_) {}
        }
    }

    get showBetaFeatures() {
        return this.#showBetaFeatures;
    }

    set showBetaFeatures(value: boolean) {
        this.#showBetaFeatures = value;
        if (browser) {
            try {
                localStorage.setItem("settings:showBetaFeatures", String(value));
            } catch (_) {}
        }
    }
}

export const settings = new SettingsStore();
