<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    type Props = {
        /** Whether the protected content is currently concealed. */
        blocked?: boolean;
        /** Quiet action label shown while the content is concealed. */
        revealLabel?: string;
        /** Content that is only rendered after the user reveals it. */
        children?: Snippet;
        class?: string;
    };

    let {
        blocked = $bindable(true),
        revealLabel = "Reveal answer",
        children,
        class: className,
    }: Props = $props();
</script>

{#if blocked}
    <Button
        variant="ghost"
        size="xs"
        class={cn(
            "h-7 gap-1 rounded-md border border-dashed border-border/70 bg-surface-container-lowest px-2 text-muted-foreground hover:border-border hover:bg-surface-container-low hover:text-foreground",
            className,
        )}
        onclick={() => (blocked = false)}
    >
        <Icon name="visibility" fontsize="0.9rem" />
        {revealLabel}
    </Button>
{:else}
    <span class={cn("inline-flex items-center gap-1", className)}>
        {@render children?.()}
        <Button
            variant="ghost"
            size="icon-xs"
            class="size-6 text-muted-foreground hover:text-foreground"
            onclick={() => (blocked = true)}
            aria-label="Hide answer"
            title="Hide answer"
        >
            <Icon name="visibility_off" fontsize="0.9rem" />
        </Button>
    </span>
{/if}
