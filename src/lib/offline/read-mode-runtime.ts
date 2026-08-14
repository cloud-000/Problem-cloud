import { effectiveReadMode, type EffectiveReadMode, type OfflinePreference } from "./mode";
import { nextConnectivity, type ConnectivityEvent, type ConnectivityState } from "./connectivity";

export type ReadModeSnapshot = {
    preference: OfflinePreference;
    connectivity: ConnectivityState;
    effective: EffectiveReadMode;
    lastLocalRead: boolean;
};

let preference: OfflinePreference = "auto";
let connectivity: ConnectivityState = "online";
let lastLocalRead = false;
const listeners = new Set<(snapshot: ReadModeSnapshot) => void>();

function snapshot(): ReadModeSnapshot {
    return { preference, connectivity, effective: effectiveReadMode(preference, connectivity), lastLocalRead };
}

function publish() {
    const value = snapshot();
    for (const listener of listeners) listener(value);
}

export const catalogReadRuntime = {
    get snapshot() { return snapshot(); },
    get effective() { return effectiveReadMode(preference, connectivity); },
    setPreference(value: OfflinePreference) { preference = value; publish(); },
    dispatch(event: ConnectivityEvent) { connectivity = nextConnectivity(connectivity, event); publish(); },
    noteRemoteSuccess() { connectivity = nextConnectivity(connectivity, { type: "probe-succeeded" }); lastLocalRead = false; publish(); },
    noteRemoteFailure() { connectivity = nextConnectivity(connectivity, { type: "probe-failed" }); publish(); },
    noteLocalRead() { lastLocalRead = true; publish(); },
    subscribe(listener: (value: ReadModeSnapshot) => void) {
        listeners.add(listener);
        listener(snapshot());
        return () => listeners.delete(listener);
    },
};
