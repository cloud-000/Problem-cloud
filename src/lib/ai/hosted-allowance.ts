/**
 * Client-safe hosted Coach allowance. Limits and remaining percent are computed
 * on the server; this module only formats and snapshots that view. It must never
 * import `$lib/server` — the profile menu and `/usage` both read it.
 */

export interface HostedAllowance {
    /** Tighter of credit/turn remaining, 0–100. */
    remainingPct: number;
    credits: number;
    creditLimit: number;
    turns: number;
    turnLimit: number;
    period: "month" | "day";
    /** Inclusive UTC start of the current period, `YYYY-MM-DD`. */
    periodStart: string;
    /** Exclusive UTC start of the next period, `YYYY-MM-DD`. */
    resetsOn: string;
}

export function hostedRemainingPct(
    usage: { credits: number; turns: number },
    limits: { creditLimit: number; turnLimit: number },
): number {
    if (limits.creditLimit <= 0 || limits.turnLimit <= 0) return 0;
    const used = Math.max(
        usage.credits / limits.creditLimit,
        usage.turns / limits.turnLimit,
    );
    if (!Number.isFinite(used) || used >= 1) return 0;
    if (used <= 0) return 100;
    return Math.min(100, Math.max(1, Math.round((1 - used) * 100)));
}

export function hostedResetsOn(period: "month" | "day", periodStart: string): string {
    const [year, month, day] = periodStart.split("-").map(Number);
    if (!year || !month || !day) return periodStart;
    if (period === "day") {
        return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    }
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

export function hostedAllowanceSnapshot(input: {
    credits: number;
    turns: number;
    periodStart: string;
    creditLimit: number;
    turnLimit: number;
    period: "month" | "day";
}): HostedAllowance {
    return {
        remainingPct: hostedRemainingPct(input, input),
        credits: input.credits,
        creditLimit: input.creditLimit,
        turns: input.turns,
        turnLimit: input.turnLimit,
        period: input.period,
        periodStart: input.periodStart,
        resetsOn: hostedResetsOn(input.period, input.periodStart),
    };
}

export function hostedUsageMenuLabel(remainingPct: number): string {
    return `Usage ${remainingPct}% remaining`;
}

export function hostedPeriodLabel(period: "month" | "day"): string {
    return period === "day" ? "today" : "this month";
}
