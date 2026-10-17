import type { NextRequest } from "next/server";
import { errorResponse, isCronRequest, requireCycleMember, requireUser } from "@/lib/auth";
import { finalizeCycle } from "@/lib/cycles";

export const maxDuration = 60;

/** Reveal now. Members use it as the demo "Generate now" button; the seed script calls it with the cron secret. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/cycles/[id]/finalize">) {
  try {
    const { id } = await ctx.params;
    const cron = isCronRequest(req);
    if (!cron) await requireCycleMember(id, await requireUser(req));
    const body = await req.json().catch(() => ({}));
    const startNext = cron && body.startNext === false ? false : true;
    return Response.json(await finalizeCycle(id, { startNext }));
  } catch (err) {
    return errorResponse(err);
  }
}
