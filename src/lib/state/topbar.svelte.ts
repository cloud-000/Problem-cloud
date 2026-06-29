import type { Snippet } from "svelte";

class TopbarStore {
    visible = $state(false);
    title = $state<string | null>(null);
    backHref = $state<string | null>(null);
    backLabel = $state<string | null>(null);
    leftSnippet = $state<Snippet | null>(null);
    rightSnippet = $state<Snippet | null>(null);

    reset() {
        this.visible = false;
        this.title = null;
        this.backHref = null;
        this.backLabel = null;
        this.leftSnippet = null;
        this.rightSnippet = null;
    }
}

export const topbar = new TopbarStore();
