import { describe, expect, test } from "bun:test";
import { createLibraryNavigation } from "./navigation";
import { parseLibraryUrl } from "./url";

function host(initial: string) {
    const entries = [new URL(initial, "https://example.test")];
    let cursor = 0;
    const writes: boolean[] = [];
    const navigation = createLibraryNavigation({
        readUrl: () => entries[cursor],
        navigate: async (url, replace) => {
            // SvelteKit resolves an intent before committing even a shallow update.
            await Promise.resolve();
            writes.push(replace);
            if (replace) entries[cursor] = url;
            else { entries.splice(cursor + 1); entries.push(url); cursor++; }
        },
    });
    return {
        navigation, writes,
        get view() { return parseLibraryUrl(entries[cursor].searchParams); },
        get length() { return entries.length; },
        get url() { return entries[cursor]; },
        back() { cursor--; }, forward() { cursor++; },
    };
}

describe("library navigation host", () => {
    test("rapid edits compose against the latest committed URL", async () => {
        const h = host("/library?ref=home#results");
        await Promise.all([
            h.navigation.dispatch({ type: "patch", filters: { topic: ["A"] } }),
            h.navigation.dispatch({ type: "patch", filters: { verified: false } }),
        ]);
        expect(h.view).toEqual({ tab: "problems", filters: { topic: ["A"], verified: false } });
        expect(h.writes).toEqual([true, true]);
        expect(h.url.searchParams.get("ref")).toBe("home");
        expect(h.url.hash).toBe("#results");
    });

    test("tabs and drill-downs push; filter edits replace; Back/Forward restore snapshots", async () => {
        const h = host("/library?topic=G");
        await h.navigation.dispatch({ type: "tab", tab: "series" });
        await h.navigation.dispatch({ type: "patch", filters: { isOfficial: true } });
        await h.navigation.dispatch({ type: "series", seriesId: 7 });
        await h.navigation.dispatch({ type: "test", testId: 91, seriesId: 7 });
        await h.navigation.dispatch({ type: "patch", filters: { problemNumbers: [15, 25] } });
        expect(h.length).toBe(4);
        expect(h.writes).toEqual([false, true, false, false, true]);
        h.back();
        expect(h.view).toEqual({ tab: "tests", filters: { seriesId: 7 } });
        h.back();
        expect(h.view).toEqual({ tab: "series", filters: { isOfficial: true } });
        h.forward(); h.forward();
        expect(h.view).toEqual({ tab: "problems", filters: { seriesId: 7, testId: 91, problemNumbers: [15, 25] } });
        // Reloading means constructing another host from this URL: no hidden state.
        expect(host(h.url.href).view).toEqual(h.view);
    });

    test("equivalent selections do not write history and disposed hosts drop pending actions", async () => {
        const h = host("/library?topic=G&topic=A");
        await h.navigation.dispatch({ type: "patch", filters: { topic: ["A", "G"] } });
        expect(h.writes).toEqual([]);
        const pending = h.navigation.dispatch({ type: "tab", tab: "tests" });
        h.navigation.dispose();
        await pending;
        expect(h.writes).toEqual([]);
    });

    test("queued actions are discarded after leaving the host pathname", async () => {
        let current = new URL("https://example.test/library");
        let writes = 0;
        const navigation = createLibraryNavigation({
            readUrl: () => current,
            navigate: async () => { writes++; },
        });
        const pending = navigation.dispatch({ type: "tab", tab: "tests" });
        current = new URL("https://example.test/practice");
        await pending;
        expect(writes).toBe(0);
    });

    test("a rejected navigation does not poison the queue", async () => {
        let current = new URL("https://example.test/library");
        let fail = true;
        const navigation = createLibraryNavigation({
            readUrl: () => current,
            navigate: async (url) => {
                if (fail) { fail = false; throw new Error("navigation failed"); }
                current = url;
            },
        });
        await expect(navigation.dispatch({ type: "patch", filters: { topic: ["A"] } })).rejects.toThrow("navigation failed");
        await navigation.dispatch({ type: "patch", filters: { verified: true } });
        expect(parseLibraryUrl(current.searchParams).filters).toEqual({ verified: true });
    });
});
