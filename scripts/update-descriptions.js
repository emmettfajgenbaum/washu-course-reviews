const { createClient } = require("@supabase/supabase-js");
const cheerio = require("cheerio");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Bulletin department pages to scrape
const BULLETIN_PAGES = [
  // Arts & Sciences
  "/undergrad/artsci/africanandafricanamericanstudies/",
  "/undergrad/artsci/americanculturestudies/",
  "/undergrad/artsci/anthropology/",
  "/undergrad/artsci/appliedlinguistics/",
  "/undergrad/artsci/arthistoryandarchaeology/",
  "/undergrad/artsci/biology/",
  "/undergrad/artsci/chemistry/",
  "/undergrad/artsci/classics/",
  "/undergrad/artsci/comparativeliteratureandthought/",
  "/undergrad/artsci/eastasianlanguagesandcultures/",
  "/undergrad/artsci/economics/",
  "/undergrad/artsci/education/",
  "/undergrad/artsci/eeps/",
  "/undergrad/artsci/english/",
  "/undergrad/artsci/environmentalstudies/",
  "/undergrad/artsci/filmandmediastudies/",
  "/undergrad/artsci/globalstudies/",
  "/undergrad/artsci/history/",
  "/undergrad/artsci/jimes/",
  "/undergrad/artsci/latinamericanstudies/",
  "/undergrad/artsci/linguistics/",
  "/undergrad/artsci/mathematics/",
  "/undergrad/artsci/music/",
  "/undergrad/artsci/performingarts/",
  "/undergrad/artsci/philosophy/",
  "/undergrad/artsci/philosophyneurosciencepsychology/",
  "/undergrad/artsci/physics/",
  "/undergrad/artsci/politicalscience/",
  "/undergrad/artsci/psychologicalandbrainsciences/",
  "/undergrad/artsci/publichealthandsociety/",
  "/undergrad/artsci/religionandpolitics/",
  "/undergrad/artsci/religiousstudies/",
  "/undergrad/artsci/romancelanguagesandliteratures/",
  "/undergrad/artsci/russianlanguageandliterature/",
  "/undergrad/artsci/sociology/",
  "/undergrad/artsci/speechandhearing/",
  "/undergrad/artsci/statisticsanddatascience/",
  "/undergrad/artsci/womengenderandsexualitystudies/",
  // Engineering
  "/undergrad/engineering/biomedical/",
  "/undergrad/engineering/computerscience/",
  "/undergrad/engineering/electrical-and-systems/",
  "/undergrad/engineering/energy-environmental-chemical/",
  "/undergrad/engineering/mechanical-engineering-materials-science/",
  // Business
  "/undergrad/business/",
  // Art & Architecture
  "/undergrad/art/",
  // Graduate - Arts & Sciences
  "/grad/artsci/africanandafricanamericanstudies/",
  "/grad/artsci/americanculturestudies/",
  "/grad/artsci/anthropology/",
  "/grad/artsci/arthistoryandarchaeology/",
  "/grad/artsci/biology/",
  "/grad/artsci/chemistry/",
  "/grad/artsci/classics/",
  "/grad/artsci/comparativeliteratureandthought/",
  "/grad/artsci/eastasianlanguagesandcultures/",
  "/grad/artsci/economics/",
  "/grad/artsci/education/",
  "/grad/artsci/eeps/",
  "/grad/artsci/english/",
  "/grad/artsci/filmandmediastudies/",
  "/grad/artsci/history/",
  "/grad/artsci/jimes/",
  "/grad/artsci/latinamericanstudies/",
  "/grad/artsci/mathematics/",
  "/grad/artsci/music/",
  "/grad/artsci/performingarts/",
  "/grad/artsci/philosophy/",
  "/grad/artsci/philosophyneurosciencepsychology/",
  "/grad/artsci/physics/",
  "/grad/artsci/politicalscience/",
  "/grad/artsci/psychologicalandbrainsciences/",
  "/grad/artsci/romancelanguagesandliteratures/",
  "/grad/artsci/sociology/",
  "/grad/artsci/statisticsanddatascience/",
  "/grad/artsci/womengenderandsexualitystudies/",
  // Graduate - Business
  "/grad/business/",
  // Graduate - Engineering
  "/grad/engineering/biomedical/",
  "/grad/engineering/computerscience/",
  "/grad/engineering/electrical-and-systems/",
  "/grad/engineering/energy-environmental-chemical/",
  "/grad/engineering/mechanical-engineering-materials-science/",
  // Graduate - Art
  "/grad/art/",
];

const BASE_URL = "https://bulletin.wustl.edu";

// Normalize a course name for matching
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse courses from a bulletin page HTML
function parseCourses(html) {
  const $ = cheerio.load(html);
  const courses = [];

  $(".courseblock").each((_, block) => {
    const titleText = $(block).find(".courseblocktitle").text().trim();
    const desc = $(block).find(".courseblockdesc").text().trim();

    // Parse "DEPT NNNN Title" — handle nbsp and multi-word dept codes like ARTARCH
    const match = titleText.match(/^([A-Z]+)\s+(\d+[A-Z]*)\s+(.+)$/);
    if (match && desc.length > 10) {
      courses.push({
        code: `${match[1]} ${match[2]}`,
        name: match[3].trim(),
        description: desc,
      });
    }
  });

  return courses;
}

async function fetchPage(path) {
  const url = `${BASE_URL}${path}#courses`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  Skipped ${path} (${res.status})`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`  Error fetching ${path}: ${e.message}`);
    return null;
  }
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (DRY_RUN) console.log("=== DRY RUN (no updates will be made) ===\n");

  // 1. Fetch all courses from Supabase (paginate to get all)
  console.log("Fetching courses from Supabase...");
  const dbCourses = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("courses")
      .select("id, code, name, description, bulletin_code")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("Error fetching courses:", error.message);
      process.exit(1);
    }
    dbCourses.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  console.log(`Found ${dbCourses.length} courses in database`);

  // Build a lookup map by normalized name
  const nameToDbCourses = new Map();
  for (const course of dbCourses) {
    const key = normalize(course.name);
    if (!nameToDbCourses.has(key)) {
      nameToDbCourses.set(key, []);
    }
    nameToDbCourses.get(key).push(course);
  }

  // 2. Scrape bulletin pages
  console.log("\nScraping bulletin pages...");
  const bulletinCourses = [];

  for (const path of BULLETIN_PAGES) {
    console.log(`  Fetching ${path}...`);
    const html = await fetchPage(path);
    if (!html) continue;

    const courses = parseCourses(html);
    console.log(`    Found ${courses.length} courses`);
    bulletinCourses.push(...courses);

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nTotal bulletin courses scraped: ${bulletinCourses.length}`);

  // 3. Match and update
  let matched = 0;
  let updated = 0;
  const updates = [];

  for (const bc of bulletinCourses) {
    const key = normalize(bc.name);
    const dbMatches = nameToDbCourses.get(key);

    if (dbMatches && dbMatches.length > 0) {
      matched++;
      for (const dbCourse of dbMatches) {
        const needsDesc = bc.description.length > 20 && normalize(bc.description) !== normalize(dbCourse.description || "");
        const needsCode = bc.code && bc.code !== dbCourse.bulletin_code;
        if (needsDesc || needsCode) {
          const update = { id: dbCourse.id };
          if (needsDesc) update.description = bc.description;
          if (needsCode) update.bulletin_code = bc.code;
          updates.push(update);
        }
      }
    }
  }

  console.log(`Matched ${matched} bulletin courses to DB courses`);
  console.log(`${updates.length} courses need description updates`);

  if (updates.length === 0) {
    console.log("Nothing to update!");
    return;
  }

  if (DRY_RUN) {
    console.log("\nSample updates (first 5):");
    for (const u of updates.slice(0, 5)) {
      const course = dbCourses.find((c) => c.id === u.id);
      console.log(`  ${course.code} — ${course.name}`);
      if (u.bulletin_code) console.log(`    Bulletin code: ${u.bulletin_code}`);
      if (u.description) console.log(`    New desc: ${u.description.slice(0, 100)}...`);
    }
    console.log("\nRun without --dry-run to apply updates.");
    return;
  }

  // 4. Batch update Supabase
  console.log("\nUpdating descriptions...");
  let successCount = 0;
  const BATCH = 50;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const promises = batch.map(({ id, description, bulletin_code }) => {
      const fields = {};
      if (description) fields.description = description;
      if (bulletin_code) fields.bulletin_code = bulletin_code;
      return supabase.from("courses").update(fields).eq("id", id);
    });
    const results = await Promise.all(promises);
    const failures = results.filter((r) => r.error);
    successCount += batch.length - failures.length;

    if (failures.length > 0) {
      console.warn(`  ${failures.length} failures in batch starting at ${i}`);
    }
    console.log(`  Updated ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }

  console.log(`\nDone! Updated ${successCount} course descriptions.`);
}

main().catch(console.error);
