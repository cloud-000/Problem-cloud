<script lang="ts" module>
    import { cn } from "$lib/utils.js";

    export type LinkItem = {
        label: string;
        href: string;
        icon?: string;
    };

    export type LinkMenuProps = {
        links: LinkItem[];
        icon?: string;
        label?: string;
        class?: string;
    };
</script>

<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";

    let {
        links,
        icon = "link",
        label = "Links",
        class: className,
    }: LinkMenuProps = $props();
</script>

{#if links.length > 0}
    <div class={cn("group/links relative", className)}>
        <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-haspopup="menu"
            class="text-muted-foreground opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/links:opacity-100"
        >
            <Icon name={icon} />
        </Button>

        <div
            role="menu"
            class="pointer-events-none absolute top-7 right-0 z-20 flex w-56 -translate-y-1 flex-col gap-0.5 rounded-lg border border-border bg-surface-container-highest p-1 opacity-0 shadow-lg transition-[opacity,transform] duration-150 ease-out group-hover/links:pointer-events-auto group-hover/links:translate-y-0 group-hover/links:opacity-100 group-focus-within/links:pointer-events-auto group-focus-within/links:translate-y-0 group-focus-within/links:opacity-100"
        >
            {#each links as link (link.href)}
                <Button
                    href={link.href}
                    role="menuitem"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="ghost"
                    size="sm"
                    class="h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
                >
                    <Icon
                        name={link.icon ?? "open_in_new"}
                        class="text-muted-foreground"
                        fontsize="0.875rem"
                    />
                    <span class="min-w-0 truncate">{link.label}</span>
                </Button>
            {/each}
        </div>
    </div>
{/if}
