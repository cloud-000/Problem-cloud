<script lang="ts">
    import { ToastContainer } from "$lib/components/toast";
    import { page } from "$app/state";
    import { Icon } from "$lib/components/icon";

    let { children } = $props();

    let isSubPage = $derived(
        page.url.pathname !== "/testing-features" &&
            page.url.pathname.startsWith("/testing-features"),
    );
</script>

<div class="p-6 max-w-4xl mx-auto flex flex-col gap-8">
    {#if isSubPage}
        <div class="flex">
            <a
                href="/testing-features"
                class="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
                <Icon name="arrow_back" fontsize="1.1rem" />
                Back to Feature Tests
            </a>
        </div>
    {/if}

    {@render children()}
</div>
<ToastContainer />
