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
    import { AIChatMessage, AIChatQuickActions } from "$lib/components/ai-chat";
    import { FloatingSurface } from "$lib/components/floating";
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";

    let { placement = "center", anchor = null }: CoachQuickAskProps = $props();

    /**
     * §4a — a vertical stack of detached, translucent pills, not one card. Each
     * pill opts back into pointer events; the gaps between them stay
     * click-through so the page behind is visible *and* usable.
     */
    const PILL =
        "pointer-events-auto rounded-2xl border border-border/50 bg-surface-container-lowest/85 shadow-lg backdrop-blur-(--backdrop-blur)";

    const mobilePortraitQuery = new MediaQuery(
        "(max-width: 767px) and (orientation: portrait)",
        false,
    );
    // A second sheet implementation rather than a UtilityPanelView, deliberately:
    // routing this through UtilityPanel would make it registration-based and
    // mutually exclusive with the whiteboard — the exact coupling it exists to avoid.
    let effectivePlacement = $derived<FloatingPlacement>(
        mobilePortraitQuery.current ? "sheet" : placement,
    );

    let input = $state<HTMLTextAreaElement | null>(null);
    let visible = $derived(coach.quickAskVisible);
    let booting = $derived(coach.loading && !coach.initialized);

    // The bubble shows the answer, not a transcript: growing it to fit anything
    // would build a second, worse chat client and make the panel vestigial.
    let latestAnswer = $derived(
        coach.messages.findLast((message) => message.role === "assistant"),
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
        "pointer-events-none flex flex-col gap-2",
        effectivePlacement === "sheet" ? "p-3" : "w-[min(420px,calc(100vw-2rem))]",
    )}
>
    <!-- Composer pill: no header, no title, no close button, no model picker. -->
    <div class={cn(PILL, "flex items-start gap-2 px-3 py-2")}>
        <Icon
            name="auto_awesome"
            fontsize={18}
            fill
            class="mt-2 shrink-0 text-primary-foreground"
        />
        {#if booting}
            <span class="py-2.5 text-sm text-muted-foreground" aria-live="polite">
                Waking the Coach…
            </span>
        {:else}
            <textarea
                bind:this={input}
                bind:value={coach.draft}
                rows="1"
                class="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground"
                placeholder="Ask the coach…"
                aria-label="Ask Coach"
                onkeydown={keydown}
            ></textarea>
            <Button
                variant="ghost"
                size="icon-sm"
                class="mt-0.5 shrink-0 rounded-full"
                onclick={() => (coach.streaming ? coach.stop() : coach.send())}
                disabled={!coach.streaming && !coach.draft.trim()}
                aria-label={coach.streaming ? "Stop response" : "Send message"}
            >
                <Icon name={coach.streaming ? "stop" : "arrow_upward"} fill />
            </Button>
        {/if}
    </div>

    {#if coach.error}
        <div
            class={cn(
                PILL,
                "flex items-start justify-between gap-2 px-3 py-2 text-xs text-destructive",
            )}
        >
            <span>{coach.error.message}</span>
            {#if coach.error.retryable}
                <button
                    type="button"
                    class="shrink-0 font-semibold hover:underline"
                    onclick={() => coach.retry()}
                >
                    Retry
                </button>
            {/if}
        </div>
    {/if}

    <!-- "No, don't look at that." A surface that silently knows things is unpredictable. -->
    {#if coach.activeContexts.length > 0}
        <div class={cn(PILL, "flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 text-xs")}>
            <span class="text-muted-foreground">Using</span>
            {#each coach.activeContexts as context (context.id)}
                <span
                    class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5"
                >
                    <span class="max-w-40 truncate">{context.label}</span>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground"
                        aria-label="Remove {context.label} from future requests"
                        onclick={() => coach.detachContext(context.id)}
                    >
                        <Icon name="close" fontsize="0.85rem" />
                    </button>
                </span>
            {/each}
        </div>
    {/if}

    <!--
      The lower slot: the answer once there is one, the quick actions until then
      — stacked pills with leading icons, not a horizontal chip row.
    -->
    {#if latestAnswer}
        <div class={cn(PILL, "px-3 py-2.5")}>
            <!-- Rendered through AIChatMessage, which goes via MathStatement:
                 Coach answers are full of $…$ and a bespoke card shows raw LaTeX. -->
            <div
                class="max-h-48 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
            >
                <AIChatMessage message={latestAnswer} assistantLabel="Coach" />
            </div>
            {#if proposals.length > 0}
                <!-- Reserved for §7.3. Nothing proposes tool runs yet, so this
                     stays read-only until there is an executor and a permission
                     model to confirm against. -->
                <div class="mt-2 flex flex-col gap-1">
                    {#each proposals as part, index (`${part.type}-${index}`)}
                        {#if part.type === "tool"}
                            <div
                                class="flex items-center justify-between gap-3 rounded-lg bg-surface-container px-2.5 py-1.5 text-xs text-muted-foreground"
                            >
                                <span class="truncate">{part.summary}</span>
                                <span class="shrink-0 capitalize">{part.status}</span>
                            </div>
                        {/if}
                    {/each}
                </div>
            {/if}
        </div>
    {:else if coach.quickActions.length > 0 && !booting}
        <div class={cn(PILL, "p-2")}>
            <AIChatQuickActions
                actions={coach.quickActions}
                layout="stack"
                disabled={coach.streaming}
                onselect={(action) => coach.send(action.prompt)}
            />
        </div>
    {/if}

    <!-- Escalation. Two targets, because history lives inside the panel and
         reaching it would otherwise cost three gestures (§4.1). -->
    <div class={cn(PILL, "flex items-center gap-1 px-1.5 py-1")}>
        <button
            type="button"
            class="flex min-h-8 flex-1 items-center gap-1.5 rounded-xl px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
            onclick={() =>
                coach.inlineTargetAvailable
                    ? coach.continueInInline()
                    : coach.escalateToPanel()}
        >
            <Icon name="open_in_full" fontsize={15} />
            <span>{coach.inlineTargetAvailable ? "Continue in Coach mode" : "Continue in panel"}</span>
        </button>
        <button
            type="button"
            class="flex min-h-8 items-center gap-1.5 rounded-xl px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
            onclick={() => coach.escalateToHistory()}
            aria-label="Browse conversation history"
            title="Browse conversation history"
        >
            <Icon name="history" fontsize={15} />
        </button>
        <span class="ml-auto pr-1.5 text-[10px] text-muted-foreground/70">Esc</span>
    </div>
</FloatingSurface>
