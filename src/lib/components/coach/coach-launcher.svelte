<script lang="ts" module>
    export interface CoachLauncherProps {
        class?: string;
    }
</script>

<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";
    import { coach } from "$lib/state/coach.svelte";
    import { shell } from "$lib/state/shell.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";

    let { class: className }: CoachLauncherProps = $props();
    let blocked = $derived(coach.initialized && coach.connectionBlocked);
    let visible = $derived(
        coach.enabled && shell.coachLauncherVisible && utilityPanel.activeView === null,
    );
</script>

{#if visible}
    <Button
        variant="primary"
        size="icon-lg"
        class={cn(
            "coach-fab fixed bottom-4 right-4 z-50 size-12 rounded-full shadow-xl transition-transform active:scale-95",
            className,
        )}
        onclick={(event: MouseEvent) =>
            coach.toggleQuickAsk(event.currentTarget as HTMLElement)}
        onpointerdown={(event: PointerEvent) => event.stopPropagation()}
        aria-label="Ask Coach"
        aria-expanded={coach.quickAskOpen}
        title="Ask Coach · Ctrl/Cmd+J"
    >
        <Icon name="auto_awesome" fontsize={20} fill={coach.quickAskOpen} />
        {#if blocked}
            <span
                class="absolute right-1 top-1 size-2.5 rounded-full border-2 border-background bg-destructive"
                aria-label="Coach needs attention"
            ></span>
        {/if}
    </Button>
{/if}

<style>
    /* Clear the mobile bottom bar (56px + the home-indicator inset). */
    @media (max-width: 767px) and (orientation: portrait) {
        :global(.coach-fab) {
            bottom: calc(56px + env(safe-area-inset-bottom) + 1rem);
        }
    }
</style>
