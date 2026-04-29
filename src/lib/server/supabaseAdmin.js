import { createClient } from "@supabase/supabase-js";
import { SERVICE_DB_KEY } from "$env/static/private";
import { PUBLIC_DB_URL } from "$env/static/public";

export const dbAdmin = createClient(PUBLIC_DB_URL, SERVICE_DB_KEY);
