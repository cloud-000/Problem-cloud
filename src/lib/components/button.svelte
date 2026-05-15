<script lang="ts">
    import Icon from "./icon.svelte";
    let {
        icon = "Home",
        href = "",
        variant = "",
        active = false,
        mobileHelp = false,
        children = null,
    } = $props();
</script>

<a
    {href}
    class={["no-select flex button", variant, { "mobile-support": mobileHelp }]}
    {...active ? { "data-active": true } : {}}
>
    {#if icon}
        <Icon text={icon} --fill={active ? "1" : "0"} />
    {/if}
    {@render children?.()}
</a>

<style>
    a {
        appearance: none;
        text-decoration: none;
        color: inherit;
        font-family: inherit;
        font-size: inherit;
    }
    .button {
        flex-direction: row;
        appearance: none;
        cursor: pointer;
        align-items: center;
        justify-content: center;
        font-size: var(--text-base);
        color: var(--color-primary-foreground);
        background-color: var(--color-primary);
        border: var(--border-size) solid var(--color-border);
        border-radius: var(--radius-lg);
        box-sizing: border-box;
        padding: 8px 16px;
        gap: 8px;
        white-space: nowrap;
        box-sizing: border-box;
    }
    .nav {
        background-color: transparent;
        color: var(--foreground);
        border: none;
        transition:
            background 0.2s ease,
            box-shadow 0.2s ease;
        &:hover {
            background-color: var(--color-accent);
        }
        &[data-active] {
            color: var(--color-primary-foreground);
            background-color: var(--color-primary);
        }
    }
    @scope (.mobile) {
        .mobile-support {
            flex-direction: column;
        }
    }
</style>
