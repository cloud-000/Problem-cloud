<script lang="ts" module>
    import type { Snippet } from "svelte";
    import type {
        UtilityPanelSizing,
        UtilityPanelView,
    } from "$lib/state/utility-panel.svelte";

    export interface UtilityPanelRegisterProps {
        view: UtilityPanelView;
        ownerId: string;
        label: string;
        sizing?: UtilityPanelSizing;
        children: Snippet;
    }
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";

    let { view, ownerId, label, sizing, children }: UtilityPanelRegisterProps = $props();

    onMount(() => utilityPanel.register({ view, ownerId, label, sizing, content: children }));
</script>
