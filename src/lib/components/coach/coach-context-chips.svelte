<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";

    interface Props {
        class?: string;
    }

    let { class: className }: Props = $props();
</script>

{#if coach.activeContexts.length > 0}
    <div class={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
        <span class="shrink-0 font-medium text-muted-foreground">Using</span>
        {#each coach.activeContexts as context (context.id)}
            <span
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-container-high"
            >
                <span class="max-w-44 truncate">{context.label}</span>
                <button
                    type="button"
                    class="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-container-highest hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label="Remove {context.label} from future requests"
                    onclick={() => coach.detachContext(context.id)}
                >
                    <Icon name="close" fontsize={13} />
                </button>
            </span>
        {/each}
    </div>
{/if}
