import { defineEnvVars } from '@sveltejs/kit/env';

// @migration-task Review usage of dynamic environment variables. They fall back to the empty string if not present, which may not be what you want.
export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: { public: true, static: true },
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: { public: true, static: true },
	AI_COACH_ENABLED: { schema: (input) => input ?? '' },
	AI_COACH_MOCK_ENABLED: { schema: (input) => input ?? '' },
	AI_COACH_MOCK_CONNECTION_STATE: { schema: (input) => input ?? '' },
	AI_COACH_MOCK_SCENARIO: { schema: (input) => input ?? '' },
	AI_COACH_MOCK_CHUNK_DELAY_MS: { schema: (input) => input ?? '' },
	AI_COACH_HOSTED_API_KEY: { schema: (input) => input ?? '' },
	SUPABASE_SECRET_KEY: { schema: (input) => input ?? '' },
	SUPABASE_DEV_SECRET_KEY: { schema: (input) => input ?? '' }
});
