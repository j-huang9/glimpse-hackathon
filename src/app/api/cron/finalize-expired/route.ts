import { errorResponse, HttpError, isCronRequest } from "@/lib/auth";
import { finalizeExpired } from "@/lib/cycles";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    if (!isCronRequest(req)) throw new HttpError(401, "Bad cron secret");
    return Response.json({ results: await finalizeExpired() });
  } catch (err) {
    return errorResponse(err);
  }
}
