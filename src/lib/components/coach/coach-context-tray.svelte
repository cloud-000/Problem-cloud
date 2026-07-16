<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
</script>

{#if coach.activeContexts.length > 0}
    <div class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/30 px-3 py-1.5 text-xs">
        <span class="shrink-0 text-muted-foreground">Using</span>
        {#each coach.activeContexts as context (context.id)}
            <span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-container px-2 py-1 text-foreground">
                {context.label}
                <button
                    type="button"
                    class="rounded-full text-muted-foreground hover:text-foreground"
                    aria-label="Remove {context.label} from future requests"
                    onclick={() => coach.detachContext(context.id)}
                >
                    <Icon name="close" fontsize="0.9rem" />
                </button>
            </span>
        {/each}
    </div>
{/if}
