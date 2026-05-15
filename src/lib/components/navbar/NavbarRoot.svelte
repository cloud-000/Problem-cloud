<script lang="ts">
    import { setNavbar } from "./context.svelte";
    let { children } = $props();
    const sidebar = setNavbar();
</script>

<div class="expand flex navbar-root" data-state={sidebar.state}>
    {@render children()}
</div>

<style>
    .navbar-root {
        flex-direction: column;
        width: fit-content;
        transition: width 0.3s ease;
        overflow: hidden;
        flex-shrink: 0;
        padding: 8px;
        border-right: var(--border-size) solid var(--color-sidebar-border);
        box-sizing: border-box;
    }
    .navbar-root[data-state="open"] {
        width: fit-content;
    }
    .navbar-root[data-state="collapsed"] {
        width: fit-content;
    }
    .navbar-root[data-state="closed"] {
        width: 0px;
    }
    :global(.button) {
        align-items: flex-start;
        justify-content: flex-start;
        width: 100%;
    }
    @scope (.mobile) {
        @media (orientation: portrait) {
            .navbar-root {
                flex-direction: row;
                width: 100% !important;
                height: fit-content;
                border-right: none;
                border-top: var(--border-size) solid var(--color-sidebar-border);
            }
        }
        .navbar-root:global(.button) {
            width: fit-content;
        }
    }
</style>
