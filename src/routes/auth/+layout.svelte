<script lang="ts">
    let { children } = $props();
    import { enhance } from "$app/forms";
</script>

<div class="auth-card box-border p-xl">
    <form
        method="POST"
        use:enhance
        class="flex flex-col gap-md w-full border-md border-secondary/50 p-md rounded-xl"
    >
        {@render children()}
    </form>
</div>

<style>
    .auth-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100vw;
        height: 100vh;
    }
</style>
