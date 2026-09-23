import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const partialsDir = path.join(root, "partials");
const templatesDir = path.join(root, "templates");
const distDir = path.join(root, "dist");

const COUNTRY_SECTIONS = [
  "hero",
  "key-facts",
  "roles",
  "documents",
  "routes",
  "cities",
  "sources",
  "faq",
  "cta",
];
const CITY_SECTIONS = [
  "hero",
  "local-facts",
  "death-registration",
  "mission",
  "nearby",
  "faq",
  "sources",
  "cta",
];
const DESTINATION_SECTIONS = [
  "hero",
  "delivery",
  "border",
  "local-funeral",
  "origins",
  "faq",
  "sources",
  "cta",
];

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walkJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkJson(full));
    else if (entry.name.endsWith(".json"))
      found.push({ file: full, data: readJson(full) });
  }
  return found;
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function get(ctx, key) {
  let value = ctx;
  for (const part of key.split(".")) {
    if (value == null) return "";
    value = value[part];
  }
  if (value == null || typeof value === "object") return "";
  return String(value);
}

function safeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return url;
  } catch {
    return "";
  }
}

function wordCount(text) {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function formatDate(iso) {
  const [year, month, day] = String(iso).split("-");
  const months = [
    "januar",
    "februar",
    "mart",
    "april",
    "maj",
    "jun",
    "jul",
    "avgust",
    "septembar",
    "oktobar",
    "novembar",
    "decembar",
  ];
  const index = Number(month) - 1;
  if (!year || !months[index] || !day) return iso;
  return `${Number(day)}. ${months[index]} ${year}.`;
}

function sameList(a, b) {
  return (
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((item, index) => item === b[index])
  );
}

function inlinePartials(html) {
  let current = html;
  let guard = 0;
  while (current.includes("{{>") && guard < 20) {
    guard += 1;
    current = current.replace(/\{\{>\s*([a-z0-9./_-]+)\s*\}\}/gi, (_, name) => {
      const file = path.join(
        partialsDir,
        name.endsWith(".html") ? name : `${name}.html`,
      );
      if (!fs.existsSync(file)) {
        fail(`Missing partial ${name}`);
        return "";
      }
      return fs.readFileSync(file, "utf8");
    });
  }
  return current;
}

function applyIf(html, ctx) {
  return html.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, inner) => {
      const value = get(ctx, key.trim());
      return value ? inner : "";
    },
  );
}

function applyTokens(html, ctx) {
  const withRaw = html.replace(/\{\{\{\s*([^}]+)\s*\}\}\}/g, (_, key) =>
    get(ctx, key.trim()),
  );
  return withRaw.replace(/\{\{\s*([^}#/>][^}]*)\s*\}\}/g, (_, key) =>
    esc(get(ctx, key.trim())),
  );
}

function render(templateName, ctx) {
  const file = path.join(templatesDir, templateName);
  const html = fs.readFileSync(file, "utf8");
  return applyTokens(applyIf(inlinePartials(html), ctx), ctx);
}

function listHtml(items) {
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function faqHtml(items, prefix) {
  return items
    .map((item, index) => {
      const id = `${prefix}-${index + 1}`;
      return `<div class="faq-item">
      <h3><button type="button" id="${id}-btn" aria-expanded="true" aria-controls="${id}">${esc(item.q)}</button></h3>
      <div id="${id}" role="region" aria-labelledby="${id}-btn"><p>${esc(item.a)}</p></div>
    </div>`;
    })
    .join("");
}

function sourcesHtml(sources) {
  return sources
    .map((source) => {
      const url = safeUrl(source.url);
      const title = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>`
        : esc(source.title);
      return `<li>${title} <span class="source-meta">${esc(source.publisher)}. Pregledano: <time datetime="${esc(source.retrieved)}">${esc(formatDate(source.retrieved))}</time> ${esc(source.note)}</span></li>`;
    })
    .join("");
}

function crumbsHtml(crumbs) {
  return crumbs
    .map((crumb, index) => {
      const last = index === crumbs.length - 1;
      if (last) return `<li aria-current="page">${esc(crumb.label)}</li>`;
      return `<li><a href="${esc(crumb.href)}">${esc(crumb.label)}</a></li>`;
    })
    .join("");
}

function checkSeo(kind, slug, title, description) {
  const titleLength = String(title).length;
  const descriptionLength = String(description).length;
  if (titleLength < 50 || titleLength > 60)
    warn(`${kind} ${slug} seoTitle is ${titleLength} characters`);
  if (descriptionLength < 140 || descriptionLength > 160)
    warn(`${kind} ${slug} seoDescription is ${descriptionLength} characters`);
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([name, data]);
  let crc = ~0;
  for (let i = 0; i < body.length; i += 1) {
    crc ^= body[i];
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(~crc >>> 0);
  return Buffer.concat([length, body, crcBuf]);
}

function writeOgImage(file) {
  const width = 1200;
  const height = 630;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const cream = x < 36;
      const i = row + 1 + x * 3;
      raw[i] = cream ? 244 : 30;
      raw[i + 1] = cream ? 241 : 70;
      raw[i + 2] = cream ? 235 : 54;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
}

function writeFavicon(file) {
  const size = 16;
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = ((size - 1 - y) * size + x) * 4;
      xor[i] = 54;
      xor[i + 1] = 70;
      xor[i + 2] = 30;
      xor[i + 3] = 255;
    }
  }
  const and = Buffer.alloc(size * 4);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const image = Buffer.concat([header, xor, and]);
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size;
  entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(22, 12);
  fs.writeFileSync(file, Buffer.concat([dir, entry, image]));
}

function jsonLd(graph) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  }).replace(/</g, "\\u003c");
}

function organizationNode(site) {
  return {
    "@type": "Organization",
    "@id": `${site.siteUrl}/#organization`,
    name: site.brandName,
    legalName: site.legalName,
    url: `${site.siteUrl}/`,
    telephone: site.phone,
    email: site.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: site.streetAddress,
      addressLocality: site.city,
      addressCountry: "RS",
    },
    areaServed: [
      { "@type": "Country", name: "Srbija" },
      { "@type": "Country", name: "Bosna i Hercegovina" },
      { "@type": "Country", name: "Crna Gora" },
      { "@type": "Country", name: "Severna Makedonija" },
    ],
  };
}

function breadcrumbNode(site, crumbs, pageUrl) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item:
        crumb.href === pageUrl
          ? `${site.siteUrl}${pageUrl}`
          : `${site.siteUrl}${crumb.href}`,
    })),
  };
}

function faqNode(faq) {
  if (!faq?.length) return null;
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

function serviceNode(site, name, url) {
  return {
    "@type": "Service",
    name,
    serviceType: "Međunarodni drumski prevoz pokojnika",
    url: `${site.siteUrl}${url}`,
    provider: { "@id": `${site.siteUrl}/#organization` },
    areaServed: { "@type": "Country", name: "Srbija" },
  };
}

const site = readJson(path.join(dataDir, "site.json"));
const home = readJson(path.join(dataDir, "home.json"));
const contact = readJson(path.join(dataDir, "contact.json"));
const countries = walkJson(path.join(dataDir, "countries")).map(
  (item) => item.data,
);
const cities = walkJson(path.join(dataDir, "cities")).map((item) => item.data);
const destinations = walkJson(path.join(dataDir, "destinations")).map(
  (item) => item.data,
);
const guides = walkJson(path.join(dataDir, "guides")).map((item) => item.data);
const legalPages = walkJson(path.join(dataDir, "legal")).map(
  (item) => item.data,
);

const countryBySlug = new Map(
  countries.map((country) => [country.slug, country]),
);
const destinationBySlug = new Map(
  destinations.map((destination) => [destination.slug, destination]),
);
const guideBySlug = new Map(guides.map((guide) => [guide.slug, guide]));

function ordered(list, order, kind) {
  const map = new Map(list.map((item) => [item.slug, item]));
  const result = [];
  for (const slug of order) {
    const item = map.get(slug);
    if (!item) fail(`${kind} order lists missing slug ${slug}`);
    else result.push(item);
  }
  for (const item of list) {
    if (!order.includes(item.slug))
      fail(`${kind} ${item.slug} is missing from site.json order`);
  }
  return result;
}

const orderedCountries = ordered(countries, site.countryOrder, "country");
const orderedDestinations = ordered(
  destinations,
  site.destinationOrder,
  "destination",
);
const orderedGuides = ordered(guides, site.guideOrder, "guide");
const publishedCountries = orderedCountries.filter(
  (country) => country.status === "published",
);
const publishedDestinations = orderedDestinations.filter(
  (destination) => destination.status === "published",
);
const publishedGuides = orderedGuides.filter(
  (guide) => guide.status === "published",
);
const publishedCities = cities.filter((city) => city.status === "published");

for (const country of publishedCountries) {
  if (!sameList(country.sectionOrder, COUNTRY_SECTIONS))
    fail(`country ${country.slug} sectionOrder does not match the template`);
  if (!country.summary.includes("Srbij"))
    warn(`country ${country.slug} summary does not mention Srbija`);
  const words = wordCount(country.summary);
  if (words < 60 || words > 80)
    warn(`country ${country.slug} summary has ${words} words`);
  if ((country.faq || []).length < 3)
    fail(`country ${country.slug} needs at least 3 FAQ`);
  if (!(country.sources || []).length)
    fail(`country ${country.slug} needs sources`);
  checkSeo("country", country.slug, country.seoTitle, country.seoDescription);
  if (country.destinationSlugs?.[0] !== "srbija")
    fail(`country ${country.slug} must list srbija first`);
}

for (const city of cities) {
  const parent = countryBySlug.get(city.parentCountry);
  if (!parent)
    fail(`city ${city.slug} parent ${city.parentCountry} is missing`);
  if (!sameList(city.sectionOrder, CITY_SECTIONS))
    fail(`city ${city.slug} sectionOrder does not match the template`);
  if (city.status === "published") {
    if (!city.uniqueFacts || city.uniqueFacts.length < 2)
      fail(`city ${city.slug} is published without at least 2 unique facts`);
    if (!safeUrl(city.consulateOrEmbassy?.url))
      fail(`city ${city.slug} is published without a consulate URL`);
    if ((city.faq || []).length < 1) fail(`city ${city.slug} needs a FAQ`);
    checkSeo("city", city.slug, city.seoTitle, city.seoDescription);
  }
}

for (const destination of publishedDestinations) {
  if (!sameList(destination.sectionOrder, DESTINATION_SECTIONS))
    fail(
      `destination ${destination.slug} sectionOrder does not match the template`,
    );
  if ((destination.faq || []).length < 2)
    fail(`destination ${destination.slug} needs at least 2 FAQ`);
  checkSeo(
    "destination",
    destination.slug,
    destination.seoTitle,
    destination.seoDescription,
  );
}

for (const guide of publishedGuides) {
  checkSeo("guide", guide.slug, guide.seoTitle, guide.seoDescription);
  if ((guide.faq || []).length < 2)
    fail(`guide ${guide.slug} needs at least 2 FAQ`);
}

const pages = [];
const externalUrls = new Set();

function rememberSources(sources) {
  for (const source of sources || []) {
    const url = safeUrl(source.url);
    if (url) externalUrls.add(url);
  }
}

function navHtml(currentPath) {
  return site.nav
    .map((item) => {
      const current = item.href === currentPath;
      return `<a href="${esc(item.href)}"${current ? ' aria-current="page"' : ""}>${esc(item.label)}</a>`;
    })
    .join("");
}

function footerHtml() {
  const columns = [
    {
      title: "Odredišta",
      links: publishedDestinations.map((item) => ({
        href: `/prevoz-u/${item.slug}/`,
        label: item.nameSr,
      })),
    },
    {
      title: "Zemlje polazišta",
      links: publishedCountries.map((item) => ({
        href: `/prevoz-iz/${item.slug}/`,
        label: item.nameSr,
      })),
    },
    {
      title: "Vodiči",
      links: publishedGuides.map((item) => ({
        href: `/${item.slug}/`,
        label: item.navLabel,
      })),
    },
    { title: "Stranice", links: site.footerLinks },
  ];
  return columns
    .map(
      (column) =>
        `<div><h2>${esc(column.title)}</h2><ul>${column.links.map((link) => `<li><a href="${esc(link.href)}">${esc(link.label)}</a></li>`).join("")}</ul></div>`,
    )
    .join("");
}

function countryOptions() {
  const options = publishedCountries.map(
    (country) =>
      `<option value="${esc(country.nameSr)}">${esc(country.nameSr)}</option>`,
  );
  options.push('<option value="Druga zemlja">Druga zemlja</option>');
  return options.join("");
}

function destinationOptions() {
  return publishedDestinations
    .map((destination) => {
      const selected = destination.slug === "srbija" ? " selected" : "";
      return `<option value="${esc(destination.nameSr)}"${selected}>${esc(destination.nameSr)}</option>`;
    })
    .join("");
}

function originIndexHtml() {
  return publishedCountries
    .map(
      (country) =>
        `<li><a href="/prevoz-iz/${esc(country.slug)}/"><span>Prevoz iz</span> ${esc(country.nameSrGenitive || country.nameSr)}</a></li>`,
    )
    .join("");
}

function destinationIndexHtml() {
  return publishedDestinations
    .map(
      (destination) =>
        `<li class="${destination.primary ? "is-primary" : ""}"><a href="/prevoz-u/${esc(destination.slug)}/">${esc(destination.nameSr)}${destination.primary ? " <span>glavno odredište</span>" : ""}</a></li>`,
    )
    .join("");
}

function guideLinksHtml() {
  return `<ul class="inline-links">
    <li><a href="/dokumentacija/">Dokumentacija</a></li>
    <li><a href="/kako-tece-prevoz/">Kako teče prevoz</a></li>
    <li><a href="/cena/">Cena</a></li>
    <li><a href="/kontakt/">Kontakt</a></li>
  </ul>`;
}

function citiesFor(countrySlug) {
  return publishedCities.filter((city) => city.parentCountry === countrySlug);
}

function baseCtx(extra) {
  return {
    ...site,
    whatsappHref: `https://wa.me/${site.whatsapp}`,
    assetCss: extra.assetCss,
    assetJs: extra.assetJs,
    navHtml: navHtml(extra.path),
    footerHtml: footerHtml(),
    countryOptions: countryOptions(),
    destinationOptions: destinationOptions(),
    jsonLd: extra.jsonLd,
    ...extra,
  };
}

function addPage(page) {
  const h1Count = (page.html.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) fail(`${page.path} has ${h1Count} h1 elements`);
  pages.push(page);
  rememberSources(page.sources);
}

function renderPage(templateName, ctx, meta) {
  const html = render(templateName, ctx);
  addPage({ ...meta, html, sources: meta.sources || [] });
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join("\n"));
  process.exit(1);
}

const cssRaw = fs.readFileSync(path.join(root, "src/css/styles.css"));
const jsRaw = fs.readFileSync(path.join(root, "src/js/main.js"));
const cssName = `styles.${crypto.createHash("sha256").update(cssRaw).digest("hex").slice(0, 8)}.css`;
const jsName = `main.${crypto.createHash("sha256").update(jsRaw).digest("hex").slice(0, 8)}.js`;
const assetCss = `/assets/${cssName}`;
const assetJs = `/assets/${jsName}`;

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
fs.writeFileSync(path.join(distDir, "assets", cssName), cssRaw);
fs.writeFileSync(path.join(distDir, "assets", jsName), jsRaw);
const ogSource = path.join(root, "src/og/og-default.png");
writeOgImage(ogSource);
fs.copyFileSync(ogSource, path.join(distDir, "og-default.png"));

function graphFor(crumbs, pathName, extraNodes) {
  const nodes = [organizationNode(site)];
  if (crumbs.length) nodes.push(breadcrumbNode(site, crumbs, pathName));
  for (const node of extraNodes) if (node) nodes.push(node);
  return jsonLd(nodes);
}

function homeCrumbs() {
  return [];
}

const homeCtx = baseCtx({
  assetCss,
  assetJs,
  path: "/",
  seoTitle: home.seoTitle,
  seoDescription: home.seoDescription,
  canonical: `${site.siteUrl}/`,
  ogImage: `${site.siteUrl}/og-default.png`,
  showBreadcrumbs: "",
  h1: home.h1,
  eyebrow: home.eyebrow,
  summary: home.summary,
  reviewed: home.reviewed,
  reviewedDisplay: formatDate(home.reviewed),
  originIndexHtml: originIndexHtml(),
  destinationIndexHtml: destinationIndexHtml(),
  stepsHtml: home.steps
    .map(
      (step, index) =>
        `<li><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p></li>`,
    )
    .join(""),
  factsHtml: home.facts
    .map(
      (fact) =>
        `<div><dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd></div>`,
    )
    .join(""),
  faqHtml: faqHtml(home.faq, "home-faq"),
  faqTitle: site.ui.faqTitle,
  jsonLd: graphFor([], "/", [faqNode(home.faq)]),
});
checkSeo("home", "/", home.seoTitle, home.seoDescription);
renderPage("home.html", homeCtx, {
  path: "/",
  reviewed: home.reviewed,
  sources: home.sources,
});

function countryPage(country) {
  const urlPath = `/prevoz-iz/${country.slug}/`;
  const crumbs = [
    { href: "/", label: "Početna" },
    { href: urlPath, label: country.nameSr },
  ];
  const cityCards = citiesFor(country.slug)
    .map(
      (city) =>
        `<li><a href="/prevoz-iz/${esc(country.slug)}/${esc(city.slug)}/">${esc(city.nameSr)}</a> <span>${esc(city.region)}</span></li>`,
    )
    .join("");
  const routes = country.destinationSlugs
    .map((slug) => {
      const destination = destinationBySlug.get(slug);
      if (!destination || destination.status !== "published") {
        fail(`country ${country.slug} links unpublished destination ${slug}`);
        return "";
      }
      const note =
        slug === "srbija"
          ? "Glavno odredište."
          : "Organizujemo i dostavu ovde, pored prevoza u Srbiju.";
      return `<li><a href="/prevoz-u/${esc(slug)}/">${esc(destination.nameSr)}</a> ${esc(note)}</li>`;
    })
    .join("");
  const documents = country.documents
    .map((doc) => {
      const url = safeUrl(doc.url);
      const name = `${esc(doc.nameLocal)} <span>(${esc(doc.nameSr)})</span>`;
      const issuer = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(doc.issuer)}</a>`
        : esc(doc.issuer);
      return `<li><h3>${name}</h3><p>${issuer}. ${esc(doc.practiceVsLaw)}</p></li>`;
    })
    .join("");
  const ctx = baseCtx({
    assetCss,
    assetJs,
    path: urlPath,
    seoTitle: country.seoTitle,
    seoDescription: country.seoDescription,
    canonical: `${site.siteUrl}${urlPath}`,
    ogImage: `${site.siteUrl}/og-default.png`,
    showBreadcrumbs: "1",
    breadcrumbsHtml: crumbsHtml(crumbs),
    h1: country.h1,
    eyebrow: `Prevoz u Srbiju iz: ${country.nameLocal}`,
    summary: country.summary,
    reviewed: country.reviewed,
    reviewedDisplay: formatDate(country.reviewed),
    regionNotes: country.regionNotes,
    processNotes: country.processNotes,
    factsHtml: [
      ["Zemlja", `${country.nameSr} (${country.nameLocal})`],
      [
        "Dozvola",
        `${country.keyFacts.permitLocal} — ${country.keyFacts.permitSr}`,
      ],
      ["Ko je izdaje", country.keyFacts.issuer],
      ["Prisustvo porodice", country.keyFacts.familyPresence],
      ["Šta treba za ponudu", country.keyFacts.quoteInputs.join("; ")],
    ]
      .map(
        ([label, value]) =>
          `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
      )
      .join(""),
    familyHtml: listHtml(country.familyMustProvide),
    companyHtml: listHtml(country.companyHandles),
    documentsHtml: documents,
    routesHtml: routes,
    guideLinksHtml: guideLinksHtml(),
    citiesHtml: cityCards,
    sourcesHtml: sourcesHtml(country.sources),
    faqHtml: faqHtml(country.faq, `faq-${country.slug}`),
    faqTitle: `Pitanja o prevozu iz ${country.nameSrGenitive || country.nameSr}`,
    jsonLd: graphFor(crumbs, urlPath, [
      serviceNode(site, country.h1, urlPath),
      faqNode(country.faq),
    ]),
  });
  const documentSources = country.documents
    .filter((doc) => safeUrl(doc.url))
    .map((doc) => ({ url: doc.url }));
  renderPage("country.html", ctx, {
    path: urlPath,
    reviewed: country.reviewed,
    sources: [...country.sources, ...documentSources],
  });
}

function cityPage(city) {
  const urlPath = `/prevoz-iz/${city.parentCountry}/${city.slug}/`;
  const parent = countryBySlug.get(city.parentCountry);
  const crumbs = [
    { href: "/", label: "Početna" },
    { href: `/prevoz-iz/${parent.slug}/`, label: parent.nameSr },
    { href: urlPath, label: city.nameSr },
  ];
  const nearby = (city.nearbyCitySlugs || [])
    .map((slug) => {
      const neighbor = publishedCities.find(
        (item) =>
          item.parentCountry === city.parentCountry && item.slug === slug,
      );
      if (!neighbor) {
        warn(`city ${city.slug} nearby ${slug} is not a published city`);
        return "";
      }
      return `<li><a href="/prevoz-iz/${esc(city.parentCountry)}/${esc(neighbor.slug)}/">${esc(neighbor.nameSr)}</a></li>`;
    })
    .join("");
  const destinationLinks = publishedDestinations
    .map(
      (destination) =>
        `<li><a href="/prevoz-u/${esc(destination.slug)}/">${esc(destination.nameSr)}</a></li>`,
    )
    .join("");
  const missionUrl = safeUrl(city.consulateOrEmbassy.url);
  const ctx = baseCtx({
    assetCss,
    assetJs,
    path: urlPath,
    seoTitle: city.seoTitle,
    seoDescription: city.seoDescription,
    canonical: `${site.siteUrl}${urlPath}`,
    ogImage: `${site.siteUrl}/og-default.png`,
    showBreadcrumbs: "1",
    breadcrumbsHtml: crumbsHtml(crumbs),
    h1: city.h1,
    eyebrow: `${city.region}`,
    summary: city.summary,
    reviewed: city.reviewed,
    reviewedDisplay: formatDate(city.reviewed),
    localFactsHtml: listHtml(city.uniqueFacts),
    deathPlace: city.deathRegistration.place,
    deathNote: city.deathRegistration.note,
    missionName: city.consulateOrEmbassy.name,
    missionUrl,
    missionNote: city.consulateOrEmbassy.coversNote,
    nearbyHtml:
      nearby ||
      "<li>Nema drugog objavljenog grada koji je za ovu stranicu označen kao susedni.</li>",
    parentName: parent.nameSrGenitive || parent.nameSr,
    parentUrl: `/prevoz-iz/${parent.slug}/`,
    destinationLinksHtml: destinationLinks,
    sourcesHtml: sourcesHtml(city.sources),
    faqHtml: faqHtml(city.faq, `faq-${city.parentCountry}-${city.slug}`),
    faqTitle: `${city.faq.length > 1 ? "Pitanja" : "Pitanje"} o prevozu iz ${city.nameSrGenitive || city.nameSr}`,
    jsonLd: graphFor(crumbs, urlPath, [
      serviceNode(site, city.h1, urlPath),
      faqNode(city.faq),
    ]),
  });
  renderPage("city.html", ctx, {
    path: urlPath,
    reviewed: city.reviewed,
    sources: city.sources,
  });
}

function destinationPage(destination) {
  const urlPath = `/prevoz-u/${destination.slug}/`;
  const crumbs = [
    { href: "/", label: "Početna" },
    { href: urlPath, label: destination.nameSr },
  ];
  const origins = publishedCountries
    .filter((country) => country.destinationSlugs.includes(destination.slug))
    .map(
      (country) =>
        `<li><a href="/prevoz-iz/${esc(country.slug)}/">Prevoz iz ${esc(country.nameSrGenitive || country.nameSr)}</a></li>`,
    )
    .join("");
  const ctx = baseCtx({
    assetCss,
    assetJs,
    path: urlPath,
    seoTitle: destination.seoTitle,
    seoDescription: destination.seoDescription,
    canonical: `${site.siteUrl}${urlPath}`,
    ogImage: `${site.siteUrl}/og-default.png`,
    showBreadcrumbs: "1",
    breadcrumbsHtml: crumbsHtml(crumbs),
    h1: destination.h1,
    eyebrow: destination.primary
      ? "Glavno odredište"
      : "Pored prevoza u Srbiju",
    summary: destination.summary,
    reviewed: destination.reviewed,
    reviewedDisplay: formatDate(destination.reviewed),
    deliveryNotes: destination.deliveryNotes,
    borderNote: destination.borderNote,
    localFuneralNote: destination.localFuneralNote,
    originsHtml: origins,
    sourcesHtml: sourcesHtml(destination.sources),
    faqHtml: faqHtml(destination.faq, `faq-${destination.slug}`),
    faqTitle: destination.primary
      ? "Pitanja o prevozu u Srbiju"
      : `Pitanja o prevozu u ${destination.nameSr}`,
    jsonLd: graphFor(crumbs, urlPath, [
      serviceNode(site, destination.h1, urlPath),
      faqNode(destination.faq),
    ]),
  });
  renderPage("destination.html", ctx, {
    path: urlPath,
    reviewed: destination.reviewed,
    sources: destination.sources,
  });
}

function documentIndexHtml() {
  const groups = new Map();
  for (const country of publishedCountries) {
    for (const doc of country.documents) {
      const key = doc.nameSr;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(country);
    }
  }
  return [...groups.entries()]
    .map(([name, groupCountries]) => {
      const unique = [
        ...new Map(
          groupCountries.map((country) => [country.slug, country]),
        ).values(),
      ];
      const links = unique
        .map(
          (country) =>
            `<a href="/prevoz-iz/${esc(country.slug)}/">${esc(country.nameSr)}</a>`,
        )
        .join(", ");
      return `<li><h3>${esc(name)}</h3><p>Pomenuto na stranicama: ${links}.</p></li>`;
    })
    .join("");
}

function guidePage(guide) {
  const urlPath = `/${guide.slug}/`;
  const crumbs = [
    { href: "/", label: "Početna" },
    { href: urlPath, label: guide.navLabel },
  ];
  const sections = guide.sections
    .map(
      (section) =>
        `<section class="panel" id="${esc(section.id)}"><h2>${esc(section.heading)}</h2>${section.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</section>`,
    )
    .join("");
  const related = publishedCountries
    .filter((country) =>
      (guide.relatedCountrySlugs || []).includes(country.slug),
    )
    .map(
      (country) =>
        `<li><a href="/prevoz-iz/${esc(country.slug)}/">${esc(country.nameSr)}</a></li>`,
    )
    .join("");
  const howTo = guide.howTo
    ? {
        "@type": "HowTo",
        name: guide.h1,
        description: guide.summary,
        step: guide.sections
          .filter((section) => section.howToStep)
          .map((section, index) => ({
            "@type": "HowToStep",
            position: index + 1,
            name: section.heading,
            text: section.paragraphs.join(" "),
          })),
      }
    : null;
  const ctx = baseCtx({
    assetCss,
    assetJs,
    path: urlPath,
    seoTitle: guide.seoTitle,
    seoDescription: guide.seoDescription,
    canonical: `${site.siteUrl}${urlPath}`,
    ogImage: `${site.siteUrl}/og-default.png`,
    showBreadcrumbs: "1",
    breadcrumbsHtml: crumbsHtml(crumbs),
    h1: guide.h1,
    eyebrow: guide.eyebrow,
    summary: guide.summary,
    reviewed: guide.reviewed,
    reviewedDisplay: formatDate(guide.reviewed),
    guideSectionsHtml: sections,
    autoDocumentsHtml: guide.autoLinkDocuments ? documentIndexHtml() : "",
    relatedHtml: related,
    sourcesHtml: sourcesHtml(guide.sources),
    faqHtml: faqHtml(guide.faq, `faq-${guide.slug}`),
    faqTitle: guide.faqTitle,
    jsonLd: graphFor(crumbs, urlPath, [howTo, faqNode(guide.faq)]),
  });
  renderPage("guide.html", ctx, {
    path: urlPath,
    reviewed: guide.reviewed,
    sources: guide.sources,
  });
}

function legalPage(page) {
  const urlPath = `/${page.slug}/`;
  const crumbs = [
    { href: "/", label: "Početna" },
    { href: urlPath, label: page.navLabel },
  ];
  const sections = page.sections
    .map(
      (section) =>
        `<section class="panel" id="${esc(section.id)}"><h2>${esc(section.heading)}</h2>${section.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</section>`,
    )
    .join("");
  const ctx = baseCtx({
    assetCss,
    assetJs,
    path: urlPath,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    canonical: `${site.siteUrl}${urlPath}`,
    ogImage: `${site.siteUrl}/og-default.png`,
    showBreadcrumbs: "1",
    breadcrumbsHtml: crumbsHtml(crumbs),
    h1: page.h1,
    summary: page.summary,
    reviewed: page.reviewed,
    reviewedDisplay: formatDate(page.reviewed),
    legalSectionsHtml: sections,
    jsonLd: graphFor(crumbs, urlPath, []),
  });
  checkSeo("legal", page.slug, page.seoTitle, page.seoDescription);
  renderPage("legal.html", ctx, {
    path: urlPath,
    reviewed: page.reviewed,
    sources: [],
  });
}

for (const country of publishedCountries) countryPage(country);
for (const city of publishedCities) cityPage(city);
for (const destination of publishedDestinations) destinationPage(destination);
for (const guide of publishedGuides) guidePage(guide);
for (const page of legalPages.filter((item) => item.status === "published"))
  legalPage(page);

const contactPath = "/kontakt/";
const contactCrumbs = [
  { href: "/", label: "Početna" },
  { href: contactPath, label: "Kontakt" },
];
checkSeo("contact", "kontakt", contact.seoTitle, contact.seoDescription);
renderPage(
  "contact.html",
  baseCtx({
    assetCss,
    assetJs,
    path: contactPath,
    seoTitle: contact.seoTitle,
    seoDescription: contact.seoDescription,
    canonical: `${site.siteUrl}${contactPath}`,
    ogImage: `${site.siteUrl}/og-default.png`,
    showBreadcrumbs: "1",
    breadcrumbsHtml: crumbsHtml(contactCrumbs),
    h1: contact.h1,
    summary: contact.summary,
    reviewed: contact.reviewed,
    reviewedDisplay: formatDate(contact.reviewed),
    jsonLd: graphFor(contactCrumbs, contactPath, []),
  }),
  { path: contactPath, reviewed: contact.reviewed, sources: [] },
);

const notFound = render(
  "404.html",
  baseCtx({
    assetCss,
    assetJs,
    path: "/404.html",
    seoTitle: "Stranica nije pronađena | {{BRAND_NAME}}",
    seoDescription:
      "Tražena stranica ne postoji. Vratite se na početnu, zemlje polazišta ili kontakt za prevoz pokojnika u Srbiju.",
    canonical: `${site.siteUrl}/404.html`,
    ogImage: `${site.siteUrl}/og-default.png`,
    robots: "noindex",
    showBreadcrumbs: "",
    jsonLd: jsonLd([organizationNode(site)]),
  }),
);

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join("\n"));
  process.exit(1);
}

for (const page of pages) {
  const target =
    page.path === "/"
      ? path.join(distDir, "index.html")
      : path.join(distDir, page.path.replace(/^\//, ""), "index.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, page.html);
}
fs.writeFileSync(path.join(distDir, "404.html"), notFound);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((page) => `  <url><loc>${site.siteUrl}${page.path}</loc><lastmod>${page.reviewed}</lastmod></url>`).join("\n")}\n</urlset>\n`;
fs.writeFileSync(path.join(distDir, "sitemap.xml"), sitemap);
const sitemapLine = /^https?:\/\//.test(site.siteUrl)
  ? `Sitemap: ${site.siteUrl}/sitemap.xml\n`
  : "";
fs.writeFileSync(
  path.join(distDir, "robots.txt"),
  `User-agent: *\nAllow: /\n${sitemapLine}`,
);
writeFavicon(path.join(distDir, "favicon.ico"));

const llmLines = [
  `# ${site.brandName}`,
  "",
  "Ovo preduzeće organizuje međunarodni drumski prevoz pokojnika pre svega u Srbiju. Po dogovoru organizuje i dostavu u Bosnu i Hercegovinu, Crnu Goru i Severnu Makedoniju.",
  "This organization arranges international road repatriation of the deceased primarily to Serbia, and also to Bosnia and Herzegovina, Montenegro, and North Macedonia.",
  "Stranice su opšta informacija, ne pravni savet. Merodavan je zvanični izvor naveden na stranici.",
  "",
  "## Stranice",
  ...pages.map((page) => `- ${site.siteUrl}${page.path}`),
];
fs.writeFileSync(path.join(distDir, "llms.txt"), `${llmLines.join("\n")}\n`);

function collectLinks(html, from) {
  const links = [];
  const pattern = /href="([^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    const href = match[1];
    if (href.startsWith("/") && !href.startsWith("//")) {
      const clean = href.split("#")[0] || "/";
      const file = /\.(html|txt|xml|png|ico)$/.test(clean);
      links.push({
        from,
        to: clean.endsWith("/") || file ? clean : `${clean}/`,
      });
    }
    match = pattern.exec(html);
  }
  return links;
}

const known = new Set(pages.map((page) => page.path));
known.add("/404.html");
known.add("/og-default.png");
known.add("/favicon.ico");
known.add("/sitemap.xml");
known.add("/robots.txt");
known.add("/llms.txt");
const allLinks = [];
for (const page of pages) allLinks.push(...collectLinks(page.html, page.path));
allLinks.push(...collectLinks(notFound, "/404.html"));
const missing = allLinks.filter(
  (link) =>
    link.to !== "/" && !known.has(link.to) && !link.to.startsWith("/assets/"),
);
const inbound = new Set(allLinks.map((link) => link.to));
const orphans = pages
  .map((page) => page.path)
  .filter((pagePath) => pagePath !== "/" && !inbound.has(pagePath));
fs.writeFileSync(
  path.join(distDir, "link-manifest.json"),
  JSON.stringify(
    {
      pages: [...known],
      links: allLinks,
      missing,
      orphans,
    },
    null,
    2,
  ),
);
if (missing.length)
  fail(
    `Missing internal targets: ${missing.map((link) => `${link.from} -> ${link.to}`).join(", ")}`,
  );
if (orphans.length) fail(`Orphan pages: ${orphans.join(", ")}`);

const cssKb = cssRaw.length / 1024;
const jsKb = jsRaw.length / 1024;
if (cssRaw.length > 30 * 1024) warn(`CSS is ${cssKb.toFixed(1)} KB`);
if (jsRaw.length > 8 * 1024) warn(`JS is ${jsKb.toFixed(1)} KB`);

async function checkExternal() {
  if (process.env.SKIP_LINK_CHECK === "1") {
    console.log("Skipped external link check");
    return;
  }
  const urls = [...externalUrls];
  const results = [];
  let index = 0;
  async function worker() {
    while (index < urls.length) {
      const current = index;
      index += 1;
      const url = urls[current];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; RepatrijacijaLinkCheck/1.0)",
          },
        });
        results.push({ url, status: response.status });
        if (response.status === 404 || response.status >= 500)
          fail(`Source ${url} returned ${response.status}`);
        else if (response.status >= 400)
          warn(`Source ${url} returned ${response.status}`);
      } catch (error) {
        results.push({ url, status: 0, error: error.name });
        fail(`Source ${url} failed: ${error.name}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  fs.writeFileSync(
    path.join(distDir, "source-check.json"),
    JSON.stringify(results, null, 2),
  );
}

await checkExternal();

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `Built ${pages.length} pages, CSS ${cssKb.toFixed(1)} KB, JS ${jsKb.toFixed(1)} KB, ${externalUrls.size} source URLs`,
);
if (warnings.length)
  console.log(warnings.map((warning) => `WARN ${warning}`).join("\n"));
