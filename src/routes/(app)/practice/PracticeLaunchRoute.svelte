<script lang="ts">
    import { offlineMode } from "$lib/state/offline-mode.svelte";
    import type { PageData } from "./$types";
    import DownloadedPracticeRoute from "./DownloadedPracticeRoute.svelte";
    import OnlinePracticeRoute from "./OnlinePracticeRoute.svelte";
    import SessionsView from "./SessionsView.svelte";

    let {
        data,
        sessionParam,
    }: {
        data: PageData;
        sessionParam: string | null;
    } = $props();

    // This component is keyed by the requested session in +page.svelte. The
    // source is therefore chosen for each launch, then stays fixed for the
    // lifetime of the mounted trainer.
    const useLocalAtLaunch = offlineMode.effective === "local";
</script>

{#if useLocalAtLaunch}
    <DownloadedPracticeRoute {data} requestedSessionId={sessionParam} />
{:else if sessionParam == null}
    <SessionsView {data} />
{:else}
    <OnlinePracticeRoute {data} {sessionParam} />
{/if}
