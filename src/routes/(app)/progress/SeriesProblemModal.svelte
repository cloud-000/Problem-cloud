<script lang="ts">
    import { Problem } from "$lib/components/problem";
    import type { ProblemRow } from "$lib/library";

    let { problem }: { problem: ProblemRow } = $props();
</script>

<Problem {problem} mode="preview" isInstantFeedback />
