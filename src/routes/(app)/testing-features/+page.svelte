<script lang="ts">
    import { onMount } from "svelte";
    import { toasts } from "$lib/state/toast.svelte";
    onMount(() => {
        toasts.success("Saved!"); // message-only
        toasts.error("Upload failed", { title: "Error" }); // with title
        toasts.info("Heads up", { duration: 0 }); // sticky until closed
        toasts.show({ message: "Custom", severity: "warning", duration: 4000 });
    });
</script>
