import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit({
            compilerOptions: {
                // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
                runes: ({ filename }) =>
                    filename.split(/[/\\]/).includes("node_modules")
                        ? undefined
                        : true,
            },

            adapter: adapter({
                routes: {
                    // Pages allows 100 include/exclude rules combined. Avoid
                    // <files>/<all>, which expand every icon into its own rule.
                    exclude: [
                        "<build>",
                        "<prerendered>",
                        "<redirects>",
                        "/fonts/*",
                        "/vendor/*",
                        "/icons/*",
                        "/favicon.svg",
                        "/apple-touch-icon.png",
                        "/manifest.webmanifest",
                        "/robots.txt",
                        "/service-worker.js",
                    ],
                },
            }),
        }),
    ],
    server: {
        allowedHosts: ["clouds-macbook-air.local"]
    }
});
