<script lang="ts">
    import { AIChatModelPicker } from "#lib/components/ai-chat/index.js";
    import { coach } from "#lib/state/coach.svelte.js";
</script>

<AIChatModelPicker controller={coach} />
