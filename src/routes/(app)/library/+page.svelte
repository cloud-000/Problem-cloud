<script lang="ts">
    import { getAppState } from "$lib/appState.svelte.js";
    import Combobox from "$lib/components/combobox.svelte";
    import { Input } from "$lib/components/ui/input/.";
    let app = getAppState();
    let { data } = $props();
</script>

<Input type="text" placeholder="Query" class="max-w-xs" />
<div class="flex flex-row w-full gap-5">
    <Combobox
        items={[
            { label: "A", value: "algebra" },
            { label: "C", value: "combo" },
            { label: "G", value: "geometry" },
            { label: "N", value: "nt" },
        ]}
        class="grow"
        placeholder="Select Topic"
        emptyMessage="Nothing found, Select ACGN"
    />
    <Combobox
        items={[
            { label: "A", value: "algebra" },
            { label: "C", value: "combo" },
            { label: "G", value: "geometry" },
            { label: "N", value: "nt" },
        ]}
        class="grow"
        placeholder="Select Topic"
        emptyMessage="Nothing found, Select ACGN"
    />
</div>
