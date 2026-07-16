<script lang="ts" module>
    export interface CoachLauncherProps {
        variant?: "topbar" | "mobile" | "modal";
        class?: string;
    }
</script>

<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";
    import { coach } from "$lib/state/coach.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";

    let { variant = "topbar", class: className }: CoachLauncherProps = $props();
    let blocked = $derived(
        coach.initialized && coach.bootstrap?.connection?.connectionState !== "connected",
    );

    function open(event: MouseEvent) {
        utilityPanel.toggle("coach", event.currentTarget as HTMLElement);
    }

    function shortcut(event: KeyboardEvent) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
            event.preventDefault();
            utilityPanel.toggle("coach");
        }
    }
</script>

<svelte:window onkeydown={shortcut} />

<Button
    variant="ghost"
    size={variant === "mobile" ? "icon-lg" : variant === "modal" ? "sm" : "icon-sm"}
    class={cn(
        "relative text-muted-foreground hover:text-foreground",
        variant === "mobile" && "size-10 bg-primary/10 text-primary-foreground",
        className,
    )}
    onclick={open}
    aria-label="Open Coach"
    aria-pressed={utilityPanel.activeView === "coach"}
    title="Open Coach · Ctrl/Cmd+J"
>
    <Icon name="auto_awesome" fill={utilityPanel.activeView === "coach"} />
    {#if variant === "modal"}<span>Coach</span>{/if}
    {#if blocked}
        <span
            class="absolute right-0.5 top-0.5 size-2 rounded-full border border-background bg-destructive"
            aria-label="Coach needs attention"
        ></span>
    {/if}
</Button>
