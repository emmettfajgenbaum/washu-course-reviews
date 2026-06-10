// One-off cleanup: remove duplicate values inside courses.departments arrays.
//
// Some course rows have the same department listed more than once
// (e.g. ["MANAGEMENT", "MANAGEMENT"]), which caused duplicate React keys when
// rendering department badges. This dedupes those arrays in place.
//
// SAFETY:
//   * DRY RUN BY DEFAULT. It only previews changes unless you pass --apply.
//   * No rows are ever deleted. It only updates the `departments` column of
//     rows that actually contain duplicates, addressed individually by id.
//   * Dedupe preserves first-occurrence order.
//
// Usage:
//   node scripts/dedupe-departments.js           # preview only (no writes)
//   node scripts/dedupe-departments.js --apply    # actually write the fixes

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// --- Minimal .env.local loader (no dotenv dependency) ---
function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Order-preserving dedupe.
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

async function main() {
  console.log(`Project: ${SUPABASE_URL}`);
  console.log(APPLY ? "MODE: APPLY (will write changes)\n" : "MODE: DRY RUN (no writes)\n");

  // Page through all courses (REST caps at 1000 rows per request).
  const PAGE = 1000;
  let from = 0;
  const affected = [];
  let total = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, name, departments")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Read failed:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    total += data.length;

    for (const row of data) {
      const deps = Array.isArray(row.departments) ? row.departments : [];
      const cleaned = dedupe(deps);
      if (cleaned.length !== deps.length) {
        affected.push({ id: row.id, name: row.name, before: deps, after: cleaned });
      }
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`Scanned ${total} courses. Found ${affected.length} with duplicate departments.\n`);
  for (const a of affected) {
    console.log(`  ${a.name}`);
    console.log(`    before: [${a.before.join(", ")}]`);
    console.log(`    after:  [${a.after.join(", ")}]`);
  }

  if (affected.length === 0) {
    console.log("\nNothing to clean. Done.");
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN complete. Re-run with --apply to write these ${affected.length} fixes.`);
    return;
  }

  console.log(`\nApplying ${affected.length} updates...`);
  let ok = 0;
  for (const a of affected) {
    const { error } = await supabase
      .from("courses")
      .update({ departments: a.after })
      .eq("id", a.id);
    if (error) {
      console.error(`  FAILED ${a.name} (${a.id}): ${error.message}`);
    } else {
      ok++;
    }
  }
  console.log(`Done. ${ok}/${affected.length} rows updated successfully.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
