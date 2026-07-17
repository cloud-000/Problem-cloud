<script lang="ts">
    import { untrack } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Select } from "$lib/components/select";
    import { AI_PRESET_IDS, presetFor } from "$lib/ai/presets";
    import type { AIPresetId } from "$lib/ai/types";
    import { aiCredentials } from "$lib/state/ai-credentials.svelte";
    import { coach } from "$lib/state/coach.svelte";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { testConnection } from "./test-connection";

    let { existingId }: { existingId?: string } = $props();

    // modal.show() mounts a fresh instance per open, so the edited connection is a
    // one-time snapshot: the form owns its fields from here and must not be clobbered
    // by later store writes.
    const existing = untrack(() => (existingId ? aiCredentials.get(existingId) : undefined));

    let preset = $state<AIPresetId>(existing?.preset ?? "openai");
    let label = $state(existing?.label ?? presetFor("openai").label);
    let baseURL = $state(existing?.baseURL ?? presetFor("openai").baseURL);
    // Left blank when editing: the stored key is never written back into the DOM, so a
    // blank field means "keep the existing key" rather than "clear it".
    let apiKey = $state("");
    let testing = $state(false);

    let activePreset = $derived(presetFor(preset));
    let isCustom = $derived(preset === "custom");
    let keyRequired = $derived(activePreset.requiresKey && !existing);
    let canSave = $derived(
        label.trim().length > 0 && baseURL.trim().length > 0 && (!keyRequired || apiKey.length > 0),
    );

    const presetOptions = AI_PRESET_IDS.map((id) => ({ value: id, label: presetFor(id).label }));

    function selectPreset(value: string) {
        const next = value as AIPresetId;
        // Keep a name the user actually typed; replace one that is still a preset default.
        const untouched =
            !label.trim() || AI_PRESET_IDS.some((id) => label === presetFor(id).label);
        preset = next;
        if (untouched) label = presetFor(next).label;
        baseURL = presetFor(next).baseURL;
    }

    /** The effective connection being described, for save and for test. */
    function draft() {
        return {
            preset,
            label: label.trim(),
            baseURL: baseURL.trim().replace(/\/$/, ""),
            apiKey: apiKey || existing?.apiKey || "",
            models: existing?.models,
        };
    }

    async function test() {
        testing = true;
        await testConnection({ ...draft(), id: existing?.id ?? "probe" });
        testing = false;
    }

    async function handleSubmit(event: SubmitEvent) {
        event.preventDefault();
        if (!canSave) return;
        if (existing) {
            aiCredentials.update(existing.id, draft());
            toasts.success("Connection updated.");
        } else {
            aiCredentials.add(draft());
            toasts.success("Connection added.");
        }
        modal.close();
        await coach.initialize(true);
    }
</script>

<form onsubmit={handleSubmit} class="space-y-4">
    <p class="text-xs text-muted-foreground">
        Your key is stored in this browser only, and requests go straight from here to the
        provider. It never reaches your ProblemCloud account or our servers.
    </p>

    <div class="space-y-1">
        <label for="ai-connection-preset" class="text-xs font-medium text-muted-foreground">
            Provider
        </label>
        <Select
            id="ai-connection-preset"
            value={preset}
            options={presetOptions}
            onchange={selectPreset}
            disabled={Boolean(existing)}
            class="w-full"
        />
    </div>

    <div class="space-y-1">
        <label for="ai-connection-label" class="text-xs font-medium text-muted-foreground">
            Name
        </label>
        <Input id="ai-connection-label" bind:value={label} maxlength={60} placeholder="My OpenAI" />
    </div>

    <div class="space-y-1">
        <label for="ai-connection-url" class="text-xs font-medium text-muted-foreground">
            Endpoint
        </label>
        <Input
            id="ai-connection-url"
            bind:value={baseURL}
            readonly={!isCustom}
            placeholder="http://localhost:11434/v1"
            class={isCustom ? "" : "text-muted-foreground"}
        />
        {#if isCustom}
            <p class="text-[11px] text-muted-foreground">
                Any endpoint that speaks the OpenAI Chat Completions API. Local addresses work,
                since the request is made by this browser.
            </p>
        {/if}
    </div>

    <div class="space-y-1">
        <label for="ai-connection-key" class="text-xs font-medium text-muted-foreground">
            API key
        </label>
        <Input
            id="ai-connection-key"
            type="password"
            bind:value={apiKey}
            autocomplete="off"
            placeholder={existing ? "Leave blank to keep the current key" : activePreset.keyPlaceholder}
        />
        {#if activePreset.docsUrl}
            <p class="text-[11px] text-muted-foreground">
                <a
                    href={activePreset.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="underline underline-offset-2 hover:text-foreground"
                >
                    Get a key from {activePreset.label}
                </a>
            </p>
        {/if}
    </div>

    <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => modal.close()}>Cancel</Button>
        <Button type="button" variant="outline" onclick={test} disabled={!canSave || testing}>
            {#if testing}
                <Icon name="progress_activity" class="animate-spin" fontsize="1.1rem" />
                Testing…
            {:else}
                Test
            {/if}
        </Button>
        <Button type="submit" disabled={!canSave}>
            <Icon name="check" fontsize="1.1rem" />
            {existing ? "Save" : "Add connection"}
        </Button>
    </div>
</form>
