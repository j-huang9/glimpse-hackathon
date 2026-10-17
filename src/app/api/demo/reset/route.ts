import { errorResponse } from "@/lib/auth";
import { IS_DEMO } from "@/lib/demo-flag";
import { seedDemo } from "@/lib/demo/seed";

export const maxDuration = 120;

/** Demo mode: wipe everything and rebuild the sample group from seed/. */
export async function POST() {
  if (!IS_DEMO) return Response.json({ error: "Not in demo mode" }, { status: 404 });
  try {
    return Response.json(await seedDemo());
  } catch (err) {
    return errorResponse(err);
  }
}
