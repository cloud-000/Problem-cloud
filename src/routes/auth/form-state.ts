import { createContext } from "svelte";

export type AuthFormState = {
    submitting: boolean;
};

export const [getAuthForm, setAuthForm] = createContext<AuthFormState>();
