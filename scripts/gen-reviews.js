// Reads Course_Reviews.xlsx from the repo root. Emmett supplies that workbook; it is
// gitignored on purpose so course data never lands in a public repo. Without it this
// script throws on XLSX.readFile. See README.md § Scripts.

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse Python dict/list using a state machine approach
// Handles apostrophes in single-quoted strings by using context clues
function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (" \t\n\r".includes(ch)) { i++; continue; }
    if ("{}[]():,".includes(ch)) { tokens.push({ type: ch, value: ch }); i++; continue; }

    // Number
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let num = ch;
      let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) {
        num += s[j]; j++;
      }
      tokens.push({ type: 'num', value: Number(num) });
      i = j;
      continue;
    }

    // Keywords
    if (s.substring(i, i + 4) === 'None') { tokens.push({ type: 'null', value: null }); i += 4; continue; }
    if (s.substring(i, i + 4) === 'True') { tokens.push({ type: 'bool', value: true }); i += 4; continue; }
    if (s.substring(i, i + 5) === 'False') { tokens.push({ type: 'bool', value: false }); i += 5; continue; }

    // String - single quoted
    if (ch === "'") {
      // Find the end of the string
      // The key insight: in these Python dicts, strings end with ' followed by
      // one of: , } ] : or end-of-string (ignoring whitespace)
      // BUT comments can contain apostrophes like "I've", "don't", "it's"
      // Strategy: look for ' followed by valid dict punctuation
      let j = i + 1;
      let content = "";
      while (j < s.length) {
        if (s[j] === "'") {
          // Check what comes after this quote (skip whitespace)
          let k = j + 1;
          while (k < s.length && " \t\n\r".includes(s[k])) k++;
          const nextChar = k < s.length ? s[k] : '\0';
          // Valid endings: , } ] : or end of string
          if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':' || nextChar === ')' || nextChar === '\0') {
            break;
          }
          // Also check for key-value pattern: ' 'key'
          if (nextChar === "'") {
            // Could be end of value followed by start of next key
            // Check if what follows looks like a dict key
            // Find the next quote after this potential key start
            let m = k + 1;
            let potentialKey = "";
            while (m < s.length && s[m] !== "'") {
              potentialKey += s[m]; m++;
            }
            // Known keys in our data
            const knownKeys = ['id', 'quality', 'difficulty', 'instructor', 'hours', 'comment', 'date', 'upVotes', 'downVotes',
              'lastName', 'fullName', 'semestersTaught', 'attributeSchool', 'attributeList'];
            if (knownKeys.includes(potentialKey.trim())) {
              break; // This quote IS the end of the string
            }
          }
          // Otherwise it's an apostrophe within the string
          content += "'";
          j++;
        } else {
          content += s[j];
          j++;
        }
      }
      tokens.push({ type: 'str', value: content });
      i = j + 1;
      continue;
    }

    // Skip unknown
    i++;
  }
  return tokens;
}

function parseValue(tokens, pos) {
  if (pos >= tokens.length) return [null, pos];
  const t = tokens[pos];

  if (t.type === 'str' || t.type === 'num') return [t.value, pos + 1];
  if (t.type === 'null') return [null, pos + 1];
  if (t.type === 'bool') return [t.value, pos + 1];

  if (t.type === '{') return parseDict(tokens, pos);
  if (t.type === '[') return parseList(tokens, pos);

  return [null, pos + 1];
}

function parseDict(tokens, pos) {
  pos++; // skip {
  const obj = {};
  while (pos < tokens.length && tokens[pos].type !== '}') {
    if (tokens[pos].type === ',') { pos++; continue; }
    const [key, p1] = parseValue(tokens, pos);
    pos = p1;
    if (pos < tokens.length && tokens[pos].type === ':') pos++; // skip :
    const [val, p2] = parseValue(tokens, pos);
    pos = p2;
    if (key !== null) obj[key] = val;
  }
  if (pos < tokens.length) pos++; // skip }
  return [obj, pos];
}

function parseList(tokens, pos) {
  pos++; // skip [
  const arr = [];
  while (pos < tokens.length && tokens[pos].type !== ']') {
    if (tokens[pos].type === ',') { pos++; continue; }
    const [val, p] = parseValue(tokens, pos);
    pos = p;
    arr.push(val);
  }
  if (pos < tokens.length) pos++; // skip ]
  return [arr, pos];
}

function parsePythonValue(str) {
  if (!str || str.trim() === "") return null;
  const tokens = tokenize(str.trim());
  if (tokens.length === 0) return null;

  // If starts with {, it could be a single dict or comma-separated dicts
  // Wrap in array parsing context
  if (tokens[0].type === '{') {
    // Parse all top-level dicts
    const results = [];
    let pos = 0;
    while (pos < tokens.length) {
      if (tokens[pos].type === ',') { pos++; continue; }
      if (tokens[pos].type === '{') {
        const [val, p] = parseDict(tokens, pos);
        results.push(val);
        pos = p;
      } else {
        pos++;
      }
    }
    return results;
  }

  if (tokens[0].type === '[') {
    const [val] = parseList(tokens, 0);
    return val;
  }

  const [val] = parseValue(tokens, 0);
  return val;
}

function parseReviews(raw) {
  if (!raw || String(raw).trim() === "") return [];
  const parsed = parsePythonValue(String(raw));
  if (!Array.isArray(parsed)) return [];
  return parsed;
}

async function main() {
  const allCourses = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, code")
      .range(offset, offset + 999);
    if (error) { console.error(error); break; }
    allCourses.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Loaded ${allCourses.length} courses from DB`);

  const codeToId = {};
  for (const c of allCourses) codeToId[c.code] = c.id;

  const wb = XLSX.readFile(path.resolve(__dirname, "..", "Course_Reviews.xlsx"));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  const sqlLines = [];
  sqlLines.push("-- Seed legacy reviews");
  sqlLines.push("ALTER TABLE reviews DISABLE TRIGGER ALL;");
  sqlLines.push("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_user_id_fkey;");
  sqlLines.push("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_course_id_user_id_key;");
  sqlLines.push("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_comment_check;");
  sqlLines.push("");

  let reviewCount = 0;
  let parseFailCount = 0;

  for (const row of rows) {
    const courseId = codeToId[row.code || ""];
    if (!courseId) continue;

    const rawReviews = String(row.reviews || "").trim();
    if (!rawReviews) continue;

    const reviews = parseReviews(rawReviews);
    if (!reviews.length) {
      parseFailCount++;
      continue;
    }

    for (const rev of reviews) {
      if (!rev || typeof rev !== 'object') continue;
      const quality = parseInt(rev.quality, 10);
      const difficulty = parseInt(rev.difficulty, 10);
      if (!quality || !difficulty || quality < 1 || quality > 5 || difficulty < 1 || difficulty > 5) continue;

      let instructor = "";
      if (Array.isArray(rev.instructor) && rev.instructor.length > 0) {
        instructor = String(rev.instructor[0]);
      } else if (typeof rev.instructor === "string") {
        instructor = rev.instructor;
      }

      const hours = rev.hours != null ? String(rev.hours) : "";
      const comment = String(rev.comment || "").replace(/'/g, "''");
      const date = rev.date ? String(rev.date) : new Date().toISOString();

      if (comment.length < 10) continue;

      const uuid = crypto.randomUUID();
      sqlLines.push(
        `INSERT INTO reviews (course_id, user_id, quality, difficulty, instructor, hours_per_week, comment, created_at) VALUES (${courseId}, '${uuid}', ${quality}, ${difficulty}, '${instructor.replace(/'/g, "''")}', '${hours.replace(/'/g, "''")}', '${comment}', '${date}');`
      );
      reviewCount++;
    }
  }

  sqlLines.push("");
  sqlLines.push("ALTER TABLE reviews ADD CONSTRAINT reviews_comment_check CHECK (char_length(comment) >= 10);");
  sqlLines.push("ALTER TABLE reviews ENABLE TRIGGER ALL;");
  sqlLines.push(`-- Total reviews: ${reviewCount}`);

  const sqlPath = path.resolve(__dirname, "seed-reviews.sql");
  fs.writeFileSync(sqlPath, sqlLines.join("\n"), "utf8");
  console.log(`Generated ${sqlPath} with ${reviewCount} reviews`);
  console.log(`Parse failures: ${parseFailCount} rows had review data but failed to parse`);
}

main().catch(console.error);
