<script lang="ts">
    import { page } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
    import { resolve } from "$app/paths";
</script>

<div class="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
    <div class="flex size-11 items-center justify-center rounded-xl bg-surface-container text-muted-foreground">
        <Icon name="link_off" fontsize={20} />
    </div>
    <h3 class="mt-3.5 text-base font-semibold tracking-tight text-foreground">Connect Coach</h3>
    <p class="mt-1.5 max-w-md text-sm leading-5 text-muted-foreground">
        {coach.blockingMessage ??
            coach.error?.message ??
            "Add your API key in settings to start using the Coach."}
    </p>
    {#if !page.data.user}
        <a
            href={resolve("/auth/signup")}
            class="mt-2 text-sm font-bold text-primary-foreground underline-offset-4 hover:underline"
        >
            Create an account to use free AI.
        </a>
    {/if}
    <div class="mt-4 flex items-center gap-2">
        <Button size="sm" class="text-xs" onclick={() => coach.initialize(true)}>Retry connection</Button>
        <Button size="sm" variant="outline" class="text-xs" href={resolve("/settings#ai")}>AI settings</Button>
    </div>
</div>
