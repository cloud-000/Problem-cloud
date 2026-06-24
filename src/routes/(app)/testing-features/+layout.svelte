<script lang="ts">
    import { ToastContainer } from "$lib/components/toast";

    let { children } = $props();
</script>

{@render children()}
<ToastContainer />
