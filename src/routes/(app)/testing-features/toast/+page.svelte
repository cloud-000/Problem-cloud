<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { toasts } from "$lib/state/toast.svelte";

    const severities = [
        {
            label: "Success",
            fire: () => toasts.success("Toasts system is working!"),
        },
        {
            label: "Error",
            fire: () => toasts.error("Something went wrong."),
        },
        {
            label: "Info",
            fire: () => toasts.info("Here is some information."),
        },
        {
            label: "Warning",
            fire: () => toasts.warning("Careful — this is a warning."),
        },
    ];
</script>

<div class="space-y-8">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-2">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon name="notifications" fontsize="2rem" class="text-primary-foreground" />
            Toast
        </h1>
        <p class="text-sm text-muted-foreground">
            Fire a toast for each severity the store exposes.
        </p>
    </div>

    <!-- Severity buttons -->
    <div
        class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs"
    >
        <div class="flex flex-wrap gap-3">
            {#each severities as severity}
                <Button variant="outline" size="sm" onclick={severity.fire}>
                    <Icon name="notifications" fontsize="16px" class="mr-1.5" />
                    {severity.label}
                </Button>
            {/each}
        </div>
    </div>
</div>
