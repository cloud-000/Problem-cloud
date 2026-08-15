<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { offlineRepository } from "$lib/offline/browser";
    import { deleteSession, type PracticeSessionRow } from "$lib/sessions";
    import { createDownloadedTrainerDataSource } from "$lib/trainer-data-source";
    import { defaultPracticeSettings } from "$lib/trainer";
    import type { PageData } from "./$types";
    import OfflinePracticeRoute from "./OfflinePracticeRoute.svelte";
    import PracticeView from "./PracticeView.svelte";

    let {
        data,
        requestedSessionId = null,
    }: {
        data: PageData;
        requestedSessionId?: string | null;
    } = $props();

    type View =
        | { kind: "loading" }
        | { kind: "empty" }
        | { kind: "error"; message: string }
        | { kind: "landing"; userId: string; sessions: PracticeSessionRow[] }
        | {
              kind: "practice";
              session: PracticeSessionRow;
              source: ReturnType<typeof createDownloadedTrainerDataSource>;
          }
        | { kind: "legacy"; packageId: string };

    let view = $state<View>({ kind: "loading" });
    let name = $state("");
    let starting = $state(false);

    async function start(nameValue: string | null) {
        if (view.kind !== "landing" || starting) return;
        starting = true;
        try {
            const repository = await offlineRepository();
            const session = await repository.createLocalSession(view.userId, {
                name: nameValue?.trim() || null,
                settings: defaultPracticeSettings(),
            });
            await goto(resolve(`/practice?session=${session.id}` as "/practice"));
        } finally {
            starting = false;
        }
    }

    async function practiceFreely() {
        if (view.kind !== "landing" || starting) return;
        starting = true;
        try {
            const repository = await offlineRepository();
            await repository.getOrCreateLocalRootSession(
                view.userId,
                defaultPracticeSettings(),
            );
            await goto(resolve("/practice?session=root" as "/practice"));
        } finally {
            starting = false;
        }
    }

    async function removeSession(session: PracticeSessionRow) {
        if (view.kind !== "landing" || starting) return;
        if (
            !window.confirm(
                "Delete this session? Synced answers stay in your history.",
            )
        ) {
            return;
        }
        starting = true;
        try {
            const repository = await offlineRepository();
            const { serverSessionId } = await repository.deleteLocalSession(
                view.userId,
                session.id,
                { discardPending: true },
            );
            if (serverSessionId != null && data.supabase) {
                await deleteSession(data.supabase, serverSessionId).catch(() => undefined);
            }
            view = {
                ...view,
                sessions: await repository.listLocalSessions(view.userId),
            };
        } finally {
            starting = false;
        }
    }

    onMount(async () => {
        try {
            const repository = await offlineRepository();
            const marker = await repository.getAccountMarker();
            if (!marker) {
                view = { kind: "empty" };
                return;
            }
            if (data.user && data.user.id !== marker.userId) {
                view = {
                    kind: "error",
                    message: "The downloads on this device belong to a different account.",
                };
                return;
            }
            const manifests = await repository.listPackages(marker.userId);
            if (manifests.length === 0) {
                view = { kind: "empty" };
                return;
            }

            if (requestedSessionId != null) {
                const sessionId = requestedSessionId === "root"
                    ? (await repository.getOrCreateLocalRootSession(
                        marker.userId,
                        defaultPracticeSettings(),
                    )).id
                    : Number(requestedSessionId);
                const session = Number.isInteger(sessionId)
                    ? await repository.loadSession(marker.userId, sessionId)
                    : null;
                if (session?.clientSessionId) {
                    view = {
                        kind: "practice",
                        session: session.row,
                        source: createDownloadedTrainerDataSource({
                            repository,
                            manifests,
                            sessionId,
                        }),
                    };
                    return;
                }
                const legacy = manifests.find((item) => item.sessionId === sessionId);
                if (legacy) {
                    view = { kind: "legacy", packageId: legacy.packageId };
                    return;
                }
                view = { kind: "error", message: "Downloaded practice session not found." };
                return;
            }

            view = {
                kind: "landing",
                userId: marker.userId,
                sessions: await repository.listLocalSessions(marker.userId),
            };
        } catch (cause) {
            view = {
                kind: "error",
                message: cause instanceof Error ? cause.message : String(cause),
            };
        }
    });
</script>

{#if view.kind === "practice"}
    <PracticeView
        {data}
        sessionParam={String(view.session.id)}
        trainerSource={view.source}
        backHref="/practice"
    />
{:else if view.kind === "legacy"}
    <OfflinePracticeRoute {data} packageId={view.packageId} />
{:else if view.kind === "loading"}
    <div class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Icon name="progress_activity" class="animate-spin" />
        Opening downloaded practice…
    </div>
{:else if view.kind === "empty"}
    <div class="flex h-full items-center justify-center px-6 text-center">
        <div class="max-w-lg">
            <h1 class="text-xl font-semibold">No downloaded practice is ready</h1>
            <p class="mt-2 type-secondary text-muted-foreground">
                Download some problems first, then Practice can use them without contacting the server.
            </p>
            <Button class="mt-4" href="/offline">Open downloads</Button>
        </div>
    </div>
{:else if view.kind === "error"}
    <div class="flex h-full items-center justify-center px-6 text-center">
        <div class="max-w-lg">
            <h1 class="text-xl font-semibold">Downloaded practice could not be opened</h1>
            <p class="mt-2 type-secondary text-muted-foreground">{view.message}</p>
            <Button class="mt-4" href="/practice">Back to Practice</Button>
        </div>
    </div>
{:else}
    <main class="mx-auto h-full w-full max-w-[720px] overflow-y-auto px-md py-lg">
        <h1 class="text-xl font-semibold">Practice</h1>
        <p class="mt-2 type-secondary text-muted-foreground">
            Start a normal session using every problem downloaded on this device.
        </p>
        <div class="mt-lg flex flex-col gap-sm rounded-lg border border-border bg-surface-container-lowest p-md sm:flex-row">
            <Input bind:value={name} placeholder="Session name (optional)" aria-label="Session name" />
            <Button disabled={starting} onclick={() => start(name)}>
                {starting ? "Starting…" : "Start session"}
            </Button>
            <Button variant="outline" disabled={starting} onclick={practiceFreely}>
                Practice freely
            </Button>
        </div>
        {#if view.sessions.length > 0}
            <h2 class="mt-xl text-base font-semibold">Local sessions</h2>
            <ul class="mt-sm flex flex-col gap-sm">
                {#each view.sessions as session (session.id)}
                    <li class="flex items-center justify-between gap-md rounded-lg border border-border bg-surface-container-lowest p-md">
                        <div>
                            <p class="font-medium">{session.name || "Practice session"}</p>
                            <p class="mt-1 type-caption text-muted-foreground">{session.times_seen} problems seen</p>
                        </div>
                        <div class="flex shrink-0 gap-2">
                            <Button size="sm" href={`/practice?session=${session.id}`}>Continue</Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={starting}
                                onclick={() => removeSession(session)}
                            >
                                Delete
                            </Button>
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}
    </main>
{/if}
