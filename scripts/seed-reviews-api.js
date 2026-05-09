const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function tokenize(s) {
  const tokens = [];
  let i = 0;
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
    if (ch === "'") {
      let j = i + 1; let content = "";
      while (j < s.length) {
        if (s[j] === "'") {
          let k = j + 1;
          while (k < s.length && " \t\n\r".includes(s[k])) k++;
          const nextChar = k < s.length ? s[k] : '\0';
          if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':' || nextChar === ')' || nextChar === '\0') break;
          if (nextChar === "'") {
            let m = k + 1; let potentialKey = "";
            while (m < s.length && s[m] !== "'") { potentialKey += s[m]; m++; }
            const knownKeys = ['id','quality','difficulty','instructor','hours','comment','date','upVotes','downVotes','lastName','fullName','semestersTaught','attributeSchool','attributeList'];
            if (knownKeys.includes(potentialKey.trim())) break;
          }
          content += "'"; j++;
        } else { content += s[j]; j++; }
      }
      tokens.push({ type: 'str', value: content }); i = j + 1; continue;
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
  // Constraints already dropped via SQL Editor

  const allCourses = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from("courses").select("id, code").range(offset, offset + 999);
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

  // Collect all reviews
  const allReviews = [];
  for (const row of rows) {
    const courseId = codeToId[row.code || ""];
    if (!courseId) continue;
    const rawReviews = String(row.reviews || "").trim();
    if (!rawReviews) continue;
    const parsed = parsePythonValue(rawReviews);
    if (!Array.isArray(parsed)) continue;

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

  console.log(`Parsed ${allReviews.length} reviews, inserting...`);

  // Insert in batches of 200
  const BATCH = 200;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < allReviews.length; i += BATCH) {
    const batch = allReviews.slice(i, i + BATCH);
    const { error } = await supabase.from("reviews").insert(batch);
    if (error) {
      console.error(`Batch ${i}: ${error.message}`);
      errors++;
      // Try one by one for this batch
      for (const rev of batch) {
        const { error: singleErr } = await supabase.from("reviews").insert(rev);
        if (singleErr) {
          errors++;
        } else {
          inserted++;
        }
      }
    } else {
      inserted += batch.length;
    }
    if ((i + BATCH) % 1000 < BATCH) {
      console.log(`Progress: ${Math.min(i + BATCH, allReviews.length)}/${allReviews.length}`);
    }
  }

  console.log(`Done! Inserted ${inserted} reviews. Errors: ${errors}`);
}

main().catch(console.error);
