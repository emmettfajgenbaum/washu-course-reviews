// Reads Course_Reviews.xlsx from the repo root. Emmett supplies that workbook; it is
// gitignored on purpose so course data never lands in a public repo. Without it this
// script throws on XLSX.readFile. See README.md § Scripts.

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Parse Python-style dict/list strings into JS objects
// This handles single-quoted strings with embedded apostrophes
function parsePythonLiteral(str) {
  if (!str || str.trim() === "") return null;
  try {
    // Replace Python-style single quotes with double quotes carefully
    // Strategy: convert to JSON-compatible format
    let s = str.trim();

    // Handle None -> null, True -> true, False -> false
    s = s.replace(/\bNone\b/g, "null");
    s = s.replace(/\bTrue\b/g, "true");
    s = s.replace(/\bFalse\b/g, "false");

    // Wrap in array brackets if it's a comma-separated list of objects
    if (s.startsWith("{") && !s.startsWith("[")) {
      s = "[" + s + "]";
    }

    // Now we need to convert single-quoted strings to double-quoted
    // This is the tricky part due to apostrophes in text
    let result = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "'") {
        // Find the matching closing single quote
        // A closing quote is followed by: , } ] : or whitespace
        let j = i + 1;
        let content = "";
        while (j < s.length) {
          if (s[j] === "'" && j + 1 < s.length) {
            const next = s.substring(j + 1).trimStart();
            if (
              next[0] === "," ||
              next[0] === "}" ||
              next[0] === "]" ||
              next[0] === ":" ||
              next[0] === ")"
            ) {
              break;
            }
            // If next char is another quote starting a new key, it's end of value
            if (next[0] === "'") {
              // Could be end of this string, check context
              // If we're in a value and next is a key, break
              break;
            }
          } else if (s[j] === "'" && j + 1 === s.length) {
            break;
          }
          content += s[j];
          j++;
        }
        // Escape double quotes and backslashes in content
        content = content.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        // Escape newlines
        content = content.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        result += '"' + content + '"';
        i = j + 1;
      } else {
        result += s[i];
        i++;
      }
    }

    return JSON.parse(result);
  } catch (e) {
    return null;
  }
}

function parseInstructors(raw) {
  if (!raw || raw.trim() === "") return [];
  const parsed = parsePythonLiteral(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((i) => i.fullName || i.full_name || "")
    .filter(Boolean);
}

function parseDepartments(raw) {
  if (!raw || raw.trim() === "") return [];
  // Format: "ARCHITECTURE(A46), DRAMA(L15)"
  const parts = raw.split(",").map((s) => s.trim());
  const set = new Set();
  for (const part of parts) {
    if (part) set.add(part.replace(/\(.*?\)$/, "").trim());
  }
  return Array.from(set);
}

function parseReviews(raw) {
  if (!raw || raw.trim() === "") return [];
  const parsed = parsePythonLiteral(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

async function main() {
  const xlsxPath = path.resolve(__dirname, "..", "Course_Reviews.xlsx");
  console.log("Reading", xlsxPath);
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  console.log(`Found ${rows.length} courses`);

  // Prepare course data
  const coursesToInsert = rows.map((row) => ({
    code: row.code || "",
    name: row.name || "",
    departments: parseDepartments(row.department),
    instructors: parseInstructors(row.instructors),
    description: row.courseDetails || "",
    last_offered: row.lastOffered || "",
  }));

  // Insert courses in batches of 500
  const BATCH = 500;
  const insertedCourses = [];

  for (let i = 0; i < coursesToInsert.length; i += BATCH) {
    const batch = coursesToInsert.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("courses")
      .insert(batch)
      .select("id, code");

    if (error) {
      console.error(`Error inserting batch at ${i}:`, error.message);
      process.exit(1);
    }
    insertedCourses.push(...data);
    console.log(`Inserted courses ${i + 1}-${i + batch.length}`);
  }

  console.log(`Total courses inserted: ${insertedCourses.length}`);

  // Build a code->id map
  const codeToId = {};
  for (const c of insertedCourses) {
    codeToId[c.code] = c.id;
  }

  // Generate seed-reviews.sql
  // Use unique UUIDs per review to avoid unique constraint on (course_id, user_id)
  const sqlLines = [];
  sqlLines.push("-- Seed legacy reviews");
  sqlLines.push("-- Temporarily disable triggers and constraints for bulk import");
  sqlLines.push("ALTER TABLE reviews DISABLE TRIGGER ALL;");
  sqlLines.push("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_user_id_fkey;");
  sqlLines.push("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_course_id_user_id_key;");
  sqlLines.push("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_comment_check;");
  sqlLines.push("");

  let reviewCount = 0;

  for (const row of rows) {
    const courseId = codeToId[row.code || ""];
    if (!courseId) continue;

    const reviews = parseReviews(row.reviews);
    if (reviews.length === 0) continue;

    for (const rev of reviews) {
      const quality = parseInt(rev.quality, 10);
      const difficulty = parseInt(rev.difficulty, 10);
      if (!quality || !difficulty || quality < 1 || quality > 5 || difficulty < 1 || difficulty > 5) continue;

      const instructor =
        Array.isArray(rev.instructor) && rev.instructor.length > 0
          ? rev.instructor[0]
          : typeof rev.instructor === "string"
          ? rev.instructor
          : "";
      const hours = rev.hours || "";
      const comment = (rev.comment || "").replace(/'/g, "''");
      const date = rev.date || new Date().toISOString();

      if (comment.length < 10) continue;

      // Generate a unique UUID for each legacy review
      const legacyUuid = crypto.randomUUID();

      sqlLines.push(
        `INSERT INTO reviews (course_id, user_id, quality, difficulty, instructor, hours_per_week, comment, created_at) VALUES (${courseId}, '${legacyUuid}', ${quality}, ${difficulty}, '${instructor.replace(/'/g, "''")}', '${hours.replace(/'/g, "''")}', '${comment}', '${date}');`
      );
      reviewCount++;
    }
  }

  sqlLines.push("");
  sqlLines.push("-- Restore triggers (keep FK/unique constraints dropped for legacy data)");
  sqlLines.push("ALTER TABLE reviews ADD CONSTRAINT reviews_comment_check CHECK (char_length(comment) >= 10);");
  sqlLines.push("ALTER TABLE reviews ENABLE TRIGGER ALL;");
  sqlLines.push(`-- Total reviews: ${reviewCount}`);

  const sqlPath = path.resolve(__dirname, "seed-reviews.sql");
  fs.writeFileSync(sqlPath, sqlLines.join("\n"), "utf8");
  console.log(`Generated ${sqlPath} with ${reviewCount} reviews`);
}

main().catch(console.error);
