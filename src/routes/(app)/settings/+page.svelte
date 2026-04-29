<script lang="ts">
    import { getAppState } from "$lib/appState.svelte.js";

    let { data } = $props();
    const app = getAppState();
</script>

<h1>Settings</h1>
<p>Theme: {app.theme?.name}</p>
<select>
    {#each app.themes as theme}
        <option>{theme.name}</option>
    {/each}
</select>

<style>
    h1 {
        margin: 0;
        padding: 0;
    }
</style>
