<script lang="ts">
    import { getAppState } from "$lib/appState.svelte.js";
    import { Button } from "$lib/components/ui/button/.";
    import * as Popover from "$lib/components/ui/popover/.";
    import * as Select from "$lib/components/ui/select/.";
    let { data } = $props();
    const app = getAppState();
</script>

<h1 class="text-3xl font-extrabold">Settings</h1>
<p>Theme: {app.theme}</p>

<Button>Click Me</Button>
<Button variant="outline">Button</Button>
<Popover.Root>
    <Popover.Trigger>Open</Popover.Trigger>
    <Popover.Content>Place content for the popover here.</Popover.Content>
</Popover.Root>
<Select.Root
    type="single"
    onValueChange={(theme) => {
        app.theme = theme;
    }}
>
    <Select.Trigger>{app.theme}</Select.Trigger>
    <Select.Content>
        {#each app.themes as theme}
            <Select.Item value={theme.name}>{theme.name}</Select.Item>
        {/each}
    </Select.Content>
</Select.Root>

<style>
    h1 {
        margin: 0;
        padding: 0;
    }
</style>
