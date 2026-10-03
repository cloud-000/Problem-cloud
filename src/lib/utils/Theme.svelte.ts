import { browser } from "$app/environment";
import { defaultThemeConfigs } from "./theme-presets.js";

let currentThemeName = $state<string>(
    browser
        ? (document.documentElement.getAttribute("data-theme") || "light")
        : "light",
);

export class Theme {
    static #a = new Map<string, Theme>();
    static #activates: Array<Document> = [];

    static init(defaultTheme = "light") {
        if (browser) {
            if (this.#activates.length === 0) {
                this.#activates.push(document);
            }

            // Load saved theme if any, else default
            let saved = defaultTheme;
            try {
                saved = localStorage.getItem("theme") || defaultTheme;
            } catch (_) {}

            this.theme = saved;
        }
    }

    static addDocument(_doc: Document) {
        this.#activates.push(_doc);
        if (currentThemeName) {
            this.#a.get(currentThemeName)?.activate(_doc);
        }
    }

    static set theme(t: string) {
        if (!this.#a.has(t)) return;
        currentThemeName = t;
        try {
            localStorage.setItem("theme", t);
        } catch (_) {}
        this.#activates.forEach((act) => this.#a.get(t)?.activate(act));
    }

    static setUserTheme(t: string) {
        try {
            localStorage.setItem("theme:user_explicit", "true");
        } catch (_) {}
        this.theme = t;
    }

    static get theme() {
        return currentThemeName;
    }

    static get currentTheme() {
        return currentThemeName == null ? null : this.#a.get(currentThemeName);
    }

    static get isDark() {
        return this.currentTheme?.isDark ?? false;
    }

    static get themes() {
        return this.#a;
    }

    static get themeOptions() {
        return Array.from(this.#a.keys()).map((name) => ({
            value: name,
            label: name.charAt(0).toUpperCase() + name.slice(1) + " Theme",
        }));
    }

    static storeTheme(t: Theme) {
        this.#a.set(t.name, t);
    }

    public theme: Record<string, string>;
    public name: string;
    public isDark: boolean;

    constructor(e: string, t: Record<string, string>, isDark = false) {
        this.theme = t;
        this.name = e;
        this.isDark = isDark;
    }

    getCssText(): string {
        return Object.entries(this.theme)
            .map(([t, val]) => `${Theme.toCss(t)}: ${val};`)
            .join(" ");
    }

    activate(_doc: Document = document) {
        const root = _doc.documentElement;
        root.setAttribute("data-theme", this.name);

        if (this.name === "light") {
            root.style.cssText = "";
            if (browser && _doc === document) {
                try {
                    localStorage.removeItem("theme:style");
                } catch (_) {}
            }
        } else {
            const cssText = this.getCssText();
            root.style.cssText = cssText;
            if (browser && _doc === document) {
                try {
                    localStorage.setItem("theme:style", cssText);
                } catch (_) {}
            }
        }

        if (browser && _doc === document) {
            const meta = _doc.querySelector('meta[name="theme-color"]');
            if (meta && this.theme["background"]) {
                meta.setAttribute("content", this.theme["background"]);
            }
            const preloadStyle = _doc.getElementById("theme-preload-fallback");
            if (preloadStyle) {
                requestAnimationFrame(() => preloadStyle.remove());
            }
        }
    }

    toString() {
        return `${this.name}${JSON.stringify(this.theme)}`;
    }

    static toCss(t: string) {
        return "--" + t.replaceAll(" ", "-");
    }
}

// Register default theme presets (available during SSR)
defaultThemeConfigs.forEach((cfg) => {
    Theme.storeTheme(new Theme(cfg.name, cfg.theme, cfg.isDark ?? false));
});
