import "server-only";
import { supabaseAdmin } from "./supabase-admin";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

/** Verifies the bearer token and makes sure a profile row exists. Returns the user id. */
export async function requireUser(req: Request): Promise<string> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Not signed in");

  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session expired");

  const u = data.user;
  const meta = u.user_metadata ?? {};
  await db.from("profiles").upsert(
    {
      id: u.id,
      display_name: meta.full_name ?? meta.name ?? u.email?.split("@")[0] ?? "Friend",
      avatar_url: meta.avatar_url ?? meta.picture ?? null,
    },
    { onConflict: "id" },
  );
  return u.id;
}

export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("x-cron-secret") === secret;
}

export async function requireMember(groupId: string, userId: string) {
  const { data } = await supabaseAdmin()
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new HttpError(403, "You're not in this group");
}

export async function requireCycleMember(cycleId: string, userId: string) {
  const { data: cycle } = await supabaseAdmin()
    .from("cycles")
    .select("*")
    .eq("id", cycleId)
    .maybeSingle();
  if (!cycle) throw new HttpError(404, "Cycle not found");
  await requireMember(cycle.group_id, userId);
  return cycle;
}
