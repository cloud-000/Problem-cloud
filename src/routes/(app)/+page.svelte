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

<h1 class="no-select">Welcome {app.username}</h1>
<p>Your rating: {app.rating}</p>
