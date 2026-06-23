/*
One thing worth flagging for later: the store is a module singleton,
which is the right call for client-side show() calls but means it shouldn't be touched during SSR.
Today it's only ever driven from $effect/event handlers (client-only), so we're fine
— just keep toasts.show() out of any load function or top-level component script that runs on the server.
*/
export type ToastSeverity = "info" | "success" | "warning" | "error";

export interface Toast {
    id: string; // render + dismissal key ("db:<pk>" or "local:<n>")
    notificationId?: number; // present only for DB-backed toasts (used for read-marking)
    title?: string;
    message: string;
    severity: ToastSeverity;
    /** Auto-dismiss delay in ms; `0` keeps the toast until closed. Defaults when unset. */
    duration?: number;
}

export interface ToastOptions {
    title?: string;
    message: string;
    severity?: ToastSeverity;
    /** Auto-dismiss delay in ms; `0` keeps the toast until it is closed. */
    duration?: number;
}

const DEFAULT_DURATION = 6000;

/**
 * Pure-UI store for active toast notifications. It holds no Supabase knowledge.
 *
 * Two kinds of toast share this store:
 *  - DB-backed (added via `add` with a `notificationId`) — deduped within the session and
 *    read-marked by the layout on explicit close.
 *  - Client-only (fired via `show` / the severity shorthands) — ephemeral, never deduped,
 *    and never touch the database.
 *
 * Auto-dismiss removes a toast visually but does not mark it read, so unread DB toasts
 * reappear on next load.
 */
class ToastStore {
    toasts = $state<Toast[]>([]);
    // Toast ids already shown this session, so fetch-on-mount and realtime can't double up.
    private seen = new Set<string>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private counter = 0;

    /**
     * Add a pre-built toast (e.g. mapped from a DB row). Deduped by `id`. The auto-dismiss
     * delay resolves from the explicit `duration` arg, then `toast.duration`, then the
     * default; `0` keeps the toast until it is closed.
     */
    add(toast: Toast, duration?: number): string {
        if (this.seen.has(toast.id)) return toast.id;
        this.seen.add(toast.id);
        this.toasts.push(toast);

        const ms = duration ?? toast.duration ?? DEFAULT_DURATION;
        if (ms > 0) {
            this.timers.set(
                toast.id,
                setTimeout(() => this.dismiss(toast.id), ms),
            );
        }
        return toast.id;
    }

    /** Fire a client-only toast. Returns its id so callers can dismiss it early. */
    show(opts: ToastOptions): string {
        const { duration, severity = "info", ...rest } = opts;
        return this.add(
            { id: `local:${++this.counter}`, severity, ...rest },
            duration,
        );
    }

    success = (
        message: string,
        opts: Omit<ToastOptions, "message" | "severity"> = {},
    ) => this.show({ ...opts, message, severity: "success" });
    error = (
        message: string,
        opts: Omit<ToastOptions, "message" | "severity"> = {},
    ) => this.show({ ...opts, message, severity: "error" });
    info = (
        message: string,
        opts: Omit<ToastOptions, "message" | "severity"> = {},
    ) => this.show({ ...opts, message, severity: "info" });
    warning = (
        message: string,
        opts: Omit<ToastOptions, "message" | "severity"> = {},
    ) => this.show({ ...opts, message, severity: "warning" });

    /** Remove a toast from view only — does not mark it read in the database. */
    dismiss(id: string) {
        const timer = this.timers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
        this.toasts = this.toasts.filter((t) => t.id !== id);
    }
}

export const toasts = new ToastStore();
