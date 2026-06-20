<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { useSidebar } from "./sidebar.svelte";
    import { Button } from "$lib/components/button/.";
    import type { ButtonProps } from "$lib/components/button";
    import { Icon } from "$lib/components/icon/.";

    type Props = ButtonProps;

    let {
        ref = $bindable(null),
        class: className,
        onclick,
        ...restProps
    }: Props = $props();

    const sidebar = useSidebar();

    function handleToggle(e: MouseEvent) {
        sidebar.expanded = !sidebar.expanded;
        if (onclick) {
            // @ts-expect-error - Svelte 5 types might require matching mouse events
            onclick(e);
        }
    }
</script>

<Button
    bind:ref
    variant="ghost"
    size="icon-sm"
    class={cn("sidebar-trigger text-muted-foreground hover:text-foreground", className)}
    onclick={handleToggle}
    {...restProps}
>
    <Icon class="transition-transform duration-300" style={sidebar.expanded ? "transform: rotate(0deg);" : "transform: rotate(180deg);"}>
        chevron_left
    </Icon>
</Button>
