<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";

    let {
        body,
        ondismiss,
    }: {
        body: string;
        ondismiss: () => void;
    } = $props();
</script>

<aside
    class="flex items-start gap-3 rounded-lg border border-border bg-surface-container-low px-4 py-3"
    role="status"
>
    <Icon name="info" class="mt-0.5 shrink-0 text-muted-foreground" />
    <p class="min-w-0 flex-1 type-secondary text-muted-foreground">{body}</p>
    <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss tip"
        onclick={ondismiss}
        class="shrink-0 text-muted-foreground"
    >
        <Icon name="close" />
    </Button>
</aside>
