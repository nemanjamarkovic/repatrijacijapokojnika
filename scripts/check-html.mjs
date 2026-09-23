import fs from "fs";
import path from "path";

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".html")) acc.push(full);
  }
  return acc;
}

let bad = 0;
for (const file of walk("dist")) {
  const html = fs.readFileSync(file, "utf8");
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) {
    console.log("h1", h1, file);
    bad += 1;
  }
  if (!html.includes('lang="sr"')) {
    console.log("lang", file);
    bad += 1;
  }
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) {
    console.log("no ld", file);
    bad += 1;
  }
  for (const block of blocks) {
    const data = JSON.parse(block[1]);
    const text = JSON.stringify(data);
    if (/openingHours|aggregateRating|priceRange/.test(text)) {
      console.log("bad schema", file);
      bad += 1;
    }
  }
}
const how = fs.readFileSync("dist/kako-tece-prevoz/index.html", "utf8");
console.log("howto", how.includes('"@type":"HowTo"'));
console.log("files checked, problems", bad);
