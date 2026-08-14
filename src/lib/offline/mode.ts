import type { ConnectivityState } from "./connectivity";
import { isOffline } from "./connectivity";

export type OfflinePreference = "auto" | "downloaded-only";
export type EffectiveReadMode = "online" | "local";

export function effectiveReadMode(
    preference: OfflinePreference,
    connectivity: ConnectivityState,
): EffectiveReadMode {
    return preference === "downloaded-only" || isOffline(connectivity) ? "local" : "online";
}
