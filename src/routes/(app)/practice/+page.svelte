<script lang="ts">
    import type { PageData } from "./$types";
    import { page } from "$app/state";
    import SessionsView from "./SessionsView.svelte";
    import OnlinePracticeRoute from "./OnlinePracticeRoute.svelte";
    import OfflinePracticeRoute from "./OfflinePracticeRoute.svelte";

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
{:else if sessionParam == null}
    <SessionsView {data} />
{:else}
    {#key sessionParam}
        <OnlinePracticeRoute {data} {sessionParam} />
    {/key}
{/if}
