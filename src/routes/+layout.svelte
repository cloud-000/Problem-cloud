<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import { browser } from "$app/environment";
    import { Theme } from "$lib/utils/Theme.svelte";
    import { deviceDetails } from "$lib/mobile.svelte";
    if (browser) {
        Theme.init("light");
    }

    let { children } = $props();
    $inspect(deviceDetails.isMobile);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<div
    class={`w-full h-full overflow-clip ${deviceDetails.isMobile ? "is-mobile" : ""}`}
>
    {@render children()}
</div>
