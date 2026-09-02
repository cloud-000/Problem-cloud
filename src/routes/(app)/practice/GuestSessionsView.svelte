<script lang="ts">
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { onMount } from "svelte";
    import * as Page from "$lib/components/page";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { defaultPracticeSettings } from "$lib/trainer";
    import { guestPracticeRepository, type GuestSession } from "$lib/guest-practice/repository";

    let sessions = $state<GuestSession[]>([]);
    let error = $state<string | null>(null);
    let busy = $state(false);

    async function load() {
        try {
            sessions = await (await guestPracticeRepository()).sessions();
            error = null;
        } catch (cause) {
            error = (cause as Error).message;
        }
    }
    async function start() {
        if (busy) return;
        busy = true;
        try {
            const session = await (await guestPracticeRepository()).create({ settings: defaultPracticeSettings() });
            await goto(resolve(`/practice?session=guest:${session.id}`));
        } catch (cause) {
            error = (cause as Error).message;
            busy = false;
        }
    }
    async function open(session: GuestSession) {
        const repository = await guestPracticeRepository();
        if (session.status === "ended") await repository.save({ ...session, status: "active", ended_at: null });
        await goto(resolve(`/practice?session=guest:${session.id}`));
    }
    async function remove(session: GuestSession) {
        await (await guestPracticeRepository()).remove(session.id);
        await load();
    }
    onMount(() => { void load(); });
</script>

<Page.Root width="standard">
    <Page.Header title="Practice" description="Practice is saved in this browser only. Create an account to keep progress across devices." />
    {#if error}
        <div class="border-l-2 border-destructive py-2 pl-4 text-sm text-destructive">{error}</div>
    {/if}
    <Page.Section title="Quick practice" description="Start a browser-local free-practice session.">
        <Button onclick={start} disabled={busy}>Start practice <Icon name="arrow_forward" /></Button>
    </Page.Section>
    <Page.Section title="Saved on this device" description="Clearing browser data can remove these sessions.">
        {#if sessions.length === 0}
            <p class="type-secondary text-muted-foreground">No local sessions yet.</p>
        {:else}
            <div class="divide-y divide-border rounded-lg border border-border">
                {#each sessions as session (session.id)}
                    <div class="flex items-center justify-between gap-4 p-4">
                        <div><p class="font-medium">{session.name ?? "Practice session"}</p><p class="type-caption text-muted-foreground">{session.times_seen} problems · {session.status === "active" ? "Active" : "Ended"}</p></div>
                        <div class="flex gap-2"><Button size="sm" variant="outline" onclick={() => open(session)}>Resume</Button><Button size="sm" variant="ghost" onclick={() => remove(session)}>Delete</Button></div>
                    </div>
                {/each}
            </div>
        {/if}
    </Page.Section>
    <p class="type-secondary text-muted-foreground">Want progress across browsers and devices? <a class="underline" href="/auth/signup">Create an account</a>.</p>
</Page.Root>
