import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_DEMO } from "./demo-flag";
import { createDemoClient } from "./demo/store";

let client: SupabaseClient | null = null;

export function supabaseAdmin() {
  if (!client && IS_DEMO) client = createDemoClient() as unknown as SupabaseClient;
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}
