<script lang="ts">
    import { getAppState } from "$lib/appState.svelte.js";
    import Combobox from "$lib/components/combobox.svelte";
    import { Input } from "$lib/components/ui/input/.";
    let app = getAppState();
    let { data } = $props();
    let test = [];
</script>

<Input type="text" placeholder="Query" class="max-w-xs" />
<Combobox items={test} />
