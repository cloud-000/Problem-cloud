<script lang="ts">
    import type { ActionData } from "./$types";
    let { form }: { form: ActionData } = $props();
    import { Input } from "$lib/components/input/.";
    import { Button } from "$lib/components/button/.";

    let items = [
        {
            name: "email",
            type: "text",
            label: "Email",
            placeholder: "Enter Email",
        },
        {
            name: "username",
            type: "text",
            label: "Username",
            placeholder: "What do you want to be called?",
        },
        {
            name: "password",
            type: "password",
            label: "Password",
            placeholder: "Create a password",
        },
    ];
</script>

{#each items as i}
    <label>
        <span>{i.label}</span>
        <Input name={i.name} type={i.type} required placeholder={i.placeholder}
        ></Input>
    </label>
{/each}

{#if form?.message}
    <p class="text-error bg-error-container">
        {form.message}
    </p>
{/if}

<div class="flex flex-col gap-xl">
    <Button type="submit" variant="default">Sign up</Button>
    <div class="text-primary/50 flex flex-row items-center h-max w-fit gap-xs">
        <span class="h-fit">Already have an account?</span><Button
            type="button"
            href="/auth/login"
            variant="ghost"
            class="underline">Log In</Button
        >
    </div>
</div>
