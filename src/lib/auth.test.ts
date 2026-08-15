import { describe, expect, test } from "bun:test";
import {
    AUTH_MAIL_FROM,
    authFailureMessage,
    validateSignupFields,
} from "./auth";

describe("validateSignupFields", () => {
    const ok = {
        email: "you@example.com",
        username: "ada",
        password: "secret1",
        passwordConfirm: "secret1",
    };

    test("accepts a complete signup", () => {
        expect(validateSignupFields(ok)).toBeNull();
    });

    test("rejects a short username", () => {
        expect(validateSignupFields({ ...ok, username: "ab" })).toBe(
            "Username must be at least 3 characters.",
        );
    });

    test("rejects a short password", () => {
        expect(validateSignupFields({ ...ok, password: "12345", passwordConfirm: "12345" }))
            .toBe("Password must be at least 6 characters.");
    });

    test("rejects a confirm mismatch", () => {
        expect(validateSignupFields({ ...ok, passwordConfirm: "secret2" })).toBe(
            "Passwords do not match.",
        );
    });
});

describe("authFailureMessage", () => {
    test("keeps credential failures generic", () => {
        expect(authFailureMessage({ code: "invalid_credentials", message: "Invalid login" }))
            .toBe("Invalid email or password.");
    });

    test("explains a duplicate email", () => {
        expect(authFailureMessage({ code: "email_exists", message: "User already registered" }))
            .toBe("An account with that email already exists. Try logging in.");
    });

    test("explains a failed confirmation send", () => {
        expect(
            authFailureMessage({
                code: "unexpected_failure",
                message: "Error sending confirmation email",
            }),
        ).toBe(
            `We couldn't send the confirmation email from ${AUTH_MAIL_FROM}. Try again in a minute.`,
        );
    });

    test("explains a username collision from the profile trigger", () => {
        expect(authFailureMessage({ message: "Database error saving new user" })).toBe(
            "That username is taken or invalid. Pick another (at least 3 characters).",
        );
    });

    test("falls back to the Auth message", () => {
        expect(authFailureMessage({ message: "Password should be at least 6 characters" }))
            .toBe("Password should be at least 6 characters");
    });
});
