import { createContext } from "svelte";
import { Theme } from "./utils/Theme";

// We use a class to encapsulate the logic
export class AppState {
    #rating: number | undefined = $state(0);
    #username = $state("");
    public themes: Array<Theme> = $state([]);
    public uuid = "";
    public email: string | null = "";

    get rating() {
        return this.#rating;
    }
    set rating(value) {
        this.#rating = value;
    }

    get username() {
        return this.#username;
    }
    set username(value) {
        this.#username = value;
    }
    addTheme(theme: Theme) {
        Theme.storeTheme(theme);
        this.themes.push(theme);
    }
    set theme(value: string) {
        Theme.theme = value;
    }
    get theme(): Theme | null {
        return Theme.currentTheme ?? null;
    }
}

export const [getAppState, setAppState] = createContext<AppState>();
