/**
 * SEO: head tags, structured data, sitemap and robots.txt.
 *
 * Shared by the build (src/_data/cms.js, src/sitemap.njk, src/robots.njk) and
 * the CMS's SEO screen, so the audit and the sitemap preview show exactly what
 * will be published. No DOM, no dependencies.
 *
 * Site-wide settings live in content/settings/seo.json; each page and project
 * has its own `seo` object (title, description, share image, noindex).
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const LIMITS = { title: 60, description: 160 };

/** Canonical base URL: set in the CMS, else the deploy's URL. No trailing slash. */
export const siteBase = (seo = {}, fallback = "") =>
  String(seo.siteUrl || fallback || "").trim().replace(/\/+$/, "");

/** Path of a record on the site. */
export function recordPath(kind, r) {
  if (r.__url) return r.__url;   // collection items carry their own address
  if (kind === "project") return `/project/${r.slug}/`;
  if (r.slug === "404") return "/404.html";
  return r.slug === "index" ? "/" : `/${r.slug}/`;
}

/** Absolute URL for a root-relative path or an already-absolute URL. */
export const absolute = (base, p) =>
  !p ? "" : /^https?:\/\//.test(p) ? p : base + (p.startsWith("/") ? p : "/" + p);

/* ------------------------------------------------------------ auto SEO --
 * When a page has no description or share image of its own, one is taken
 * from its content, so nothing is ever left empty and no two pages end up
 * with the same description. The CMS shows these as suggestions to accept or
 * replace. Off with Settings > SEO > "Fill gaps from page content".
 */

const decode = (s) => String(s)
  .replace(/&nbsp;|\u00a0/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)));

/** Readable text of the paragraphs in some markup, in order. */
function paragraphs(html) {
  const out = [];
  const src = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "").replace(/<form\b[\s\S]*?<\/form>/gi, "");
  // Collection lists (project grids) describe other pages, not this one.
  const own = src.replace(/<div\b[^>]*class="[^"]*w-dyn-list[^"]*"[\s\S]*$/i, (m) => m.replace(/<div\b[^>]*class="[^"]*w-dyn-items[\s\S]*?<\/div><\/div><\/div><\/div>/gi, ""));
  const text = (inner) => decode(inner.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/<big-dot>|•/g, " ").replace(/[\s\u200d]+/g, " ").trim();
  // Real text elements first; a leaf <div> holding text only when there are none.
  for (const m of own.matchAll(/<(p|li|blockquote|h[2-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (/<(p|li|ul|ol|h\d)\b/i.test(m[2])) continue;
    const t = text(m[2]);
    if (t) out.push(t);
  }
  if (!out.some((t) => t.length >= 50)) {
    for (const m of own.matchAll(/<div\b[^>]*>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi)) {
      const t = text(m[1]);
      if (t) out.push(t);
    }
  }
  return out;
}

/** A description from the content: whole sentences, up to about 155 characters. */
export function autoDescription(kind, r, { projects = [], site = {} } = {}) {
  // A page that lists projects is described by what it lists.
  if (kind === "page" && r.projectList && projects.length) {
    const list = projects.filter((p) => !p.draft && (r.projectList !== "featured" || p.featured)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((p) => String(p.title || "").trim()).filter(Boolean);
    if (list.length) {
      const who = site.personName || site.siteName || "";
      const lead = `${who ? `Work by ${who}` : "Projects"}: `;
      let names = "";
      for (const [i, n] of list.entries()) {
        const next = names ? `${names}, ${n}` : n;
        if ((lead + next).length > 150) { names += ` and ${list.length - i} more`; break; }
        names = next;
      }
      return `${lead}${names}.`.replace(/\.\.$/, ".");
    }
  }
  const sources = kind === "project" ? [r.intro, r.body] : [r.bodyHtml];
  const text = sources.flatMap(paragraphs).filter((t) => t.length >= 50 && !/^https?:\/\//.test(t))[0];
  if (!text) return "";
  if (text.length <= 158) return text;
  const cut = text.slice(0, 156);
  const sentence = cut.match(/^(.{60,}[.!?])\s/);
  return sentence ? sentence[1] : cut.replace(/\s+\S*$/, "").replace(/[,;:\-–—]$/, "") + "…";
}

/** The first real content image (not an icon) as a share image. */
export function autoShareImage(kind, r) {
  const html = kind === "project" ? `${r.intro || ""}${r.body || ""}` : r.bodyHtml || "";
  const found = [];
  for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/\ssrc="([^"]+)"/) || [])[1] || "";
    if (/^\/assets\/(img|uploads)\/.+\.(jpe?g|png|webp|avif)$/i.test(src) && !/class="[^"]*(icon|image-2|project-thumbnail)/.test(tag)) found.push(src);
  }
  if (kind === "project") for (const g of r.gallery || []) if (g?.src) found.push(g.src);
  // Social networks show JPG and PNG previews; AVIF and WebP only as a last resort.
  return found.find((x) => SHAREABLE.test(x)) || found[0] || "";
}

/**
 * A page's automatic share image: a 1200x630 screenshot of the page, made by
 * tools/make-share-images.mjs when the site is published (SEO settings >
 * Share images). Its address follows the page's address.
 */
export function shotPath(kind, r) {
  const where = recordPath(kind, r).replace(/\.html$/, "").replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "home";
  return `/assets/img/share/auto/${where}.jpg`;
}

/** Image formats Facebook, LinkedIn and X reliably show as link previews. */
export const SHAREABLE = /\.(jpe?g|png|gif)(\?.*)?$/i;

/** Titles and descriptions after fallbacks - what the page will really carry. */
export function effectiveSeo(kind, r, site = {}, context = {}) {
  const s = r.seo || {};
  const name = String(r.title || "").trim();
  const auto = site.autoSeo !== false;
  let title = s.title || "";
  if (!title && kind !== "page") {
    title = (site.projectTitleTemplate || "{title}").replace("{title}", name);
  }
  const ownDesc = s.description || (kind !== "page" ? plain(r.cardDescription) : "");
  const autoDesc = !ownDesc && auto ? autoDescription(kind, r, { projects: context.projects, site }) : "";
  // A share image chosen for the page always wins. Then, with screenshots on
  // (SEO settings > Share images), a picture of the page itself: for every
  // page ("all") or only those with no image of their own ("missing").
  const derivedImage = kind !== "page" ? r.thumbnail || r.heroImage : "";
  const shots = site.shareShots === "all" || site.shareShots === "missing" ? site.shareShots : "";
  const shot = !s.ogImage && r.slug !== "404" && shots && (shots === "all" || !derivedImage) ? shotPath(kind, r) : "";
  const ownImage = s.ogImage || (shot ? "" : derivedImage);
  const autoImage = !ownImage && !shot && auto ? autoShareImage(kind, r) : "";
  return {
    title: title || name || r.slug,
    description: ownDesc || autoDesc || site.defaultDescription || "",
    descriptionSource: ownDesc ? "own" : autoDesc ? "content" : site.defaultDescription ? "default" : "none",
    shareTitle: s.ogTitle || title || name,
    shareImage: ownImage || shot || autoImage || site.defaultShareImage || "",
    shareImageSource: s.ogImage ? "own" : ownImage ? "card" : shot ? "screenshot" : autoImage ? "content" : site.defaultShareImage ? "default" : "none",
    // The 404 page is for people who mistype an address, not for search results.
    noindex: !!s.noindex || site.allowIndexing === false || r.slug === "404",
  };
}

const plain = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------ head tags -- */

/**
 * Extra <head> tags beyond what the page's own head already has: canonical,
 * og:url/type/site_name, robots, verification, structured data. Added at the
 * end of the head; the title/description/og:title upserts stay in cms.js.
 */
export function extraHeadTags(kind, r, site = {}, base = "") {
  const tags = [];
  const url = base ? absolute(base, recordPath(kind, r)) : "";
  const eff = effectiveSeo(kind, r, site);

  if (url) tags.push(`<link rel="canonical" href="${esc(url)}"/>`, `<meta content="${esc(url)}" property="og:url"/>`);
  tags.push(`<meta content="${kind === "project" ? "article" : "website"}" property="og:type"/>`);
  if (site.siteName) tags.push(`<meta content="${esc(site.siteName)}" property="og:site_name"/>`);
  if (site.twitterHandle) tags.push(`<meta content="${esc("@" + String(site.twitterHandle).replace(/^@/, ""))}" name="twitter:site"/>`);
  if (eff.noindex) tags.push(`<meta content="noindex, follow" name="robots"/>`);
  if (site.googleVerification) tags.push(`<meta content="${esc(site.googleVerification)}" name="google-site-verification"/>`);
  if (site.bingVerification) tags.push(`<meta content="${esc(site.bingVerification)}" name="msvalidate.01"/>`);

  const ld = structuredData(kind, r, site, base);
  if (ld) tags.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`);
  return tags.join("");
}

/** schema.org data: the person and site on the home page, a creative work per project. */
export function structuredData(kind, r, site = {}, base = "") {
  if (site.structuredData === false || !site.personName) return null;
  const person = {
    "@type": "Person",
    name: site.personName,
    ...(site.jobTitle ? { jobTitle: site.jobTitle } : {}),
    ...(base ? { url: base + "/" } : {}),
    ...(site.sameAs?.length ? { sameAs: site.sameAs } : {}),
  };
  if (kind === "page" && r.slug === "index") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: site.siteName || site.personName, ...(base ? { url: base + "/" } : {}) },
        person,
      ],
    };
  }
  if (kind === "page") {
    // Other pages: what kind of page it is, whose site it's on, where it sits.
    if (r.slug === "404") return null;
    const eff = effectiveSeo(kind, r, site);
    const url = base ? absolute(base, recordPath(kind, r)) : undefined;
    const type = { about: "AboutPage", work: "CollectionPage", collaborate: "ContactPage" }[r.slug] || "WebPage";
    const page = {
      "@type": type,
      name: eff.title,
      ...(eff.description ? { description: eff.description } : {}),
      ...(url ? { url } : {}),
      ...(eff.shareImage && base ? { image: absolute(base, eff.shareImage) } : {}),
      ...(base ? { isPartOf: { "@type": "WebSite", name: site.siteName || site.personName, url: base + "/" } } : {}),
      [type === "AboutPage" ? "mainEntity" : "about"]: person,
    };
    if (!base) return { "@context": "https://schema.org", ...page };
    const crumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: base + "/" },
        { "@type": "ListItem", position: 2, name: String(r.title || r.seo?.title || r.slug).split(/\s[—–|-]\s/)[0].trim(), item: url },
      ],
    };
    return { "@context": "https://schema.org", "@graph": [page, crumbs] };
  }
  if (kind === "item") {
    const eff = effectiveSeo(kind, r, site);
    const image = eff.shareImage;
    return {
      "@context": "https://schema.org",
      "@type": r.__schemaType || "CreativeWork",
      name: String(r.title || "").trim(),
      ...(eff.description ? { description: eff.description } : {}),
      ...(base ? { url: absolute(base, recordPath(kind, r)) } : {}),
      ...(image && base ? { image: absolute(base, image) } : {}),
      [r.__schemaType === "Service" ? "provider" : "author"]: person,
    };
  }
  if (kind === "project") {
    const eff = effectiveSeo(kind, r, site);
    const image = eff.shareImage || r.heroImage;
    const work = {
      "@type": "CreativeWork",
      name: String(r.title || "").trim(),
      ...(eff.description ? { description: eff.description } : {}),
      ...(base ? { url: absolute(base, recordPath(kind, r)) } : {}),
      ...(image && base ? { image: absolute(base, image) } : {}),
      ...(r.year ? { dateCreated: String(r.year) } : {}),
      ...(r.tags?.length ? { keywords: r.tags.join(", ") } : {}),
      author: person,
    };
    if (!base) return { "@context": "https://schema.org", ...work };
    // Home > Work > Project, so search results can show where the page sits.
    const crumbs = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: base + "/" },
        { "@type": "ListItem", position: 2, name: "Work", item: base + "/work/" },
        { "@type": "ListItem", position: 3, name: String(r.title || "").trim(), item: absolute(base, recordPath(kind, r)) },
      ],
    };
    return { "@context": "https://schema.org", "@graph": [work, crumbs] };
  }
  return null;
}

/* ------------------------------------------------------------ redirects --
 * Static hosting can't send a 301, so an old address gets a small page that
 * forwards at once (meta refresh), names the new address as canonical, and
 * asks not to be indexed - the standard substitute search engines follow.
 */

const dirPath = (p) => {
  let x = "/" + String(p || "").trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
  if (!/\.html?$/i.test(x) && !x.endsWith("/")) x += "/";
  return x;
};

/** A link from one site path to another that survives a path prefix. */
export function relativeUrl(from, to) {
  if (/^https?:\/\//i.test(to)) return to;
  const depth = dirPath(from).split("/").filter(Boolean).length - (/\.html?$/i.test(from) ? 1 : 0);
  return ("../".repeat(depth) || "./") + dirPath(to).replace(/^\//, "");
}

/**
 * Every redirect: old project addresses (recorded when a project's URL is
 * changed) and the custom ones from SEO settings. A redirect never shadows a
 * real page.
 */
export function redirectList({ projects = [], pages = [], site = {} }) {
  const live = new Set([
    ...projects.filter((p) => !p.draft).map((p) => recordPath("project", p)),
    ...pages.map((p) => recordPath("page", p)),
    ...(arguments[0].items || []).filter((p) => !p.draft).map((p) => p.__url),
  ]);
  const out = new Map();
  const add = (from, to, source) => {
    const f = dirPath(from);
    if (!from || !to || f === "/" || live.has(f) || out.has(f) || f.startsWith("/admin/") || f.startsWith("/assets/")) return;
    out.set(f, { from: f, to: /^https?:\/\//i.test(to) ? to : dirPath(to), source });
  };
  for (const p of projects) {
    if (p.draft) continue;
    for (const old of p.redirectFrom || []) add(`/project/${old}/`, recordPath("project", p), p.title?.trim() || p.slug);
  }
  for (const it of arguments[0].items || []) {
    if (it.draft) continue;
    const prefix = it.__url.replace(/[^/]+\/$/, "");
    const slug = it.__url.slice(prefix.length).replace(/\/$/, "");
    const label = String(it.title || it.slug).trim();
    for (const old of it.redirectFrom || []) add(`${prefix}${old}/`, it.__url, label);
    // The collection moved: its old addresses (and old slugs there) forward too.
    for (const pre of it.__oldPrefixes || []) {
      for (const s of [slug, ...(it.redirectFrom || [])]) add(`${pre.replace(/\/?$/, "/")}${s}/`, it.__url, label);
    }
  }
  for (const r of site.redirects || []) add(r.from, r.to, "custom");
  return [...out.values()];
}

export function redirectPage({ from, to }, base = "") {
  const rel = relativeUrl(from, to);
  const canonical = /^https?:\/\//i.test(to) ? to : base ? absolute(base, to) : rel;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title>` +
    `<meta name="robots" content="noindex"><link rel="canonical" href="${esc(canonical)}">` +
    `<meta http-equiv="refresh" content="0; url=${esc(rel)}"></head>` +
    `<body><p>This page has moved to <a href="${esc(rel)}">${esc(canonical)}</a>.</p></body></html>\n`;
}

/* -------------------------------------------------------------- sitemap -- */

/** Every image a record shows, for the sitemap's image entries. */
export function imagesOf(r) {
  const out = new Set();
  for (const k of ["heroImage", "thumbnail"]) if (r[k]) out.add(r[k]);
  for (const g of r.gallery || []) if (g?.src) out.add(g.src);
  for (const k of ["intro", "body", "bodyHtml"]) {
    for (const m of String(r[k] || "").matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)) {
      if (/^\/assets\/(img|uploads)\//.test(m[1]) && !/\.svg$/i.test(m[1])) out.add(m[1]);
    }
  }
  return [...out];
}

/**
 * The sitemap's entries: published, indexable pages and projects.
 * lastmod is the date the CMS last saved the record (or git's, in the build).
 */
export function sitemapEntries({ pages = [], projects = [], items = [], site = {}, base = "", lastmod = () => "" }) {
  if (site.allowIndexing === false) return [];
  const entries = [];
  const add = (kind, r, priority) => {
    if (r.draft || effectiveSeo(kind, r, site).noindex) return;
    entries.push({
      kind,
      slug: r.slug,
      title: String(r.title || r.seo?.title || r.slug).trim(),
      loc: absolute(base, recordPath(kind, r)),
      lastmod: r.updatedAt || lastmod(kind, r) || "",
      priority,
      // The page's images, its share image (thumbnail) first.
      images: site.sitemapImages === false ? [] : [...new Set([effectiveSeo(kind, r, site).shareImage, ...imagesOf(r)].filter(Boolean))].map((i) => absolute(base, i)),
    });
  };
  for (const p of pages) add("page", p, p.slug === "index" ? "1.0" : "0.8");
  for (const p of projects) add("project", p, "0.7");
  for (const p of items) add("item", p, "0.6");
  return entries;
}

/**
 * The screenshots the publish step has to make: each page whose share image
 * is a screenshot, its address, and what to use if the screenshot fails.
 */
export function shareShotList({ pages = [], projects = [], items = [], site = {} }) {
  const out = [];
  const add = (kind, r) => {
    if (r.draft) return;
    const eff = effectiveSeo(kind, r, site);
    if (eff.shareImageSource !== "screenshot") return;
    out.push({ file: eff.shareImage, url: recordPath(kind, r), fallback: effectiveSeo(kind, r, { ...site, shareShots: "" }).shareImage || "" });
  };
  for (const p of pages) add("page", p);
  for (const p of projects) add("project", p);
  for (const p of items) add("item", p);
  return out;
}

export function renderSitemap(entries) {
  const lines = entries.map((e) =>
    "  <url>\n" +
    `    <loc>${esc(e.loc)}</loc>\n` +
    (e.lastmod ? `    <lastmod>${esc(e.lastmod)}</lastmod>\n` : "") +
    `    <priority>${e.priority}</priority>\n` +
    e.images.map((i) => `    <image:image><image:loc>${esc(i)}</image:loc></image:image>\n`).join("") +
    "  </url>");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    lines.join("\n") + "\n</urlset>\n";
}

export function renderRobots(site = {}, base = "") {
  const lines = ["User-agent: *"];
  if (site.allowIndexing === false) {
    lines.push("Disallow: /");
  } else {
    lines.push("Allow: /", "", "# The CMS is not content and should never be indexed.", "Disallow: /admin/");
    for (const p of String(site.robotsDisallow || "").split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      lines.push(`Disallow: ${p.startsWith("/") ? p : "/" + p}`);
    }
  }
  if (base && site.allowIndexing !== false) lines.push("", `Sitemap: ${base}/sitemap.xml`);
  return lines.join("\n") + "\n";
}

/* ---------------------------------------------------------------- audit -- */

/** Problems worth fixing on one record, most important first. */
export function auditRecord(kind, r, site = {}, context = {}) {
  const issues = [];
  const eff = effectiveSeo(kind, r, site, context);
  if (r.draft) return issues;
  if (eff.noindex) issues.push({ level: "info", text: "Hidden from search engines" });
  if (!eff.description) issues.push({ level: "warn", text: "No meta description" });
  else if (eff.description.length > LIMITS.description) issues.push({ level: "info", text: `Description is ${eff.description.length} characters; search shows about ${LIMITS.description}` });
  if (eff.title.length > LIMITS.title) issues.push({ level: "info", text: `Title is ${eff.title.length} characters; search shows about ${LIMITS.title}` });
  if (!eff.shareImage) issues.push({ level: "info", text: "No share image" });
  else if (!SHAREABLE.test(eff.shareImage)) issues.push({ level: "warn", text: `Share image is ${(eff.shareImage.split(".").pop() || "").toUpperCase()} — Facebook, LinkedIn and X won't show it; choose a JPG or PNG` });
  const alt = altCoverage(r);
  if (alt.total && alt.missing) issues.push({ level: "warn", text: `${alt.missing} of ${alt.total} images have no alt text` });
  return issues;
}

/** Images with and without alt text, ignoring icons and decorative helpers. */
export function altCoverage(r) {
  let total = 0, missing = 0;
  const count = (alt) => { total += 1; if (!String(alt || "").trim()) missing += 1; };
  if (r.heroImage) count(r.heroAlt);
  for (const g of r.gallery || []) count(g.alt);
  for (const k of ["intro", "body", "bodyHtml"]) {
    for (const m of String(r[k] || "").matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1] || "";
      if (/\.svg$/i.test(src) || /class="[^"]*(icon|image-2|project-icon)/.test(tag)) continue;
      const alt = (tag.match(/\salt="([^"]*)"/) || [])[1];
      if (alt === "alt-holder") { count(""); continue; }   // a CSS hook, not a description
      count(alt);
    }
  }
  return { total, missing };
}
