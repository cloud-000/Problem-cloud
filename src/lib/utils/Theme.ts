export class Theme {
    static #a = new Map<string, Theme>();
    static #activates: Array<Document> = [];
    static #b: string | null = null;
    static init() {
        this.#activates.push(document);
    }
    static addDocument(_doc: Document) {
        this.#activates.push(_doc);
    }
    static set theme(t: string) {
        this.#b = t;
        this.#activates.forEach((act) => this.#a.get(t)?.activate(act));
    }
    static get currentTheme() {
        return this.#b == null ? null : this.#a.get(this.#b);
    }
    static get themes() {
        return this.#a;
    }
    static storeTheme(t: Theme) {
        this.#a.set(t.name, t);
    }
    public theme: Record<string, string>;
    public name: string;
    constructor(e: string, t: Record<string, string>) {
        this.theme = t;
        this.name = e;
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
