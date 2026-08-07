<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { replaceState } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { COACH_FALLBACK_QUICK_ACTIONS } from "$lib/ai/quick-actions";
    import { AIChat } from "$lib/components/ai-chat";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        CoachConnectionGate,
        CoachContextTray,
        CoachConversationList,
        CoachDebugToggle,
        CoachRequestInspector,
    } from "$lib/components/coach";
    import { coach } from "$lib/state/coach.svelte";
    import { shell } from "$lib/state/shell.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";

    /**
     * Which chat this page is showing. Identity is minted in the browser before the
     * first token (`#ensureConversationId`), so the parameter *reflects* the thread
     * rather than creating it: `/coach` on its own is a new chat, `/coach?c=<id>` is
     * that thread, and the id is written back with `replaceState` the moment one
     * exists — no navigation, no history entry mid-conversation.
     */
    const CHAT_PARAM = "c";

    /** Where the history list docks beside the transcript instead of replacing it. */
    const railQuery = new MediaQuery("(min-width: 1024px)", false);

    /**
     * The readable column, applied *inside* the transcript's scroll container and to
     * the floating composer — never to the chat root. The scrollbar then belongs to
     * the full-width chat and sits on its outer edge, right up against the history
     * rail, rather than tracking a centered column through the middle of the page.
     * `scrollbar-gutter: stable both-edges` is what keeps the rail's centre from
     * drifting off the composer's when the scrollbar appears.
     */
    const rail = "mx-auto w-full max-w-[52rem]";

    let composerRef = $state<HTMLTextAreaElement | null>(null);
    /**
     * Whether the initial URL → store adoption has settled. Until it has, the mirror
     * below would see the store's empty id against the requested one and strip the
     * parameter from the address bar before the thread it names has loaded.
     */
    let adopted = $state(false);

    let actions = $derived(
        coach.quickActions.length > 0 ? coach.quickActions : COACH_FALLBACK_QUICK_ACTIONS,
    );
    onMount(() => {
        // §6.4 — one transcript on screen. This page *is* the Coach, so the panel and
        // the quick-ask stand down: the FAB has nothing to add, and the global chord
        // resolves to the composer below instead of summoning a second transcript.
        if (utilityPanel.activeView === "coach") utilityPanel.close(false);
        coach.closeQuickAsk(false);
        // The view is global state a previous panel session may have left open; the
        // page opens on its transcript, with history docked beside it.
        coach.closeConversationList();
        const releaseLauncher = shell.suppressCoachLauncher();
        const releaseTarget = coach.registerInlineTarget({
            isActive: () => true,
            open: () => {},
            focusComposer: () => composerRef?.focus(),
            presentation: "page",
        });

        void (async () => {
            try {
                // The bootstrap has to land first: `present()` only flushes a one-shot
                // once the saving preference is known, and a null bootstrap reads as
                // "saving is off".
                await coach.initialize();
                // Adopting the page as a presentation is what promotes a quick-ask that
                // was still held in memory (§1); a thread that already has rows keeps
                // the tier it had.
                coach.present("page");
                const requested = page.url.searchParams.get(CHAT_PARAM);
                if (requested && requested !== coach.conversationId) {
                    await coach.selectConversation(requested);
                }
                await coach.ensureConversations();
            } finally {
                adopted = true;
            }
        })();

        return () => {
            releaseTarget();
            releaseLauncher();
        };
    });

    // The address bar follows the active thread, wherever it was switched from — the
    // history rail, **New chat**, or the first send of a fresh conversation.
    $effect(() => {
        const id = coach.conversationId;
        const current = page.url.searchParams.get(CHAT_PARAM);
        if (!adopted || (id ?? null) === current) return;
        const url = new URL(page.url);
        if (id) url.searchParams.set(CHAT_PARAM, id);
        else url.searchParams.delete(CHAT_PARAM);
        const route = url.search
            ? (`/coach${url.search}${url.hash}` as `/coach?${string}`)
            : url.hash
              ? (`/coach${url.hash}` as `/coach#${string}`)
              : "/coach";
        untrack(() => replaceState(resolve(route), page.state));
    });
</script>

<svelte:head>
    <title>Coach · ProblemCloud</title>
</svelte:head>

<div class="flex h-full w-full overflow-hidden bg-background">
    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="flex h-12 shrink-0 items-center gap-1 border-b border-border/40 px-3">
            <div class="mr-auto flex items-center gap-2">
                <div
                    class="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary"
                >
                    <Icon name="auto_awesome" fontsize={15} fill />
                </div>
                <h1 class="text-sm font-semibold tracking-tight text-foreground">Coach</h1>
            </div>

            <Button
                variant="ghost"
                size="sm"
                class="gap-1.5 text-xs"
                onclick={() => coach.newConversation()}
            >
                <Icon name="add_comment" fontsize={16} />
                New chat
            </Button>

            <!-- Below the rail breakpoint the list stands in for the transcript, exactly
                 as it does in the panel; above it, it is already on screen. -->
            <div class="lg:hidden">
                {#if coach.historyEnabled}
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onclick={() =>
                            coach.historyViewOpen
                                ? coach.closeConversationList()
                                : coach.openConversationList()}
                        aria-label="Conversation history"
                        aria-expanded={coach.historyViewOpen}
                        class={coach.historyViewOpen
                            ? "bg-surface-container text-foreground"
                            : undefined}
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
            </div>
        </header>

        {#if !coach.enabled}
            <div class="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div
                    class="flex size-11 items-center justify-center rounded-xl bg-surface-container text-muted-foreground"
                >
                    <Icon name="auto_awesome" fontsize={20} />
                </div>
                <h2 class="mt-3.5 text-base font-semibold tracking-tight text-foreground">
                    Coach is unavailable
                </h2>
                <p class="mt-1.5 max-w-xs text-xs leading-5 text-muted-foreground">
                    The AI Coach is turned off for this account.
                </p>
            </div>
        {:else if coach.loading && !coach.initialized}
            <div
                class="flex flex-1 items-center justify-center text-xs text-muted-foreground"
                aria-live="polite"
            >
                Loading Coach…
            </div>
        {:else if coach.historyViewOpen && !railQuery.current}
            <!-- Only below the rail breakpoint does the list stand in for the
                 transcript; widening never leaves it showing in both places. -->
            <CoachConversationList />
        {:else if !coach.bootstrap || coach.connectionBlocked}
            <CoachContextTray />
            <CoachConnectionGate />
        {:else}
            <CoachContextTray />
            <CoachDebugToggle />
            <CoachRequestInspector class={rail} />
            <!-- Full-bleed, with the readable column as a rail *inside* the scroll
                 container: capping the chat itself would park its scrollbar in the
                 middle of the page instead of on the edge beside the history rail. -->
            <AIChat
                controller={coach}
                assistantLabel="Coach"
                conversationLabel="Coach conversation"
                placeholder="Ask Coach…"
                emptyTitle="How can I help?"
                emptyDescription="Ask a math question, explore a study idea, or use one of these starting points."
                quickActions={actions}
                class="h-auto min-h-0 w-full flex-1"
                transcriptClass="[scrollbar-gutter:stable_both-edges]"
                contentClass={rail}
                composerClass={rail}
                bind:composerRef
            />
        {/if}
    </main>

    <!-- Docked on the right: the app's own navigation already owns the left edge. -->
    {#if coach.enabled}
        <aside
            class="hidden w-72 shrink-0 border-l border-border/40 bg-surface-container-lowest lg:flex lg:flex-col"
            aria-label="Coach conversation history"
        >
            <CoachConversationList showBack={false} />
        </aside>
    {/if}
</div>
