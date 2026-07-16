<script lang="ts">
    import { onMount } from "svelte";
    import { AIChat } from "$lib/components/ai-chat";
    import { coach } from "$lib/state/coach.svelte";
    import CoachHeader from "./coach-header.svelte";
    import CoachContextTray from "./coach-context-tray.svelte";
    import CoachConnectionGate from "./coach-connection-gate.svelte";

    const fallbackActions = [
        {
            id: "find",
            label: "Find problems for me",
            prompt: "Help me find problems to practice.",
        },
        {
            id: "progress",
            label: "Summarize my progress",
            prompt: "Help me think about my recent progress.",
        },
        {
            id: "plan",
            label: "Plan a study session",
            prompt: "Help me plan a focused study session.",
        },
    ];
    let actions = $derived(
        coach.quickActions.length > 0 ? coach.quickActions : fallbackActions,
    );

    onMount(() => {
        void coach.initialize();
    });
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
    <CoachHeader />
    <CoachContextTray />
    {#if coach.loading && !coach.initialized}
        <div
            class="flex flex-1 items-center justify-center text-xs text-muted-foreground"
            aria-live="polite"
        >
            Loading Coach…
        </div>
    {:else if !coach.bootstrap || coach.connectionBlocked}
        <CoachConnectionGate />
    {:else}
        <AIChat
            controller={coach}
            assistantLabel="Coach"
            conversationLabel="Coach conversation"
            placeholder="Ask Coach…"
            emptyTitle="How can I help?"
            emptyDescription="Ask a math question, explore a study idea, or use one of these starting points."
            quickActions={actions}
            class="h-auto min-h-0 flex-1"
        />
    {/if}
</div>
