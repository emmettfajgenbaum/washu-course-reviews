// Reads Course_Reviews.xlsx from the repo root. Emmett supplies that workbook; it is
// gitignored on purpose so course data never lands in a public repo. Without it this
// script throws on XLSX.readFile. See README.md § Scripts.

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Improved tokenizer that handles both single and double quoted strings
function tokenize(s) {
  const tokens = [];
  let i = 0;
  const knownKeys = ['id','quality','difficulty','instructor','hours','comment','date','upVotes','downVotes',
    'lastName','fullName','semestersTaught','attributeSchool','attributeList'];

  while (i < s.length) {
    const ch = s[i];
    if (" \t\n\r".includes(ch)) { i++; continue; }
    if ("{}[]():,".includes(ch)) { tokens.push({ type: ch, value: ch }); i++; continue; }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let num = ch; let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) { num += s[j]; j++; }
      tokens.push({ type: 'num', value: Number(num) }); i = j; continue;
    }

    if (s.substring(i, i + 4) === 'None') { tokens.push({ type: 'null', value: null }); i += 4; continue; }
    if (s.substring(i, i + 4) === 'True') { tokens.push({ type: 'bool', value: true }); i += 4; continue; }
    if (s.substring(i, i + 5) === 'False') { tokens.push({ type: 'bool', value: false }); i += 5; continue; }

    // Double-quoted string
    if (ch === '"') {
      let j = i + 1;
      let content = "";
      while (j < s.length) {
        if (s[j] === '\\' && j + 1 < s.length) {
          content += s[j + 1];
          j += 2;
        } else if (s[j] === '"') {
          break;
        } else {
          content += s[j];
          j++;
        }
      }
      tokens.push({ type: 'str', value: content });
      i = j + 1;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      let content = "";
      while (j < s.length) {
        if (s[j] === "'") {
          let k = j + 1;
          while (k < s.length && " \t\n\r".includes(s[k])) k++;
          const nextChar = k < s.length ? s[k] : '\0';
          // Definite end of string
          if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':' || nextChar === ')' || nextChar === '\0') {
            break;
          }
          // Check if next single-quoted thing is a known key
          if (nextChar === "'") {
            let m = k + 1;
            let potentialKey = "";
            while (m < s.length && s[m] !== "'") { potentialKey += s[m]; m++; }
            if (knownKeys.includes(potentialKey.trim())) break;
          }
          // Otherwise apostrophe in text
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
  pos++;
  const obj = {};
  while (pos < tokens.length && tokens[pos].type !== '}') {
    if (tokens[pos].type === ',') { pos++; continue; }
    const [key, p1] = parseValue(tokens, pos); pos = p1;
    if (pos < tokens.length && tokens[pos].type === ':') pos++;
    const [val, p2] = parseValue(tokens, pos); pos = p2;
    if (key !== null) obj[key] = val;
  }
  if (pos < tokens.length) pos++;
  return [obj, pos];
}

function parseList(tokens, pos) {
  pos++;
  const arr = [];
  while (pos < tokens.length && tokens[pos].type !== ']') {
    if (tokens[pos].type === ',') { pos++; continue; }
    const [val, p] = parseValue(tokens, pos); pos = p;
    arr.push(val);
  }
  if (pos < tokens.length) pos++;
  return [arr, pos];
}

function parsePythonValue(str) {
  if (!str || str.trim() === "") return null;
  const tokens = tokenize(str.trim());
  if (tokens.length === 0) return null;
  if (tokens[0].type === '{') {
    const results = []; let pos = 0;
    while (pos < tokens.length) {
      if (tokens[pos].type === ',') { pos++; continue; }
      if (tokens[pos].type === '{') { const [val, p] = parseDict(tokens, pos); results.push(val); pos = p; }
      else pos++;
    }
    return results;
  }
  if (tokens[0].type === '[') { const [val] = parseList(tokens, 0); return val; }
  const [val] = parseValue(tokens, 0);
  return val;
}

async function main() {
  // Load all course IDs
  const allCourses = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from("courses").select("id, code").range(offset, offset + 999);
    if (!data || !data.length) break;
    allCourses.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Loaded ${allCourses.length} courses`);
  const codeToId = {};
  for (const c of allCourses) codeToId[c.code] = c.id;

  // Delete all existing reviews
  console.log("Deleting existing reviews...");
  while (true) {
    const { data } = await supabase.from("reviews").select("id").limit(1000);
    if (!data || !data.length) break;
    const ids = data.map(r => r.id);
    const { error } = await supabase.from("reviews").delete().in("id", ids);
    if (error) { console.error("Delete error:", error.message); break; }
    console.log(`Deleted ${ids.length} reviews`);
  }

  // Re-parse and insert
  const wb = XLSX.readFile(path.resolve(__dirname, "..", "Course_Reviews.xlsx"));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  const allReviews = [];
  let parseFail = 0;

  for (const row of rows) {
    const courseId = codeToId[row.code || ""];
    if (!courseId) continue;
    const rawReviews = String(row.reviews || "").trim();
    if (!rawReviews) continue;

    const parsed = parsePythonValue(rawReviews);
    if (!Array.isArray(parsed) || !parsed.length) { parseFail++; continue; }

    for (const rev of parsed) {
      if (!rev || typeof rev !== 'object') continue;
      const quality = parseInt(rev.quality, 10);
      const difficulty = parseInt(rev.difficulty, 10);
      if (!quality || !difficulty || quality < 1 || quality > 5 || difficulty < 1 || difficulty > 5) continue;

      let instructor = "";
      if (Array.isArray(rev.instructor) && rev.instructor.length > 0) instructor = String(rev.instructor[0]);
      else if (typeof rev.instructor === "string") instructor = rev.instructor;

      const hours = rev.hours != null ? String(rev.hours) : "";
      const comment = String(rev.comment || "");
      const date = rev.date ? String(rev.date) : new Date().toISOString();

      if (comment.length < 10) continue;

      allReviews.push({
        course_id: courseId,
        user_id: crypto.randomUUID(),
        quality,
        difficulty,
        instructor,
        hours_per_week: hours,
        comment,
        created_at: date,
      });
    }
  }

  console.log(`Parsed ${allReviews.length} reviews (${parseFail} parse failures), inserting...`);

  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < allReviews.length; i += BATCH) {
    const batch = allReviews.slice(i, i + BATCH);
    const { error } = await supabase.from("reviews").insert(batch);
    if (error) {
      // Try one by one
      for (const rev of batch) {
        const { error: e } = await supabase.from("reviews").insert(rev);
        if (!e) inserted++;
      }
    } else {
      inserted += batch.length;
    }
    if ((i + BATCH) % 1000 < BATCH) console.log(`Progress: ${Math.min(i + BATCH, allReviews.length)}/${allReviews.length}`);
  }

  // Verify: check for truncated comments
  let truncated = 0;
  offset = 0;
  while (true) {
    const { data } = await supabase.from("reviews").select("id, comment").range(offset, offset + 999);
    if (!data || !data.length) break;
    for (const r of data) {
      if (/^[a-z][ a-z]/.test(r.comment)) truncated++;
    }
    if (data.length < 1000) break;
    offset += 1000;
  }

  console.log(`Done! Inserted ${inserted} reviews. Truncated-looking: ${truncated}`);
}

main().catch(console.error);
