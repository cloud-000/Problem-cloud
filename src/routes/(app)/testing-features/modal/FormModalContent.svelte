<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";

    let username = $state("");
    let email = $state("");

    function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (!username || !email) {
            toasts.error("Please fill in all fields.");
            return;
        }
        toasts.success(`Submitted user: ${username} (${email})`);
        modal.close();
    }
</script>

<form onsubmit={handleSubmit} class="space-y-4">
    <div class="space-y-1">
        <label for="username" class="text-xs font-medium text-muted-foreground">Username</label>
        <Input id="username" placeholder="Type username..." bind:value={username} required />
    </div>
    <div class="space-y-1">
        <label for="email" class="text-xs font-medium text-muted-foreground">Email</label>
        <Input id="email" type="email" placeholder="user@example.com" bind:value={email} required />
    </div>
    <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => modal.close()}>Cancel</Button>
        <Button type="submit">Submit Details</Button>
    </div>
</form>
