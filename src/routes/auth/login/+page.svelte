<script lang="ts" module>
    import { enhance } from "$app/forms";
</script>

<script lang="ts">
    import type { ActionData } from "./$types";
    let { form }: { form: ActionData } = $props();
</script>

<form method="POST" use:enhance>
    <label>
        Email
        <input name="email" type="email" required />
    </label>
    <label>
        Password
        <input name="password" type="password" required />
    </label>

    {#if form?.message}
        <p class="error">{form.message}</p>
    {/if}

    <button type="submit">Log in</button>
</form>
