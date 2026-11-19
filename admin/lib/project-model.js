/**
 * The Projects collection: field model and renderer.
 *
 * Shared by the build (src/_data/cms.js) and the CMS (admin/), so the preview
 * in the editor is produced by exactly the code that produces the site. No DOM,
 * no dependencies - it runs unchanged in Node and in the browser.
 *
 * A project is stored as plain fields (content/projects/<slug>.json). The
 * Webflow markup they are poured into lives once, verbatim, in
 * content/_templates/project.json:
 *
 *   shell   head, html/body open, wrapper, footer and scripts
 *   body    the page body with {{=field}} markers where the fields go
 *   card    one "Next case" card, the template for the reference field
 *
 * Empty fields are rendered the way Webflow renders them (w-dyn-bind-empty,
 * w-condition-invisible, w-dyn-hide), which is what keeps the rebuilt pages
 * byte-identical to the originals. tools/migrate-projects.mjs proves that for
 * every project before it writes anything.
 */

/* ------------------------------------------------------------- escaping --
 * Webflow escapes text and attribute values identically: & < > " and ' (as
 * &#x27;). Matching it exactly is what makes an untouched field reproduce the
 * original bytes.
 */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const unesc = (s) =>
  String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

/** Webflow's encoding of collection-item templates inside <script> tags. */
export const wfEncode = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export const pad2 = (n) => String(n ?? "").padStart(2, "0");

/**
 * The number shown on the page and cards: set by hand, or the project's
 * position among the published projects in Work order (the first is 01).
 */
export const displayNumber = (p) => (String(p.number ?? "").trim() ? String(p.number) : pad2(p.position ?? p.order));

/** Positions (1, 2, 3…) of the published projects in Work order. */
export function withPositions(projects) {
  const live = projects.filter((p) => !p.draft).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.slug).localeCompare(String(b.slug)));
  const pos = new Map(live.map((p, i) => [p.slug, i + 1]));
  return projects.map((p) => ({ ...p, position: pos.get(p.slug) }));
}

/* ---------------------------------------------------------------- limits --
 * The Webflow template has exactly five slots for tags and for deliverables,
 * each with its own class, so five is a real limit of the design.
 */
export const MAX_TAGS = 5;
export const MAX_DELIVERABLES = 5;
const TAG_CLASSES = ["paragraph-4", "paragraph-3", "paragraph", "paragraph-2", "paragraph-5"];

/* ------------------------------------------------------------ safety --
 * Rich text is the one place an editor can write arbitrary markup (the HTML
 * view). Whatever is typed there, the published page never gets script:
 * script/style/object/embed/form elements, on* handlers, javascript: and
 * data: URLs (except images) are removed, and embeds are kept only from known
 * video players. Valid Webflow rich text never contains any of these, so
 * existing content passes through byte-for-byte.
 */
const EMBED_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|fast\.wistia\.(net|com)|[\w-]+\.wistia\.com|(www\.)?loom\.com|cdn\.embedly\.com)\//i;

export function sanitizeRich(html) {
  let out = String(html ?? "");
  const BANNED = "script|style|object|embed|form|template|noscript|meta|link|base|svg|math";
  // Paired elements go with their contents; then any stray opening or closing tags.
  out = out.replace(new RegExp(`<(${BANNED})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "");
  out = out.replace(new RegExp(`<\\/?(${BANNED})\\b[^>]*>`, "gi"), "");
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*"\s*(javascript|vbscript|data(?!:image\/(png|jpe?g|gif|webp|avif);))[^"]*"/gi, "");
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => {
    const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1] || "";
    const abs = src.startsWith("//") ? "https:" + src : src;
    return EMBED_HOSTS.test(abs) ? tag : "";
  });
  return out;
}

/** A rich-text value counts as empty when it has no text and no media. */
export const isEmptyRich = (html) =>
  !String(html ?? "").replace(/<(?!img|iframe|figure)[^>]*>/gi, "").replace(/[\s‍ ]/g, "");

/* -------------------------------------------------------------- pieces -- */

function tagSlots(tags = []) {
  return TAG_CLASSES.map((cls, i) => {
    const t = tags[i];
    return t
      ? `<div class="list-item-container"><p class="${cls}">${esc(t)}</p></div>`
      : `<div class="list-item-container w-condition-invisible"><p class="${cls} w-dyn-bind-empty"></p></div>`;
  }).join("");
}

export function deliverableSlots(items = []) {
  return Array.from({ length: MAX_DELIVERABLES }, (_, i) => {
    const t = items[i];
    return t
      ? `<div class="list-item-container"><div class="text-extra-small">${esc(t)}</div></div>`
      : `<div class="list-item-container w-condition-invisible"><div class="text-extra-small w-dyn-bind-empty"></div></div>`;
  }).join("");
}

const galleryItem = (img) => {
  if (!img?.src) {
    return `<div role="listitem" class="collection-item-2 w-dyn-item w-dyn-repeater-item"><img src="" loading="eager" style="background-image:none" alt="" class="image-3 w-dyn-bind-empty"/></div>`;
  }
  return `<div role="listitem" class="collection-item-2 w-dyn-item w-dyn-repeater-item"><img src="${esc(img.src)}" loading="eager" style="${esc(`background-image:url("${img.src}")`)}" alt="${esc(img.alt ?? "")}" class="image-3"/></div>`;
};

function gallery(images = []) {
  const list = images.filter((i) => i?.src);
  // webflow.js clones this script's payload for items it adds client-side; it
  // always holds the first item, or an empty one.
  const script = `<script type="text/x-wf-template" id="wf-template-25b2dc20-9107-2a84-3c38-7a6983b3d288">${wfEncode(galleryItem(list[0]))}</script>`;
  return list.length
    ? `${script}<div role="list" class="images-grid w-dyn-items">${list.map(galleryItem).join("")}</div><div class="empty-state w-dyn-hide w-dyn-empty"><div></div></div>`
    : `${script}<div role="list" class="images-grid w-dyn-items w-dyn-hide"></div><div class="empty-state w-dyn-empty"><div></div></div>`;
}

/* ---------------------------------------------------------------- video --
 * Webflow's Video field stored a URL and rendered it through embedly. Those
 * embeds are kept verbatim. A URL entered in the CMS is embedded directly with
 * the provider's own player - no third-party key involved.
 */
export function embedForUrl(url) {
  const u = String(url || "").trim();
  let m;
  if ((m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/))) {
    return { src: `https://www.youtube.com/embed/${m[1]}`, title: "YouTube video" };
  }
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) {
    return { src: `https://player.vimeo.com/video/${m[1]}`, title: "Vimeo video" };
  }
  if ((m = u.match(/(?:wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/)(\w+)/))) {
    return { src: `https://fast.wistia.net/embed/iframe/${m[1]}`, title: "Wistia video" };
  }
  if ((m = u.match(/loom\.com\/(?:share|embed)\/(\w+)/))) {
    return { src: `https://www.loom.com/embed/${m[1]}`, title: "Loom video" };
  }
  return null;
}

export function videoEmbedHtml(video, label = "") {
  if (!video) return "";
  if (video.embed) return sanitizeRich(video.embed);
  const e = embedForUrl(video.url);
  if (!e) return "";
  const title = label ? `${label} — video` : e.title;
  return `<iframe src="${esc(e.src)}" width="960" height="540" scrolling="no" title="${esc(title)}" frameborder="0" loading="lazy" allow="autoplay; fullscreen; encrypted-media; picture-in-picture;" allowfullscreen="true"></iframe>`;
}

function videoBlock(video, label) {
  const html = videoEmbedHtml(video, label);
  return html
    ? `<div style="padding-top:${esc(video.ratio || "56.25%")}" class="video-2 w-video w-embed">${html}</div>`
    : `<div class="video-2 w-dyn-bind-empty w-video w-embed"></div>`;
}

/* ----------------------------------------------------------------- cards --
 * One card markup serves the Work grid, the home grid and "Next case"; each
 * page carries its own copy (different Webflow ids), so cards are filled in
 * place rather than generated: every field the card shows is written into the
 * template, and nothing of the template's own project survives.
 */

const VOID_EL = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

/** Offsets of the element whose opening tag matches `pattern`. */
export function findEl(html, pattern, from = 0) {
  const re = new RegExp(pattern, "g");
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return null;
  const name = m[0].match(/^<([a-zA-Z][a-zA-Z0-9-]*)/)[1].toLowerCase();
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  tagRe.lastIndex = m.index;
  let depth = 0, t;
  while ((t = tagRe.exec(html))) {
    const tag = t[2].toLowerCase();
    if (tag !== name || VOID_EL.has(tag) || t[4]) continue;
    if (t[1]) {
      if (--depth === 0) {
        return { start: m.index, end: tagRe.lastIndex, innerStart: m.index + m[0].length, innerEnd: t.index, open: m[0] };
      }
    } else depth += 1;
  }
  return null;
}

/** Replace an element's inner HTML, and optionally its opening tag. */
function setEl(html, pattern, inner, open) {
  const at = findEl(html, pattern);
  if (!at) return html;
  return html.slice(0, at.start) + (open ?? at.open) + inner + html.slice(at.innerEnd);
}

const withClass = (openTag, cls, on) => {
  const has = new RegExp(`\\s${cls}(?=[\\s"])`);
  return openTag.replace(/class="([^"]*)"/, (m, v) => {
    const list = v.split(/\s+/).filter((c) => c && c !== cls);
    if (on) list.push(cls);
    return `class="${list.join(" ")}"`;
  });
};

export function fillCard(template, p) {
  let card = template;
  card = setEl(card, '<div\\b[^>]*class="text-project-description"[^>]*>', esc(displayNumber(p)));
  card = setEl(card, '<div\\b[^>]*class="text-divider"[^>]*>', esc(p.year));
  card = setEl(card, '<h3\\b[^>]*class="case-heading"[^>]*>', esc(p.title || p.slug));
  card = card.replace(/href="\/project\/[^"]*"/g, `href="/project/${esc(p.slug)}"`);

  card = card.replace(/<img\b[^>]*class="project-thumbnail[^"]*"[^>]*>/, (tag) =>
    tag.replace(/\ssrc="[^"]*"/, ` src="${esc(p.thumbnail || "")}"`)
       .replace(/\s(?:srcset|sizes)="[^"]*"/g, "")
       // An empty alt gets the project's own image description.
       .replace(/\salt=""/, () => ` alt="${esc(p.thumbnailAlt || p.heroAlt || String(p.title || "").trim())}"`));

  const desc = findEl(card, '<p\\b[^>]*class="[^"]*case-grid-description[^"]*"[^>]*>');
  if (desc) {
    const open = withClass(desc.open, "w-dyn-bind-empty", !p.cardDescription);
    card = card.slice(0, desc.start) + open + esc(p.cardDescription || "") + card.slice(desc.innerEnd);
  }

  card = setEl(card, '<div\\b[^>]*class="list-container deliverables-container"[^>]*>',
    deliverableSlots(p.deliverables));

  const cat = findEl(card, '<div\\b[^>]*class="cast-category[^"]*"[^>]*>');
  if (cat) {
    const open = withClass(cat.open, "w-dyn-bind-empty", !p.category);
    card = card.slice(0, cat.start) + open + esc(p.category || "") + card.slice(cat.innerEnd);
  }
  return card;
}

/* ------------------------------------------------------------------ page -- */

/** Fields every project has, with their empty values. */
export const EMPTY_PROJECT = Object.freeze({
  title: "",
  slug: "",
  year: "",
  order: 0,
  number: "",
  draft: true,
  featured: false,
  heroImage: "",
  heroAlt: "",
  intro: "",
  tags: [],
  link: "",
  linkLabel: "",
  body: "",
  gallery: [],
  video: null,
  thumbnail: "",
  cardDescription: "",
  deliverables: [],
  category: "",
  nextProject: "",
  nextLabel: "",
  seo: {},
});

const rich = (cls, html) =>
  isEmptyRich(html)
    ? `<div ${cls.replace(/class="([^"]*) w-richtext"/, 'class="$1 w-dyn-bind-empty w-richtext"')}></div>`
    : `<div ${cls}>${sanitizeRich(html)}</div>`;

/**
 * The page body for one project.
 *
 * `projects` is the whole collection, for resolving the Next case reference;
 * a missing or draft reference leaves the section empty rather than linking to
 * a page that does not exist.
 */
export function renderProjectBody(p, template, projects = [], { bindHtml } = {}) {
  const fields = projectFields(p, template, projects);
  const body = template.body.replace(/\{\{=(\w+)\}\}/g, (m, k) => (k in fields ? fields[k] : m));
  // Elements bound in the Designer (data-cms-*) are filled like any collection
  // template's; the original Webflow markup has none, so it is left as it is.
  return bindHtml && /\sdata-cms-/.test(template.body) ? bindHtml(body, { ...p, __url: `/project/${p.slug}/` }) : body;
}

/** Each {{=marker}}'s markup for one project (also the Designer's sample content). */
export function projectFields(p, template, projects = []) {
  const next = p.nextProject
    ? projects.find((q) => q.slug === p.nextProject && !q.draft)
    : null;

  return {
    title: esc(p.title),
    year: esc(p.year),
    number: esc(displayNumber(p)),
    linkLabel: esc(p.linkLabel || "Link"),
    nextLabel: esc(p.nextLabel || "Next case"),
    heroImage: esc(p.heroImage),
    heroAlt: esc(p.heroAlt),
    intro: rich('id="w-node-_3693b455-f75b-a00e-07ff-510666b7393b-564b9122" class="text-project-description w-richtext"', p.intro),
    tags: tagSlots(p.tags),
    link: esc(p.link),
    linkClass: p.link ? "link-block-2 w-inline-block" : "link-block-2 w-inline-block w-condition-invisible",
    body: rich('class="rich-text-block-project w-richtext"', p.body),
    gallery: gallery(p.gallery),
    video: videoBlock(p.video, String(p.title || "").trim()),
    next: next ? fillCard(template.card, next) : "",
  };
}

/**
 * The template as the Designer shows it: every marker replaced by the sample
 * project's content inside a placeholder the serializer turns back into the
 * marker. Attribute markers keep the real value for display and remember
 * their field in data-cms-attrs.
 */
export function templateForDesigner(template, sample, projects = []) {
  const fields = projectFields(sample, template, projects);
  const LABEL = { title: "Name", year: "Year", number: "Number", heroImage: "Hero image", heroAlt: "Hero alt", intro: "Intro", tags: "Tags",
    link: "Project link", linkClass: "Link visibility", linkLabel: "Link text", body: "Case study", gallery: "Gallery", video: "Video", next: "Next case", nextLabel: "Next case heading" };
  // Markers inside attribute values.
  let body = template.body.replace(/<([a-zA-Z][\w-]*)\b([^>]*\{\{=\w+\}\}[^>]*)>/g, (tag, name, attrs) => {
    const map = [];
    const out = attrs.replace(/\s([\w-]+)="([^"]*)"/g, (m, attr, value) => {
      const mm = value.match(/^\{\{=(\w+)\}\}$/);
      if (!mm) return m;
      map.push(`${attr}:${mm[1]}`);
      return ` ${attr}="${fields[mm[1]] ?? ""}"`;
    });
    return `<${name}${out} data-cms-attrs="${map.join(",")}">`;
  });
  // Markers in content: a placeholder holding the sample markup.
  body = body.replace(/\{\{=(\w+)\}\}/g, (m, k) =>
    `<cms-bind data-cms-marker="${k}" data-cms-label="${LABEL[k] || k}" style="display:contents">${fields[k] ?? ""}</cms-bind>`);
  return body;
}

/** The <html> open tag carries the item slug Webflow published it under. */
export const renderHtmlOpen = (p, template) =>
  template.shell.htmlOpen.replace("{{=slug}}", esc(p.slug));

/** Validation shared by the CMS (before saving) and the build (before failing). */
export function validateProject(p, projects = []) {
  const errors = [];
  if (!String(p.title || "").trim()) errors.push("Name is required.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug || "")) errors.push("Slug must be lowercase letters, numbers and dashes.");
  if (p.year && !/^(19|20)\d{2}$/.test(String(p.year))) errors.push("Year should be four digits, e.g. 2025.");
  if ((p.tags || []).length > MAX_TAGS) errors.push(`At most ${MAX_TAGS} tags fit the page layout.`);
  if ((p.deliverables || []).length > MAX_DELIVERABLES) errors.push(`At most ${MAX_DELIVERABLES} deliverables fit the card.`);
  if (p.link && !/^(https?:\/\/|mailto:|\/)/i.test(p.link)) errors.push("Link should start with https://");
  if (p.video?.url && !p.video.embed && !embedForUrl(p.video.url)) {
    errors.push("Video URL isn't one we can embed (YouTube, Vimeo, Wistia or Loom).");
  }
  if (p.nextProject && p.nextProject === p.slug) errors.push("Next case can't point at the project itself.");
  if (p.nextProject && projects.length && !projects.some((q) => q.slug === p.nextProject)) {
    errors.push(`Next case points at "${p.nextProject}", which doesn't exist.`);
  }
  return errors;
}
