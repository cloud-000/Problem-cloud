<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { presetFor } from "$lib/ai/presets";
    import { aiCredentials } from "$lib/state/ai-credentials.svelte";
    import { coach } from "$lib/state/coach.svelte";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import AIConnectionModal from "./AIConnectionModal.svelte";
    import { testConnection } from "./test-connection";

    let testingId = $state<string | undefined>(undefined);

    function openModal(existingId?: string) {
        modal.show(
            AIConnectionModal,
            { existingId },
            { title: existingId ? "Edit AI connection" : "Add AI connection", size: "md" },
        );
    }

    async function remove(id: string, label: string) {
        aiCredentials.remove(id);
        toasts.success(`Removed ${label}.`);
        await coach.initialize(true);
    }

    async function test(id: string) {
        const connection = aiCredentials.get(id);
        if (!connection) return;
        testingId = id;
        // Probed straight from the browser, exactly the way a real request will run.
        await testConnection(connection);
        testingId = undefined;
    }
</script>

<!-- Hidden entirely when the Coach is switched off server-side: a connection form that
     cannot reach a working endpoint is worse than no form. -->
{#if coach.enabled}
<div
    class="border border-border/50 rounded-xl p-6 bg-surface-container-lowest shadow-xs flex flex-col gap-6"
>
    <div>
        <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="key" class="text-primary-foreground" />
            AI Connections
        </h2>
        <p class="text-xs text-muted-foreground mt-0.5">
            Bring your own API key to use the coach. Requests go straight from this browser
            to the provider, so your key never reaches our servers or your ProblemCloud
            account. It is stored in this browser, where anyone with access to it can read it.
        </p>
    </div>

    {#if aiCredentials.connections.length === 0}
        <div
            class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/60 px-4 py-8 text-center"
        >
            <Icon name="link_off" class="text-muted-foreground" fontsize="1.75rem" />
            <div>
                <p class="text-sm font-medium text-foreground">No connections yet</p>
                <p class="text-xs text-muted-foreground mt-0.5">
                    Add a provider key to start using the coach.
                </p>
            </div>
            <Button size="sm" onclick={() => openModal()}>
                <Icon name="add" fontsize="1.1rem" />
                Add connection
            </Button>
        </div>
    {:else}
        <div class="flex flex-col gap-2">
            {#each aiCredentials.connections as connection (connection.id)}
                <div
                    class="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-surface-container-low px-4 py-3"
                >
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <span class="text-sm font-medium text-foreground truncate">
                            {connection.label}
                        </span>
                        <span class="text-xs text-muted-foreground truncate">
                            {presetFor(connection.preset).label} · {aiCredentials.maskedKey(
                                connection.id,
                            )}
                        </span>
                    </div>
                    <div class="flex shrink-0 gap-1.5">
                        <Button
                            size="sm"
                            variant="outline"
                            onclick={() => test(connection.id)}
                            disabled={testingId === connection.id}
                        >
                            {#if testingId === connection.id}
                                <Icon name="progress_activity" class="animate-spin" fontsize="1.1rem" />
                            {:else}
                                Test
                            {/if}
                        </Button>
                        <Button size="sm" variant="outline" onclick={() => openModal(connection.id)}>
                            Edit
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onclick={() => remove(connection.id, connection.label)}
                        >
                            Remove
                        </Button>
                    </div>
                </div>
            {/each}
        </div>
        <div class="flex justify-start">
            <Button size="sm" variant="outline" onclick={() => openModal()}>
                <Icon name="add" fontsize="1.1rem" />
                Add another
            </Button>
        </div>
    {/if}
</div>
{/if}
