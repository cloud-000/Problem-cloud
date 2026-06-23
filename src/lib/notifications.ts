import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";
import type { Toast, ToastSeverity } from "$lib/state/toast.svelte";

type Supabase = SupabaseClient<Database>;
export type NotificationRow = Tables<"notifications">;

const SEVERITIES: ToastSeverity[] = ["info", "success", "warning", "error"];

/**
 * Map a notifications row to a UI toast, deriving `severity` from `payload.type` and the
 * auto-dismiss `duration` (ms) from `payload.duration` (`0` = keep until closed).
 */
export function toToast(row: NotificationRow): Toast {
    const payload = row.payload as
        | { type?: unknown; duration?: unknown }
        | null;
    const severity =
        typeof payload?.type === "string" &&
        SEVERITIES.includes(payload.type as ToastSeverity)
            ? (payload.type as ToastSeverity)
            : "info";
    const duration =
        typeof payload?.duration === "number" && payload.duration >= 0
            ? payload.duration
            : undefined;
    return {
        id: `db:${row.id}`,
        notificationId: row.id,
        title: row.title,
        message: row.message,
        severity,
        duration,
    };
}

/**
 * Fetch notifications visible to the user (RLS filters `targets`) that they have not
 * yet marked read. Read filtering is done client-side against the user's own read rows.
 */
export async function fetchUnread(
    supabase: Supabase,
    userId: string,
    limit = 50,
): Promise<NotificationRow[]> {
    const [{ data: notifications }, { data: reads }] = await Promise.all([
        supabase
            .from("notifications")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit),
        supabase
            .from("notification_reads")
            .select("notification_id")
            .eq("user_id", userId),
    ]);

    const readIds = new Set((reads ?? []).map((r) => r.notification_id));
    return (notifications ?? []).filter((n) => !readIds.has(n.id));
}

/**
 * Subscribe to new notification inserts. `onInsert` fires only for rows targeting this
 * user (a guard on top of RLS-respecting realtime delivery). Returns the channel so the
 * caller can tear it down with `supabase.removeChannel(channel)`.
 */
export function subscribeToNotifications(
    supabase: Supabase,
    userId: string,
    onInsert: (row: NotificationRow) => void,
): RealtimeChannel {
    return supabase
        .channel("notifications")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications" },
            (payload) => {
                const row = payload.new as NotificationRow;
                if (!row.targets || row.targets.includes(userId)) {
                    onInsert(row);
                }
            },
        )
        .subscribe();
}

/** Persist that the user has read a notification (only called on explicit dismiss). */
export async function markRead(
    supabase: Supabase,
    userId: string,
    notificationId: number,
): Promise<void> {
    await supabase
        .from("notification_reads")
        .insert({ user_id: userId, notification_id: notificationId });
}
