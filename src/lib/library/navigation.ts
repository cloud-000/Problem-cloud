import { libraryHistoryMode, libraryViewKey, transitionView, type LibraryAction } from "./view.js";
import { parseLibraryUrl, writeLibraryUrl } from "./url.js";

/** Browser APIs stay in the host. Serialize actions so rapid edits cannot overwrite each other. */
export function createLibraryNavigation(host: {
    readUrl: () => URL;
    navigate: (url: URL, replace: boolean) => Promise<void>;
}) {
    let queue = Promise.resolve();
    let disposed = false;
    return {
        dispatch(action: LibraryAction): Promise<void> {
            const pathname = host.readUrl().pathname;
            const run = async () => {
                const current = host.readUrl();
                if (disposed || current.pathname !== pathname) return;
                const previous = parseLibraryUrl(current.searchParams);
                const next = transitionView(previous, action);
                if (libraryViewKey(previous) === libraryViewKey(next)) return;
                await host.navigate(writeLibraryUrl(current, next), libraryHistoryMode(action) === "replace");
            };
            queue = queue.then(run, run);
            return queue;
        },
        dispose() { disposed = true; },
    };
}
