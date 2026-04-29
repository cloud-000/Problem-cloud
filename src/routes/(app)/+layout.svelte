<script lang="ts">
    import { page } from "$app/state";
    import { Navbar } from "$lib/components/navbar";
    import Button from "$lib/components/button.svelte";
    let { children } = $props();
    const navItems = [
        { label: "Home", href: "/", icon: "home" },
        { label: "Library", href: "/library", icon: "category_search" },
        { label: "Train", href: "/trainer", icon: "exercise" },
    ];
</script>

<Navbar.Root>
    <!-- <Navbar.Edge>Hello</Navbar.Edge> -->
    <Navbar.Content>
        {#each navItems as item}
            <Button
                text={item.label}
                icon={item.icon}
                href={item.href}
                variant="nav"
                active={page.url.pathname == item.href}
                mobileHelp
            />
            <!-- <a href={item.href}>{item.label}</a> -->
        {/each}
    </Navbar.Content>
    <Navbar.Edge>
        <Button href="/settings" variant="nav" text="" icon="settings"></Button>
    </Navbar.Edge>
</Navbar.Root>
<div class="expand flex" id="page-content-wrapper">
    {@render children()}
</div>

<style>
    #page-content-wrapper {
        flex-direction: column;
        align-items: start;
        justify-content: start;
    }
</style>
