<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";
    import { resolve } from "$app/paths";

    let moreOpen = $state(false);
    let menuRef = $state<HTMLElement | null>(null);
    let moreButtonRef = $state<HTMLElement | null>(null);
    let savingHistory = $state(false);

    function handleWindowClick(event: MouseEvent) {
        if (!moreOpen) return;
        const target = event.target as Node | null;
        if (
            menuRef &&
            !menuRef.contains(target) &&
            moreButtonRef &&
            !moreButtonRef.contains(target)
        ) {
            moreOpen = false;
        }
    }

    function handleKeydown(event: KeyboardEvent) {
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

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<header class="relative flex h-12 shrink-0 items-center gap-1 border-b border-border/40 px-3">
    <div class="mr-auto flex items-center gap-2">
        <div class="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon name="auto_awesome" fontsize={15} fill />
        </div>
        <h2 class="text-sm font-semibold tracking-tight text-foreground">Coach</h2>
    </div>

    <Button
        variant="ghost"
        size="icon-sm"
        onclick={() => coach.newConversation()}
        aria-label="New conversation"
        title="New conversation"
    >
        <Icon name="add_comment" fontsize={16} />
    </Button>

    {#if coach.historyEnabled}
        <Button
            variant="ghost"
            size="icon-sm"
            onclick={() => (coach.historyViewOpen ? coach.closeConversationList() : coach.openConversationList())}
            aria-label="Conversation history"
            aria-expanded={coach.historyViewOpen}
            class={coach.historyViewOpen ? "bg-surface-container text-foreground" : undefined}
            title="Conversation history"
        >
            <Icon name="history" fontsize={16} />
        </Button>
    {:else}
        <Button
            variant="ghost"
            size="icon-sm"
            disabled
            aria-label="Conversation history unavailable"
            title="Turn on “Save conversations” to browse your history."
        >
            <Icon name="history" fontsize={16} />
        </Button>
    {/if}

    <div bind:this={moreButtonRef} class="inline-flex">
        <Button
            variant="ghost"
            size="icon-sm"
            onclick={() => (moreOpen = !moreOpen)}
            aria-label="More Coach options"
            aria-expanded={moreOpen}
        >
            <Icon name="more_horiz" fontsize={16} />
        </Button>
    </div>

    <Button
        variant="ghost"
        size="icon-sm"
        onclick={() => utilityPanel.close()}
        aria-label="Close Coach"
        title="Close Coach"
    >
        <Icon name="close" fontsize={16} />
    </Button>

    {#if moreOpen}
        <div
            bind:this={menuRef}
            class="absolute right-3 top-11 z-70 w-64 rounded-xl border border-border/70 bg-surface-container-lowest p-3 shadow-xl"
        >
            <label class="flex items-start gap-2.5 text-xs cursor-pointer">
                <input
                    type="checkbox"
                    class="mt-0.5 rounded border-border text-primary focus:ring-primary"
                    checked={coach.bootstrap?.historyEnabled ?? false}
                    disabled={savingHistory}
                    onchange={toggleHistory}
                />
                <span>
                    <span class="block font-medium text-foreground">Save conversations</span>
                    <span class="mt-0.5 block leading-4 text-muted-foreground">Stored server-side according to your retention setting.</span>
                </span>
            </label>
            <div class="mt-3 border-t border-border/40 pt-2 text-right">
                <a
                    class="inline-flex text-xs font-medium text-primary hover:underline"
                    href={resolve("/settings#ai")}
                >
                    AI settings →
                </a>
            </div>
        </div>
    {/if}
</header>
