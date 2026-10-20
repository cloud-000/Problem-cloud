import { libraryViewKey, normalizeView, transitionView, type LibraryAction, type LibraryView } from "#lib/library/view.js";

/** Per-instance, in-memory host for embedded library surfaces such as the tour. */
export class LibraryStore {
    view = $state<LibraryView>({ tab: "problems", filters: {} });

    constructor(initial: LibraryView = { tab: "problems", filters: {} }) {
        this.view = normalizeView(initial);
    }

    dispatch(action: LibraryAction) {
        const next = transitionView(this.view, action);
        if (libraryViewKey(next) !== libraryViewKey(this.view)) this.view = next;
    }
}
