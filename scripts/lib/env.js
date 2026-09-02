// Shared plumbing for the maintenance scripts: .env.local loading, the
// service-role Supabase client, paginated full-table reads, and the check that
// migration 006 has been applied. No dotenv dependency on purpose.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Minimal .env.local loader. Values already in the environment win (CI).
function loadEnv() {
  const envPath = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

// Service-role client. Exits 1 when the two required variables are missing.
function createSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  return createClient(url, key);
}

// Every row of a table, in pages of 1,000 (PostgREST's default cap).
async function fetchAll(supabase, table, columns, orderBy = "id") {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(from, from + 999);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

// Migration 006 added reviews.rmp_rating_id (and the instructor backup table).
// A dry run can work without it — useful for previewing on a machine that has
// not applied it yet — but no write may happen until it is in place.
async function hasMigration006(supabase) {
  const { error } = await supabase.from("reviews").select("rmp_rating_id").limit(1);
  return !error;
}

const MIGRATION_006_MESSAGE =
  "Migration 006 has not been applied. Paste supabase/migrations/006_rmp_reviews.sql into the " +
  "Supabase SQL editor and run it, then re-run this script.";

// Exit 1 with the instruction unless migration 006 is present. Call before any write.
async function assertMigration006(supabase) {
  if (!(await hasMigration006(supabase))) {
    console.error(MIGRATION_006_MESSAGE);
    process.exit(1);
  }
}

module.exports = { loadEnv, createSupabase, fetchAll, hasMigration006, assertMigration006, MIGRATION_006_MESSAGE };
