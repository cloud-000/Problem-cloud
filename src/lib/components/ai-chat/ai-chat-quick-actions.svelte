<script lang="ts" module>
    import type { AIChatQuickAction } from "./types";

    export interface AIChatQuickActionsProps {
        actions?: readonly AIChatQuickAction[];
        /**
         * `stack` is one full-width pill per action with a leading icon (the
         * quick-ask); `row` is a horizontal chip row that can sit alongside a
         * live transcript (the trainer).
         */
        layout?: "stack" | "row";
        disabled?: boolean;
        onselect: (action: AIChatQuickAction) => void;
        class?: string;
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    let {
        actions = [],
        layout = "stack",
        disabled = false,
        onselect,
        class: className,
    }: AIChatQuickActionsProps = $props();
</script>

<!--
  Lives outside the empty state on purpose: quick actions used to render only
  while `messages.length === 0`, so asking for a hint made every other action
  vanish exactly when you wanted the next one.
-->
{#if actions.length > 0}
    <div
        data-slot="ai-chat-quick-actions"
        class={cn(
            "flex bg-transparent",
            layout === "stack" ? "flex-col gap-2" : "flex-wrap items-center gap-1.5",
            className,
        )}
    >
        {#each actions as action (action.id)}
            <button
                type="button"
                {disabled}
                class={cn(
                    "flex items-center gap-2 text-left backdrop-blur-(--backdrop-blur) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                    layout === "stack"
                        ? "min-h-11 w-full rounded-xl bg-surface-container-low/30 px-3.5 py-2.5 text-sm leading-5 hover:bg-surface-container/45"
                        : "min-h-8 rounded-full bg-surface-container-low/30 px-3 py-1.5 text-xs leading-4 hover:bg-surface-container/45",
                )}
                onclick={() => onselect(action)}
            >
                {#if action.icon}
                    <Icon
                        name={action.icon}
                        fontsize={layout === "stack" ? 18 : 15}
                        class="shrink-0 text-muted-foreground"
                    />
                {/if}
                <span class="min-w-0 truncate">{action.label}</span>
            </button>
        {/each}
    </div>
{/if}
