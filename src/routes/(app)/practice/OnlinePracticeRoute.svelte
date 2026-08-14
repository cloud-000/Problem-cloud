<script lang="ts">
    import { untrack } from "svelte";
    import type { PageData } from "./$types";
    import { createOnlineTrainerDataSource } from "$lib/trainer-data-source";
    import PracticeView from "./PracticeView.svelte";

    let { data, sessionParam }: { data: PageData; sessionParam: string } = $props();
    const source = untrack(() =>
        createOnlineTrainerDataSource({
            supabase: data.supabase,
            userId: data.user?.id ?? null,
            sessionParam,
        }),
    );
</script>

<PracticeView {data} {sessionParam} trainerSource={source} />
