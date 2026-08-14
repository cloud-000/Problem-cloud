<script lang="ts">
    import type { PageData } from "./$types";
    import { page } from "$app/state";
    import OfflinePracticeRoute from "./OfflinePracticeRoute.svelte";
    import PracticeLaunchRoute from "./PracticeLaunchRoute.svelte";

    let { data }: { data: PageData } = $props();

    // `?session=` selects the view at this single route:
    //   absent        → the sessions hub (landing)
    //   "root"        → ungrouped practice
    //   "<id>"        → practice filed into that session (resumes its settings)
    let sessionParam = $derived(page.url.searchParams.get("session"));
    let offlinePackage = $derived(page.url.searchParams.get("offlinePackage"));
</script>

{#if offlinePackage != null}
    {#key offlinePackage}
        <OfflinePracticeRoute {data} packageId={offlinePackage} />
    {/key}
{:else}
    {#key sessionParam}
        <PracticeLaunchRoute {data} {sessionParam} />
    {/key}
{/if}
