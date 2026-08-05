<script lang="ts" module>
    import type { CoachContextLayer } from "$lib/ai/types";
    export type CoachContextRegisterProps = CoachContextLayer;
</script>

<script lang="ts">
    import { untrack } from "svelte";
    import { coach } from "$lib/state/coach.svelte";

    let props: CoachContextRegisterProps = $props();
    // Surface context is live (Library filters/results and Progress ranges can
    // change without a navigation), so replace this owner's layer whenever its
    // props change and remove only that exact registration on teardown.
    $effect(() => {
        const layer = { ...props };
        return untrack(() => coach.registerContext(layer));
    });
</script>
