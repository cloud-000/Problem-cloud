<script lang="ts" module>
    import type { CoachContextLayer } from "$lib/ai/types";
    export type CoachContextRegisterProps = CoachContextLayer;
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { coach } from "$lib/state/coach.svelte";

    let props: CoachContextRegisterProps = $props();
    onMount(() => coach.registerContext({ ...props }));
</script>
