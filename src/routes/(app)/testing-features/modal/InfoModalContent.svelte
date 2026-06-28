<script lang="ts">
    import { Button } from "$lib/components/button";
    import { modal } from "$lib/state/modal.svelte";
</script>

<div class="space-y-4">
    <p class="text-sm">This modal is rendered dynamically using the global <code>modal.show()</code> store API. It is great for decoupling modal logic from components.</p>
    <div class="flex justify-end gap-2">
        <Button variant="outline" onclick={() => modal.close()}>Close</Button>
    </div>
</div>
