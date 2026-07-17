<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
</script>

<div class="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
    <div class="flex size-12 items-center justify-center rounded-2xl bg-surface-container text-muted-foreground">
        <Icon name="link_off" />
    </div>
    <h3 class="mt-4 text-lg font-semibold tracking-tight">Connect AI</h3>
    <p class="mt-1.5 max-w-sm text-sm leading-5 text-muted-foreground">
        {coach.blockingMessage ??
            coach.error?.message ??
            "Add your own API key in Settings to start using the coach."}
    </p>
    <div class="mt-4 flex gap-2">
        <Button size="sm" onclick={() => coach.initialize(true)}>Retry connection</Button>
        <Button size="sm" variant="outline" href="/settings">AI settings</Button>
    </div>
</div>
