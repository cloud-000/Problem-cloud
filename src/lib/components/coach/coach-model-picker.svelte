<script lang="ts">
    import { AIChatModelPicker } from "$lib/components/ai-chat";
    import { coach } from "$lib/state/coach.svelte";
</script>

<AIChatModelPicker controller={coach} />
