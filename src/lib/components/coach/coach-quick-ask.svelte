<script lang="ts" module>
    import type { FloatingPlacement } from "$lib/components/floating";

    export interface CoachQuickAskProps {
        /** Only `center` (the anchorless chord) is used today; see floating/DOCS.md. */
        placement?: FloatingPlacement;
        anchor?: HTMLElement | null;
    }
</script>

<script lang="ts">
    import { tick } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import { AIChatMessage, AIChatQuickActions } from "$lib/components/ai-chat";
    import { FloatingSurface } from "$lib/components/floating";
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";
    import CoachContextChips from "./coach-context-chips.svelte";
    import CoachResumePrompt from "./coach-resume-prompt.svelte";

    let { placement = "center", anchor = null }: CoachQuickAskProps = $props();

    const mobilePortraitQuery = new MediaQuery(
        "(max-width: 767px) and (orientation: portrait)",
        false,
    );

    let effectivePlacement = $derived<FloatingPlacement>(
        mobilePortraitQuery.current ? "sheet" : placement,
    );

    let input = $state<HTMLInputElement | null>(null);
    let visible = $derived(coach.quickAskVisible);
    let booting = $derived(coach.loading && !coach.initialized);

    // A one-shot bound to a scope the student has left is not this summons's
    // conversation — the next send discards it. Showing it in the meantime is what made
    // the quick-ask reopen on a new problem still displaying the old problem's answer,
    // and it puts the quick actions for the *current* problem behind a stale reply.
    let latestAnswer = $derived(
        coach.oneShotStale
            ? undefined
            : coach.messages.findLast((message) => message.role === "assistant"),
    );
    let proposals = $derived(
        (latestAnswer?.parts ?? []).filter(
            (part) => part.type === "tool" && part.status === "proposed",
        ),
    );

    $effect(() => {
        if (!visible) return;
        void tick().then(() => input?.focus());
    });

    function keydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void coach.send();
        }
    }
</script>

<FloatingSurface
    open={visible}
    placement={effectivePlacement}
    {anchor}
    topRatio={0.22}
    label="Ask Coach"
    onDismiss={() => coach.closeQuickAsk()}
    class={cn(
        "pointer-events-none flex flex-col",
        effectivePlacement === "sheet" ? "p-3" : "w-[min(440px,calc(100vw-2rem))]",
    )}
>
    <!-- Single, unified surface container following DESIGN.md -->
    <div
        class="pointer-events-auto flex flex-col divide-y divide-border/30 rounded-2xl border border-border/60 bg-surface-container-lowest/85 shadow-2xl backdrop-blur-(--backdrop-blur)"
    >
        <!-- Top composer row -->
        <div class="flex items-center gap-2.5 px-3.5 py-2">
            <div
                class="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            >
                <Icon name="auto_awesome" fontsize={16} fill />
            </div>
            {#if booting}
                <span class="py-1.5 text-sm text-muted-foreground" aria-live="polite">
                    Waking Coach…
                </span>
            {:else}
                <Input
                    bind:ref={input}
                    bind:value={coach.draft}
                    type="text"
                    placeholder="Ask Coach a question…"
                    aria-label="Ask Coach"
                    onkeydown={keydown}
                    class="flex-1 border-0 bg-transparent h-8 py-1 shadow-none focus-visible:ring-0 focus-visible:border-transparent dark:bg-transparent text-sm leading-5 placeholder:text-muted-foreground"
                />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                    onclick={() => (coach.streaming ? coach.stop() : coach.send())}
                    disabled={!coach.streaming && !coach.draft.trim()}
                    aria-label={coach.streaming ? "Stop response" : "Send message"}
                >
                    <Icon name={coach.streaming ? "stop" : "arrow_upward"} fontsize={16} fill />
                </Button>
            {/if}
        </div>

        {#if coach.error}
            <div class="flex items-center justify-between gap-2 bg-destructive/5 px-3.5 py-2 text-xs text-destructive">
                <span>{coach.error.message}</span>
                {#if coach.error.retryable}
                    <button
                        type="button"
                        class="shrink-0 font-medium hover:underline"
                        onclick={() => coach.retry()}
                    >
                        Retry
                    </button>
                {/if}
            </div>
        {/if}

        <!-- The offer sits above the answer slot, not over it: the choice is which
             thread to attach to, and the blank Coach behind it is already usable. -->
        {#if coach.resumePrompt}
            <div class="px-3.5 py-2">
                <CoachResumePrompt />
            </div>
        {/if}

        <!-- Detachable context bar section -->
        {#if coach.activeContexts.length > 0}
            <div class="px-3.5 py-2">
                <CoachContextChips />
            </div>
        {/if}

        <!-- Answer / Quick Actions slot -->
        {#if latestAnswer}
            <div class="px-3.5 py-3">
                <div
                    class="max-h-52 overflow-y-auto"
                >
                    <AIChatMessage message={latestAnswer} assistantLabel="Coach" />
                </div>
                {#if proposals.length > 0}
                    <div class="mt-2.5 flex flex-col gap-1.5">
                        {#each proposals as part, index (`${part.type}-${index}`)}
                            {#if part.type === "tool"}
                                <div
                                    class="flex items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-1.5 text-xs text-muted-foreground"
                                >
                                    <span class="truncate">{part.summary}</span>
                                    <span class="shrink-0 font-medium capitalize">{part.status}</span>
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/if}
            </div>
        {:else if coach.quickActions.length > 0 && !booting}
            <div class="p-2.5">
                <AIChatQuickActions
                    actions={coach.quickActions}
                    layout="stack"
                    disabled={coach.streaming}
                    onselect={(action) => coach.send(action.prompt)}
                />
            </div>
        {/if}

        <!-- Escalation Footer -->
        <div class="flex items-center justify-between px-2.5 py-1.5 text-xs text-muted-foreground">
            <button
                type="button"
                class="inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
                onclick={() =>
                    coach.inlineTargetAvailable
                        ? coach.continueInInline()
                        : coach.escalateToPanel()}
            >
                <Icon name="open_in_full" fontsize={14} />
                <span>{coach.inlineTargetAvailable ? "Continue in Coach mode" : "Continue in panel"}</span>
            </button>

            <div class="flex items-center gap-1">
                <button
                    type="button"
                    class="inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
                    onclick={() => coach.escalateToHistory()}
                    aria-label="Browse conversation history"
                    title="Browse conversation history"
                >
                    <Icon name="history" fontsize={15} />
                    <span>History</span>
                </button>
                <kbd class="ml-1.5 rounded bg-surface-container px-1.5 py-0.5 text-[11px] font-mono font-medium text-muted-foreground/80">Esc</kbd>
            </div>
        </div>
    </div>
</FloatingSurface>
