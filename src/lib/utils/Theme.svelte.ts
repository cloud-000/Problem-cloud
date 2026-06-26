import { browser } from "$app/environment";

let currentThemeName = $state<string>("light");

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

    activate(_doc: Document = document) {
        const root = _doc.documentElement;
        Object.keys(this.theme).forEach((t) => {
            root.style.setProperty(Theme.toCss(t), this.theme[t] ?? "");
        });
    }

    toString() {
        return `${this.name}${JSON.stringify(this.theme)}`;
    }

    static toCss(t: string) {
        return "--" + t.replaceAll(" ", "-");
    }
}

// Define and register standard themes immediately at module level (available during SSR)
Theme.storeTheme(new Theme("light", {
    background: "#f8fafc",
    foreground: "#191c1e",
    "background-foreground": "#191c1e",
    primary: "rgb(219, 233, 254)",
    "primary-foreground": "rgb(50, 108, 236)",
    "primary-container": "#131b2e",
    "on-primary-container": "#7c839b",
    "inverse-primary": "#bec6e0",
    secondary: "#334155",
    "secondary-foreground": "#ffffff",
    "secondary-container": "#d5e3fd",
    "on-secondary-container": "#57657b",
    tertiary: "#000000",
    "on-tertiary": "#ffffff",
    "tertiary-container": "#001e2c",
    "on-tertiary-container": "#008ebf",
    surface: "#f7f9fb",
    "surface-dim": "#d8dadc",
    "surface-bright": "#f7f9fb",
    "surface-container-lowest": "#ffffff",
    "surface-container-low": "#f2f4f6",
    "surface-container": "#eceef0",
    "surface-container-high": "#e6e8ea",
    "surface-container-highest": "#e0e3e5",
    "on-surface": "#191c1e",
    "on-surface-variant": "#45464d",
    "inverse-surface": "#2d3133",
    "inverse-on-surface": "#eff1f3",
    "surface-variant": "#e0e3e5",
    "surface-tint": "#565e74",
    border: "#e2e8f0",
    input: "#cbd5e1",
    ring: "#0f172a",
    outline: "#76777d",
    "outline-variant": "#c6c6cd",
    muted: "#f1f5f9",
    "muted-foreground": "#475569",
    error: "#ba1a1a",
    "on-error": "#ffffff",
    "error-container": "#ffdad6",
    "on-error-container": "#93000a",
    destructive: "#ba1a1a",
    "destructive-foreground": "#ffffff",
    correct: "#32a852",
    "on-correct": "#ffffff",
    "correct-container": "#a8edbb",
    "on-correct-container": "#144220",
    unsure: "#fcba03",
    "on-unsure": "#ffffff",
    "unsure-container": "#fef3c7",
    "on-unsure-container": "#78350f",
    "primary-fixed": "#dae2fd",
    "primary-fixed-dim": "#bec6e0",
    "on-primary-fixed": "#131b2e",
    "on-primary-fixed-variant": "#3f465c",
    "secondary-fixed": "#d5e3fd",
    "secondary-fixed-dim": "#b9c7e0",
    "on-secondary-fixed": "#0d1c2f",
    "on-secondary-fixed-variant": "#3a485c",
    "tertiary-fixed": "#c4e7ff",
    "tertiary-fixed-dim": "#7bd0ff",
    "on-tertiary-fixed": "#001e2c",
    "on-tertiary-fixed-variant": "#004c69",
    algebra: "#4f46e5",
    combinatorics: "#db2777",
    geometry: "#0d9488",
    "number-theory": "#ea580c",
}, false));

Theme.storeTheme(new Theme("dark", {
    background: "#0b0f19",
    foreground: "#e2e8f0",
    "background-foreground": "#e2e8f0",
    primary: "#1e293b",
    "primary-foreground": "#60a5fa",
    "primary-container": "#dae2fd",
    "on-primary-container": "#3f465c",
    "inverse-primary": "#3b82f6",
    secondary: "#94a3b8",
    "secondary-foreground": "#0f172a",
    "secondary-container": "#1e293b",
    "on-secondary-container": "#cbd5e1",
    tertiary: "#ffffff",
    "on-tertiary": "#000000",
    "tertiary-container": "#004c69",
    "on-tertiary-container": "#c4e7ff",
    surface: "#0f172a",
    "surface-dim": "#0b0f19",
    "surface-bright": "#1e293b",
    "surface-container-lowest": "#070a13",
    "surface-container-low": "#0f172a",
    "surface-container": "#1e293b",
    "surface-container-high": "#334155",
    "surface-container-highest": "#475569",
    "on-surface": "#f8fafc",
    "on-surface-variant": "#cbd5e1",
    "inverse-surface": "#eff1f3",
    "inverse-on-surface": "#191c1e",
    "surface-variant": "#334155",
    "surface-tint": "#bec6e0",
    border: "#1e293b",
    input: "#334155",
    ring: "#3b82f6",
    outline: "#64748b",
    "outline-variant": "#475569",
    muted: "#1e293b",
    "muted-foreground": "#94a3b8",
    error: "#ffb4ab",
    "on-error": "#690005",
    "error-container": "#93000a",
    "on-error-container": "#ffdad6",
    destructive: "#ffb4ab",
    "destructive-foreground": "#690005",
    correct: "#81c784",
    "on-correct": "#003300",
    "correct-container": "#1b5e20",
    "on-correct-container": "#c8e6c9",
    unsure: "#ffe082",
    "on-unsure": "#332200",
    "unsure-container": "#f57f17",
    "on-unsure-container": "#fff9c4",
    "primary-fixed": "#dae2fd",
    "primary-fixed-dim": "#bec6e0",
    "on-primary-fixed": "#131b2e",
    "on-primary-fixed-variant": "#3f465c",
    "secondary-fixed": "#d5e3fd",
    "secondary-fixed-dim": "#b9c7e0",
    "on-secondary-fixed": "#0d1c2f",
    "on-secondary-fixed-variant": "#3a485c",
    "tertiary-fixed": "#c4e7ff",
    "tertiary-fixed-dim": "#7bd0ff",
    "on-tertiary-fixed": "#001e2c",
    "on-tertiary-fixed-variant": "#004c69",
    algebra: "#818cf8",
    combinatorics: "#f472b6",
    geometry: "#2dd4bf",
    "number-theory": "#fb923c",
}, true));
