/**
 * The authenticated shell's data. This load lives under `(app)` — **not** at the
 * route root — because its payload contains the serialized `Session` (access and
 * refresh tokens) and the user's profile. A root load would attach that payload
 * to every document in the app, including the credential-free `/offline-shell` entry
 * the service worker must be able to cache (`docs/offline.md` §3a). Keep the root
 * layout presentation-only.
 */
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";
import { hostedAllowanceFor } from "$lib/server/ai/hosted-usage";

export const load: LayoutServerLoad = async ({
    locals: { safeGetSession, supabase },
    cookies,
    depends,
}) => {
    const { session, user } = await safeGetSession();

    let profile = null;
    if (user) {
        const { data: profileData } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();
        profile = profileData;

        if (!profile?.username) {
            redirect(303, "/auth/complete-profile");
        }

        if (profile) {
            const lastActive = new Date(profile.last_active_at).getTime();
            const now = Date.now();
            const fifteenMinutes = 15 * 60 * 1000;
            if (now - lastActive > fifteenMinutes) {
                const nowStr = new Date().toISOString();
                const { error } = await supabase
                    .from("profiles")
                    .update({ last_active_at: nowStr })
                    .eq("id", user.id);
                if (!error) {
                    profile.last_active_at = nowStr;
                }
            }
        }
    }

    depends("ai:hosted-usage");

    return {
        session,
        user,
        profile,
        cookies: cookies.getAll(),
        aiCoachEnabled: Boolean(user && aiCoachEnabled()),
        hostedAllowance: user ? await hostedAllowanceFor(user.id) : null,
    };
};
