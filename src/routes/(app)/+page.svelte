<script lang="ts">
    import { getAppState } from "$lib/appState.svelte";

    // import { getAppState } from "$lib/appState.js";

    // import { getRating } from "$lib/db/supabaseClient.js";
    let { data } = $props();

    console.log("Hello from app/");
    const app = getAppState();
    (async () => {
        // console.log(`Hello ${await data.data.user?.username}`);
        // console.log();
    })();
    // await getRating(data.supabase, data.data.user?.id ?? null)
</script>

<span class="no-select text-3xl"
    >Welcome
    <span class="bg-primary">{app.username}</span>
</span>
<p>Rating: {app.rating}</p>
<span class="text-2xl">Recent problems</span>
