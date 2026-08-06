<script lang="ts" module>
    export interface CoachDebugToggleProps {
        class?: string;
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Switch } from "$lib/components/toggle";
    import { settings } from "$lib/state/settings.svelte";
    import { cn } from "$lib/utils";

    let { class: className }: CoachDebugToggleProps = $props();
</script>

<!-- The Coach's half of Settings → Developer → Debug mode. It renders nothing at all
     unless that master switch is on, so a student never sees it. -->
{#if settings.debugMode}
    <div
        data-slot="coach-debug-toggle"
        class={cn(
            "flex shrink-0 items-center gap-2 border-b border-dashed border-border/50 px-3 py-1.5 sm:px-4",
            className,
        )}
    >
        <Icon name="terminal" fontsize={13} class="shrink-0 text-muted-foreground" />
        <label
            for="coach-system-prompts-switch"
            class="min-w-0 cursor-pointer font-mono text-[11px] text-muted-foreground"
        >
            Show system prompts
        </label>
        <Switch
            bind:checked={settings.showSystemPrompts}
            id="coach-system-prompts-switch"
            size="sm"
            class="ml-auto shrink-0"
            aria-label="Show system prompts in the transcript"
        />
    </div>
{/if}
