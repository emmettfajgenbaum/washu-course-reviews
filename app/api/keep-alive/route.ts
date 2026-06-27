import { createClient } from "@/lib/supabase-server";

// Never statically cache this route — it must execute on every cron invocation
// so that it actually pings Postgres and keeps the Supabase project from pausing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  // Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`.
  // Fail closed: require the secret so this endpoint is never a public DB-poker.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Anon/server client (the same one the public pages use, and the only Supabase
  // keys present in production) — a real Postgres read that resets the free-tier
  // inactivity timer. `courses` is anon-readable via its "viewable by everyone" RLS policy.
  const supabase = await createClient();
  const { error } = await supabase.from("courses").select("id").limit(1);

  if (error) {
    console.error("[keep-alive] supabase query failed:", error.message);
    return Response.json({ ok: false }, { status: 500 });
  }

  return Response.json({ ok: true });
}
