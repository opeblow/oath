// Vercel function: POST /api/ask
import { ask, HttpError } from "./_lib/ask.js";

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  try {
    const body = await request.json().catch(() => null);
    return Response.json(await ask(body, ip), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const error = e instanceof HttpError ? e.message : "The auditor failed. Try again.";
    return Response.json({ error }, { status });
  }
}
