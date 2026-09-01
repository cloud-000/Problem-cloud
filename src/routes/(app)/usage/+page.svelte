<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { hostedPeriodLabel } from "$lib/ai/hosted-allowance";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();
    let { session } = $derived(data);
    let allowance = $derived(data.hostedAllowance ?? null);
    let settingsAiHref = $derived(`${resolve("/settings")}#ai`);

    let description = $derived.by(() => {
        if (!session) return "Sign in to see how much free Coach you have left.";
        if (!allowance) {
            return "Free Coach is not offered on this deployment. You can still bring your own key.";
        }
        if (allowance.remainingPct === 0) {
            return `This period's free Coach is used up. It resets ${formatResetDate(allowance.resetsOn)}.`;
        }
        return `${allowance.remainingPct}% of your free Coach remaining ${hostedPeriodLabel(allowance.period)}.`;
    });

    function formatCount(value: number): string {
        return value.toLocaleString();
    }

    function formatResetDate(isoDate: string): string {
        const [year, month, day] = isoDate.split("-").map(Number);
        return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });
    }

    function usedPct(used: number, limit: number): number {
        if (limit <= 0) return 100;
        return Math.min(100, Math.max(0, (used / limit) * 100));
    }

    function meterClass(used: number, limit: number): string {
        if (limit <= 0 || used >= limit) return "bg-destructive";
        if (used / limit >= 0.8) return "bg-unsure";
        return "bg-primary";
    }
</script>

{#snippet meter(row: { label: string; hint: string; used: number; limit: number })}
    {@const pct = usedPct(row.used, row.limit)}
    <div class="flex flex-col gap-3 py-4">
        <div class="flex items-start justify-between gap-6">
            <div class="min-w-0">
                <p class="type-body font-medium text-foreground">{row.label}</p>
                <p class="mt-0.5 type-secondary text-muted-foreground">{row.hint}</p>
            </div>
            <p class="type-secondary shrink-0 tabular-nums text-muted-foreground">
                {formatCount(row.used)} of {formatCount(row.limit)} used
            </p>
        </div>
        <div
            class="h-2 w-full overflow-hidden rounded-full bg-surface-container-high"
            role="progressbar"
            aria-label="{row.label} used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
        >
            <div
                class={["h-full rounded-full transition-[width]", meterClass(row.used, row.limit)]}
                style:width={`${pct}%`}
            ></div>
        </div>
    </div>
{/snippet}

<svelte:head>
    <title>Usage · ProblemCloud</title>
</svelte:head>

<Page.Root width="narrow" class="gap-10">
    <Page.Header title="Usage" {description} />

    {#if !session}
        <Page.Section>
            <div
                class="flex flex-col gap-4 border-y border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
                <div>
                    <p class="type-body font-medium text-foreground">You are not logged in</p>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Log in to see remaining free Coach for this account.
                    </p>
                </div>
                <Button href="/auth/login" variant="primary" class="shrink-0">Log in</Button>
            </div>
        </Page.Section>
    {:else if allowance}
        <Page.Section
            title="Free Coach"
            description="Turns and credits share one allowance. Whichever runs out first is what the profile menu reports."
        >
            <div class="divide-y divide-border/60 border-y border-border/60">
                <div
                    class="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
                >
                    <div class="min-w-0">
                        <p class="type-body font-medium text-foreground">Remaining</p>
                        <p class="mt-0.5 type-secondary text-muted-foreground">
                            {#if allowance.remainingPct === 0}
                                None left {hostedPeriodLabel(allowance.period)}
                            {:else}
                                {allowance.remainingPct}% left {hostedPeriodLabel(allowance.period)}
                            {/if}
                        </p>
                    </div>
                    <p
                        class={[
                            "shrink-0 text-2xl font-semibold tabular-nums",
                            allowance.remainingPct === 0 ? "text-destructive" : "text-foreground",
                        ]}
                    >
                        {allowance.remainingPct}%
                    </p>
                </div>

                {@render meter({
                    label: "Turns",
                    hint: "Each Coach reply uses one turn.",
                    used: allowance.turns,
                    limit: allowance.turnLimit,
                })}
                {@render meter({
                    label: "Credits",
                    hint: "Credits track how much the model generated. Longer replies cost more.",
                    used: allowance.credits,
                    limit: allowance.creditLimit,
                })}

                <dl class="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt class="type-secondary text-muted-foreground">Resets</dt>
                    <dd class="type-body text-foreground sm:text-right">
                        {formatResetDate(allowance.resetsOn)}
                    </dd>
                </dl>
            </div>
        </Page.Section>

        <Page.Section
            title="Need more?"
            description="Your own provider key is unlimited by this allowance and never leaves this browser."
        >
            <div
                class="flex flex-col gap-4 border-y border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
                <div>
                    <p class="type-body font-medium text-foreground">Bring your own key</p>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Connect OpenRouter, OpenAI, or a local endpoint in Settings.
                    </p>
                </div>
                <Button href={settingsAiHref} variant="outline" class="shrink-0">
                    <Icon name="settings" fontsize="1.1rem" />
                    Open AI settings
                </Button>
            </div>
        </Page.Section>
    {:else}
        <Page.Section
            title="Free Coach"
            description="This server is not running a first-party Coach connection."
        >
            <div
                class="flex flex-col gap-4 border-y border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
                <div>
                    <p class="type-body font-medium text-foreground">Add your own key</p>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Bring-your-own-key requests go straight from this browser to the provider.
                        Your key never reaches our servers.
                    </p>
                </div>
                <Button href={settingsAiHref} variant="outline" class="shrink-0">
                    <Icon name="settings" fontsize="1.1rem" />
                    Open AI settings
                </Button>
            </div>
        </Page.Section>
    {/if}
</Page.Root>
