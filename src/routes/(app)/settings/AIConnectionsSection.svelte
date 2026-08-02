<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
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

<Page.Section
    title="AI connections"
    description="Bring your own provider key to use Coach. Requests go directly from this browser to the provider; your key never reaches our servers or your ProblemCloud account. Keys are stored in this browser and can be read by anyone with access to it."
>
        <div class="border-y border-border/60 divide-y divide-border/60">
            {#each aiCredentials.connections as connection (connection.id)}
                <div
                    class="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
                >
                    <div class="min-w-0">
                        <p class="truncate type-body font-medium text-foreground">
                            {connection.label}
                        </p>
                        <p class="mt-0.5 truncate type-secondary text-muted-foreground">
                            {presetFor(connection.preset).label} · {aiCredentials.maskedKey(
                                connection.id,
                            )}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-wrap gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onclick={() => test(connection.id)}
                            disabled={testingId === connection.id}
                        >
                            {#if testingId === connection.id}
                                <Icon
                                    name="progress_activity"
                                    class="animate-spin"
                                    fontsize="1.1rem"
                                />
                                Testing…
                            {:else}
                                Test
                            {/if}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onclick={() => openModal(connection.id)}
                        >
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
            {:else}
                <div
                    class="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
                >
                    <div>
                        <p class="type-body font-medium text-foreground">No connections yet</p>
                        <p class="mt-0.5 type-secondary text-muted-foreground">
                            Add a provider key to start using Coach.
                        </p>
                    </div>
                    <Button size="sm" onclick={() => openModal()} class="shrink-0">
                        <Icon name="add" fontsize="1.1rem" />
                        Add connection
                    </Button>
                </div>
            {/each}

            {#if aiCredentials.connections.length > 0}
                <div class="py-4">
                    <Button size="sm" variant="outline" onclick={() => openModal()}>
                        <Icon name="add" fontsize="1.1rem" />
                        Add another connection
                    </Button>
                </div>
            {/if}
        </div>
</Page.Section>
