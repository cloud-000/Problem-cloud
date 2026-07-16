<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";
    import { resolve } from "$app/paths";

    let moreOpen = $state(false);
    let savingHistory = $state(false);

    function closeMore(event: KeyboardEvent) {
        if (!moreOpen || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        moreOpen = false;
    }

    async function toggleHistory(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        savingHistory = true;
        try {
            await coach.setHistoryEnabled(target.checked);
        } finally {
            savingHistory = false;
        }
    }
</script>

<svelte:window onkeydown={closeMore} />

<header class="relative flex h-12 shrink-0 items-center gap-1 border-b border-border/30 px-2.5">
    <div class="mr-auto flex items-center gap-2 pl-1">
        <div class="flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary-foreground">
            <Icon name="auto_awesome" fontsize={15} fill />
        </div>
        <h2 class="text-sm font-semibold tracking-tight">Coach</h2>
    </div>
    <Button variant="ghost" size="icon-sm" onclick={() => coach.newConversation()} aria-label="New conversation">
        <Icon name="add_comment" />
    </Button>
    <Button variant="ghost" size="icon-sm" onclick={() => (moreOpen = !moreOpen)} aria-label="More Coach options" aria-expanded={moreOpen}>
        <Icon name="more_horiz" />
    </Button>
    <Button variant="ghost" size="icon-sm" onclick={() => utilityPanel.close()} aria-label="Close Coach">
        <Icon name="close" />
    </Button>

    {#if moreOpen}
        <div class="absolute right-9 top-10 z-70 w-64 rounded-xl border border-border/70 bg-surface-container-lowest p-3 shadow-xl">
            <label class="flex items-start gap-3 text-xs">
                <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={coach.bootstrap?.historyEnabled ?? false}
                    disabled={savingHistory}
                    onchange={toggleHistory}
                />
                <span>
                    <span class="block font-medium text-foreground">Save conversations</span>
                    <span class="mt-0.5 block text-muted-foreground">Stored server-side according to your retention setting.</span>
                </span>
            </label>
            <a class="mt-3 inline-flex text-xs text-primary-foreground hover:underline" href={resolve("/settings")}>AI settings</a>
        </div>
    {/if}
</header>
