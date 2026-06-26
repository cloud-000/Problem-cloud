<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import { browser } from "$app/environment";
    import { Theme } from "$lib/utils/Theme.svelte";

    if (browser) {
        Theme.init("light");
    }

    let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
