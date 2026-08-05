<script lang="ts">
    import { coach } from "$lib/state/coach.svelte";
    import CoachContextChips from "./coach-context-chips.svelte";
</script>

{#if coach.activeContexts.length > 0}
    <div class="flex shrink-0 items-center overflow-x-auto border-b border-border/40 px-3 py-2 text-xs bg-surface-container-lowest/50">
        <CoachContextChips />
    </div>
{/if}

