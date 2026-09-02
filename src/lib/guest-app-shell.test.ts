import { describe, expect, test } from "bun:test";
import {
    GUEST_APP_SHELL_COOKIE,
    hasGuestSeenAppShell,
} from "./guest-app-shell";

describe("guest app shell gate", () => {
    test("treats only an explicit cookie as seen", () => {
        expect(hasGuestSeenAppShell(null)).toBe(false);
        expect(hasGuestSeenAppShell({ get: () => undefined })).toBe(false);
        expect(hasGuestSeenAppShell({ get: () => "0" })).toBe(false);
        expect(
            hasGuestSeenAppShell({
                get: (name) =>
                    name === GUEST_APP_SHELL_COOKIE ? "1" : undefined,
            }),
        ).toBe(true);
    });
});
