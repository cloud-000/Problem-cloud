<script lang="ts">
    import { Button } from "$lib/components/button";
    import { modal } from "$lib/state/modal.svelte";
</script>

<div class="space-y-4">
    <p>This modal has long scrollable content. Scroll down to see the footer and verify that background page scrolling is locked.</p>
    {#each Array(20) as _, i}
        <p class="text-muted-foreground">Paragraph {i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Aliquam id convallis eros. Quisque scelerisque risus a sem mollis, ac sollicitudin ligula dictum. Phasellus varius erat in lectus porttitor elementum.</p>
    {/each}
    <div class="flex justify-end gap-2 pt-4">
        <Button onclick={() => modal.close()}>Done Reading</Button>
    </div>
</div>
