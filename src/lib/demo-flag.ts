/**
 * Demo mode: no Supabase, no Google, no Anthropic key needed. Data lives in .demo/ on this machine.
 * On automatically while the Supabase URL is missing or still the placeholder; force with NEXT_PUBLIC_DEMO_MODE=1.
 * Works in both server and client code (NEXT_PUBLIC_* vars are inlined at build time).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1" || !url || url.includes("placeholder");
