/**
 * The site's stylesheet as data: variables, rules, breakpoints, classes - and
 * the design overrides made in the CMS.
 *
 * Webflow's exported CSS is never edited. Changes made in the CMS (Design)
 * are stored in content/settings/design.json and laid over it at build time:
 *   variables   new values for :root custom properties (colours etc.)
 *   styles      per breakpoint, per selector, property -> value
 * Overrides repeat the original selector and come after the original rule, so
 * they win at equal specificity, exactly where the original applied - and
 * removing an override restores the original.
 *
 * Shared by the CMS (Design screen, page builder) and the build
 * (tools/apply-design.mjs). No DOM, no dependencies.
 */

/** Webflow's breakpoints, widest first, as the CMS names them. */
export const BREAKPOINTS = [
  { id: "xxl", label: "1920 and up", media: "screen and (min-width: 1920px)", width: 1920 },
  { id: "xl", label: "1440 and up", media: "screen and (min-width: 1440px)", width: 1440 },
  { id: "lg", label: "1280 and up", media: "screen and (min-width: 1280px)", width: 1280 },
  { id: "base", label: "Desktop", media: "", width: 1200 },
  { id: "tablet", label: "Tablet", media: "screen and (max-width: 991px)", width: 991 },
  { id: "landscape", label: "Mobile landscape", media: "screen and (max-width: 767px)", width: 767 },
  { id: "portrait", label: "Mobile portrait", media: "screen and (max-width: 479px)", width: 479 },
];
const BY_MEDIA = new Map(BREAKPOINTS.map((b) => [normMedia(b.media), b.id]));

function normMedia(m) { return String(m || "").replace(/\s+/g, " ").replace(/^@media\s*/i, "").trim().toLowerCase(); }
export const breakpointOf = (media) => BY_MEDIA.get(normMedia(media)) ?? null;

/* --------------------------------------------------------------- parse -- */

/** Split "a: b; c: d" into declarations, respecting url() and quotes. */
export function parseDecls(body) {
  const out = [];
  let buf = "", depth = 0, quote = null;
  for (const ch of String(body)) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) { push(buf); buf = ""; continue; }
    buf += ch;
  }
  push(buf);
  return out;
  function push(d) {
    const i = d.indexOf(":");
    if (i < 1) return;
    const prop = d.slice(0, i).trim().toLowerCase();
    const value = d.slice(i + 1).trim();
    if (prop && value) out.push({ prop, value });
  }
}

/**
 * Parse a stylesheet into rules. Handles @media/@supports nesting; other
 * at-rules (@font-face, @keyframes) are kept as opaque blocks.
 */
export function parseCss(css) {
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const variables = [];
  let i = 0;

  function block(media) {
    while (i < src.length) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const head = src.slice(i, open).trim();
      i = open + 1;
      if (/^@(media|supports)/i.test(head)) {
        block(/^@media/i.test(head) ? head.replace(/^@media\s*/i, "") : media);
        continue;
      }
      // Find this block's end, skipping nested braces (keyframes).
      let depth = 1, j = i;
      while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
      const body = src.slice(i, j - 1);
      i = j;
      if (head.startsWith("@")) continue;
      const decls = parseDecls(body);
      for (const sel of splitSelectors(head)) {
        rules.push({ selector: sel, media: media || "", breakpoint: media ? breakpointOf(media) : "base", decls });
        if (sel === ":root") for (const d of decls) if (d.prop.startsWith("--")) variables.push({ name: d.prop, value: d.value });
      }
    }
  }
  block("");
  return { rules, variables };
}

export function splitSelectors(s) {
  const out = [];
  let buf = "", depth = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Class names a selector mentions. */
export const classesIn = (selector) => [...String(selector).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

/** class -> rules that mention it. */
export function classIndex(rules) {
  const idx = new Map();
  for (const r of rules) for (const c of new Set(classesIn(r.selector))) {
    if (!idx.has(c)) idx.set(c, []);
    idx.get(c).push(r);
  }
  return idx;
}

/** How often each variable is used. */
export function variableUses(css) {
  const uses = new Map();
  for (const m of String(css).matchAll(/var\(\s*(--[\w-]+)/g)) uses.set(m[1], (uses.get(m[1]) || 0) + 1);
  return uses;
}

/* ----------------------------------------------------------- overrides -- */

/** Values that could break out of a declaration are refused. */
export const safeValue = (v) => typeof v === "string" && v.trim() !== "" && !/[{};<>]|\/\*|\\[0-9a-f]/i.test(v);
export const safeSelector = (s) => typeof s === "string" && s.trim() !== "" && !/[{};<>]|\/\*/.test(s);
export const safeProp = (p) => /^-{0,2}[a-z][a-z0-9-]*$/i.test(p);

/** The CSS for a design: variable values and style overrides, per breakpoint. */
export function overrideCss(design = {}) {
  const out = ["/* Design overrides from the CMS (content/settings/design.json) */"];
  const vars = Object.entries(design.variables || {}).filter(([k, v]) => /^--[\w-]+$/.test(k) && safeValue(v));
  if (vars.length) out.push(`:root {\n${vars.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`);
  // Breakpoints in cascade order: wider media first, so narrower ones win.
  for (const bp of BREAKPOINTS) {
    const sels = design.styles?.[bp.id];
    if (!sels) continue;
    const blocks = [];
    for (const [sel, props] of Object.entries(sels)) {
      if (!safeSelector(sel)) continue;
      const decls = Object.entries(props || {}).filter(([p, v]) => safeProp(p) && safeValue(v));
      if (decls.length) blocks.push(`${sel} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join("\n")}\n}`);
    }
    if (!blocks.length) continue;
    out.push(bp.media ? `@media ${bp.media} {\n${blocks.join("\n")}\n}` : blocks.join("\n"));
  }
  return out.length > 1 ? out.join("\n") + "\n" : "";
}

/** Order the base block before media blocks the way Webflow does. */
export const BREAKPOINT_ORDER = ["base", "lg", "xl", "xxl", "tablet", "landscape", "portrait"];

/* ----------------------------------------------------- apply in place --
 * Appending overrides at the end of the file would break Webflow's cascade:
 * a desktop override would also beat the original tablet and phone values,
 * which come earlier. So each override is inserted right after the last
 * original rule for that selector in the same breakpoint (or at the end of
 * that breakpoint's section when there is none): it wins where the original
 * applied, and narrower breakpoints keep their own values.
 */

/** Top-level blocks of a stylesheet with offsets; @media blocks carry their children. */
function blocks(css, from = 0, to = css.length) {
  const out = [];
  let i = from;
  while (i < to) {
    // skip comments and whitespace
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = e === -1 ? to : e + 2; continue; }
    if (/\s/.test(css[i])) { i++; continue; }
    if (css[i] === "}") return { out, end: i };
    const open = css.indexOf("{", i);
    if (open === -1 || open >= to) break;
    const head = css.slice(i, open).trim();
    if (/^@media/i.test(head)) {
      const inner = blocks(css, open + 1, to);
      out.push({ type: "media", media: head.replace(/^@media\s*/i, ""), start: i, bodyStart: open + 1, bodyEnd: inner.end, end: inner.end + 1, children: inner.out });
      i = inner.end + 1;
      continue;
    }
    let depth = 1, j = open + 1;
    while (j < to && depth) {
      if (css.startsWith("/*", j)) { const e = css.indexOf("*/", j + 2); j = e === -1 ? to : e + 2; continue; }
      if (css[j] === "{") depth++; else if (css[j] === "}") depth--;
      j++;
    }
    out.push({ type: head.startsWith("@") ? "at" : "rule", head, selectors: head.startsWith("@") ? [] : splitSelectors(head), start: i, end: j });
    i = j;
  }
  return { out, end: to };
}

export function applyDesign(css, design = {}) {
  const src = String(css);
  const top = blocks(src).out;
  const inserts = [];   // [offset, text]

  // Variables: a :root block placed right after the original :root.
  const vars = Object.entries(design.variables || {}).filter(([k, v]) => /^--[\w-]+$/.test(k) && safeValue(v));
  if (vars.length) {
    const root = top.find((b) => b.type === "rule" && b.selectors.includes(":root"));
    inserts.push([root ? root.end : 0, `\n:root {\n${vars.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`]);
  }

  // Webflow's own CSS (with media blocks of its own) comes first and the
  // site's rules follow, so "the desktop section" is every top-level rule,
  // and its end is after the last one.
  const topRules = top.filter((b) => b.type === "rule");
  const lastTopRule = topRules.at(-1);
  const mediaBlocks = (id) => top.filter((b) => b.type === "media" && breakpointOf(b.media) === id);

  for (const bp of BREAKPOINTS) {
    const sels = design.styles?.[bp.id];
    if (!sels) continue;
    const pool = bp.id === "base" ? topRules : mediaBlocks(bp.id).flatMap((m) => m.children);
    for (const [sel, props] of Object.entries(sels)) {
      if (!safeSelector(sel)) continue;
      const decls = Object.entries(props || {}).filter(([p, v]) => safeProp(p) && safeValue(v));
      if (!decls.length) continue;
      const text = `\n${sel} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join("\n")}\n}`;
      const target = sel.trim();
      const last = pool.filter((b) => b.type === "rule" && b.selectors.some((s) => s === target)).at(-1);
      if (last) { inserts.push([last.end, text]); continue; }
      // No original rule here: end of this breakpoint's section.
      if (bp.id === "base") { inserts.push([lastTopRule ? lastTopRule.end : src.length, text]); continue; }
      const m = mediaBlocks(bp.id).at(-1);
      if (m) inserts.push([m.bodyEnd, text + "\n"]);
      else inserts.push([src.length, `\n@media ${bp.media} {${text}\n}\n`]);
    }
  }

  // Apply from the end so earlier offsets stay valid; equal offsets keep their order.
  inserts.sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [at, text] of inserts) out = out.slice(0, at) + text + out.slice(at);
  return out;
}

/** Number of overridden properties, for badges. */
export function overrideCount(design = {}) {
  let n = Object.keys(design.variables || {}).length;
  for (const sels of Object.values(design.styles || {})) for (const props of Object.values(sels || {})) n += Object.keys(props || {}).length;
  return n;
}
