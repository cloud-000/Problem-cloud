<script lang="ts">
    import { onMount } from "svelte";
    import { AIChat } from "$lib/components/ai-chat";
    import { COACH_FALLBACK_QUICK_ACTIONS } from "$lib/ai/quick-actions";
    import { coach } from "$lib/state/coach.svelte";
    import CoachHeader from "./coach-header.svelte";
    import CoachContextTray from "./coach-context-tray.svelte";
    import CoachDebugToggle from "./coach-debug-toggle.svelte";
    import CoachRequestInspector from "./coach-request-inspector.svelte";
    import CoachConnectionGate from "./coach-connection-gate.svelte";
    import CoachConversationList from "./coach-conversation-list.svelte";

    let actions = $derived(
        coach.quickActions.length > 0 ? coach.quickActions : COACH_FALLBACK_QUICK_ACTIONS,
    );
    onMount(() => {
        void coach.initialize();
    });
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
    <CoachHeader />
    {#if coach.loading && !coach.initialized}
        <div
            class="flex flex-1 items-center justify-center text-xs text-muted-foreground"
            aria-live="polite"
        >
            Loading Coach…
        </div>
    {:else if coach.historyViewOpen}
        <!-- Replaces the transcript and composer; history stays readable even if the provider is down. -->
        <CoachConversationList />
    {:else if !coach.bootstrap || coach.connectionBlocked}
        <CoachContextTray />
        <CoachConnectionGate />
    {:else}
        <CoachContextTray />
        <CoachDebugToggle />
        <CoachRequestInspector />
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
