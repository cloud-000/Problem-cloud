import type { LayoutServerLoad } from "./$types";

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
    }

    return {
        session,
        user,
        profile,
        cookies: cookies.getAll(),
    };
};
