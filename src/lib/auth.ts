/** From-address Auth uses on the hosted project (Supabase SMTP sender). */
export const AUTH_MAIL_FROM = "cloud.hermes.bot@gmail.com";

const USERNAME_MIN = 3;
const PASSWORD_MIN = 6;

export function validateUsername(usernameInput: string): string | null {
    if (usernameInput.trim().length < USERNAME_MIN) {
        return `Username must be at least ${USERNAME_MIN} characters.`;
    }
    return null;
}

export function validateSignupFields(input: {
    email: string;
    username: string;
    password: string;
    passwordConfirm: string;
}): string | null {
    const email = input.email.trim();
    const username = input.username.trim();
    if (!email) return "Enter an email address.";
    const usernameError = validateUsername(username);
    if (usernameError) return usernameError;
    if (input.password.length < PASSWORD_MIN) {
        return `Password must be at least ${PASSWORD_MIN} characters.`;
    }
    if (input.password !== input.passwordConfirm) {
        return "Passwords do not match.";
    }
    return null;
}

/** Map a GoTrue / supabase-js Auth error to a sentence the student can act on. */
export function authFailureMessage(error: {
    message?: string | null;
    code?: string | null;
}): string {
    const code = error.code ?? "";
    const message = (error.message ?? "").trim();

    switch (code) {
        case "invalid_credentials":
            return "Invalid email or password.";
        case "email_exists":
        case "user_already_exists":
            return "An account with that email already exists. Try logging in.";
        case "weak_password":
            return message || "That password is too weak. Choose a longer or less common one.";
        case "email_not_confirmed":
            return `Confirm your email before logging in. Check your inbox for a message from ${AUTH_MAIL_FROM}.`;
        case "email_address_not_authorized":
            return "This project cannot send mail to that address yet. Use a team email, or ask an admin to finish SMTP setup.";
        case "email_address_invalid":
            return "That email address cannot be used. Try a different one.";
        case "over_email_send_rate_limit":
            return "Too many emails were just sent. Wait a few minutes and try again.";
        case "over_request_rate_limit":
            return "Too many attempts. Wait a few minutes and try again.";
        case "signup_disabled":
        case "email_provider_disabled":
            return "New accounts are turned off right now.";
        case "identity_already_exists":
            return "This Google account is already connected to another account. Log in with that account first.";
        case "user_banned":
            return "This account is suspended.";
        case "unexpected_failure":
            if (/confirmation email/i.test(message)) {
                return `We couldn't send the confirmation email from ${AUTH_MAIL_FROM}. Try again in a minute.`;
            }
            break;
        default:
            break;
    }

    if (/database error saving new user/i.test(message)) {
        return "That username is taken or invalid. Pick another (at least 3 characters).";
    }
    if (/already registered|already been registered/i.test(message)) {
        return "An account with that email already exists. Try logging in.";
    }
    if (/confirmation email/i.test(message)) {
        return `We couldn't send the confirmation email from ${AUTH_MAIL_FROM}. Try again in a minute.`;
    }

    return message || "Something went wrong. Try again.";
}
