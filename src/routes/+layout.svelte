<!--
  The root layout is presentation-only, and must stay that way. Its data would
  be attached to every document in the app — including the credential-free
  `/offline-shell` entry the service worker caches — so the authenticated session /
  profile load lives under `(app)` instead (`docs/offline.md` §3a).
-->
<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import { browser } from "$app/environment";
    import { Theme } from "$lib/utils/Theme.svelte";
    import { deviceDetails } from "$lib/mobile.svelte";
    if (browser) {
        Theme.init(deviceDetails.isKindle ? "kindle" : "light");
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
