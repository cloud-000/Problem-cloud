import type { LayoutServerLoad } from "./$types";
import { aiCoachEnabled } from "$lib/server/ai/config";

export const load: LayoutServerLoad = async ({
    locals: { safeGetSession, supabase },
    cookies,
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

    return {
        session,
        user,
        profile,
        cookies: cookies.getAll(),
        aiCoachEnabled: Boolean(user && aiCoachEnabled()),
    };
};
