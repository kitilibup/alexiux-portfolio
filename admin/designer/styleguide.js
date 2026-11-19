/**
 * The Style Guide: Webflow's page of every text style, as a Designer page.
 *
 *   Colors      the site's colour variables
 *   Fonts       every family in Site settings, each weight
 *   Tags        H1-H6, paragraph, link, lists, quote (styled as "All H1
 *               Headings" etc. - tag selectors, used on every page)
 *   Text styles every class the site uses for type, with its real text
 *
 * Clicking a sample selects it: its class (or tag) is then styled everywhere
 * it's used. Each sample shows what it computes to at the current breakpoint
 * and which variables its style uses. The page itself is never saved - only
 * the styles changed on it (design.json).
 */

import { customClasses, TAG_SELECTORS } from "./model.js?v=6600ab59";

export const STYLE_GUIDE = "__styleguide";

const TYPE_PROPS = new Set(["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "font-style"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The guide's own chrome: neutral, never selectable, immune to the site's styles.
const GUIDE_CSS = `
.cms-sg{display:block;background:#fff;padding:40px 48px 80px}
.cms-sg-title,.cms-sg-lead,.cms-sg-h,.cms-sg-sw div,.cms-sg-font>b,.cms-sg-font>span,.cms-sg-meta,.cms-sg-empty{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;letter-spacing:0;text-transform:none;font-style:normal}
.cms-sg-title{font-size:28px;font-weight:600;line-height:1.2;margin:0 0 6px}
.cms-sg-lead{color:#6e6e73;max-width:720px;margin:0 0 28px}
.cms-sg-h{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6e6e73;margin:44px 0 12px;padding-bottom:8px;border-bottom:1px solid #e5e5ea}
.cms-sg-colors{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.cms-sg-sw{border:1px solid #e5e5ea;border-radius:8px;overflow:hidden}
.cms-sg-sw i{display:block;height:64px;border-bottom:1px solid #e5e5ea}
.cms-sg-sw div{padding:8px 10px}
.cms-sg-sw b,.cms-sg-meta b,.cms-sg-font>b{font-weight:600}
.cms-sg-dim{color:#8e8e93}
.cms-sg-font{padding:16px 0;border-bottom:1px solid #f0f0f2;color:#1d1d1f}
.cms-sg-font .aa{font-size:44px;line-height:1.1;margin:6px 0}
.cms-sg-font .w{font-size:18px;line-height:1.5}
.cms-sg-row{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;align-items:start;padding:18px 0;border-bottom:1px solid #f0f0f2}
.cms-sg-meta code{font:12px/1.4 ui-monospace,Menlo,monospace;color:#5b3fd6;word-break:break-all}
.cms-sg-meta .spec{display:block;margin-top:4px;color:#6e6e73}
.cms-sg-meta .vars{display:block;margin-top:2px;color:#2b7a4b}
.cms-sg-sample{min-width:0;overflow:hidden}
.cms-sg-sample [data-cms-sample]{position:relative!important;inset:auto!important;transform:none!important;opacity:1!important;visibility:visible!important;max-width:100%}
`;

/**
 * Which classes the site uses, and a real example of each (tag + text), from
 * every page, template and component.
 */
function usedClasses(sources) {
  const doc = new DOMParser().parseFromString("<!doctype html><body></body>", "text/html");
  const out = new Map();
  for (const html of sources) {
    const box = doc.createElement("div");
    box.innerHTML = String(html || "").replace(/\{\{=[^}]*\}\}/g, "");
    for (const n of box.querySelectorAll("[class]")) {
      const text = n.textContent.replace(/\s+/g, " ").trim().slice(0, 90);
      for (const c of customClasses(n)) {
        const had = out.get(c);
        if (!had || (!had.text && text)) out.set(c, { tag: n.tagName.toLowerCase(), text });
      }
    }
  }
  return out;
}

/** Rough px size of a CSS length, for ordering only. */
function approxPx(v) {
  const m = String(v || "").match(/(-?[\d.]+)\s*(px|rem|em|vw|vh|%)?/);
  if (!m) return 0;
  const n = Number(m[1]);
  return { rem: 16, em: 16, vw: 14.4, vh: 9, "%": 0.16 }[m[2]] ? n * { rem: 16, em: 16, vw: 14.4, vh: 9, "%": 0.16 }[m[2]] : n;
}

/** Selectors that set type at the base breakpoint, with their declarations. */
function typeClasses(D, used) {
  const found = new Map();
  for (const r of D.parsed.rules) {
    if (r.breakpoint !== "base") continue;
    for (const s of r.selector.split(",").map((x) => x.trim())) {
      const m = s.match(/^\.([\w-]+)$/);
      if (!m || /^w-/.test(m[1]) || !used.has(m[1])) continue;
      const decls = r.decls.filter((d) => TYPE_PROPS.has(d.prop));
      if (!decls.length) continue;
      const cur = found.get(m[1]) || {};
      for (const d of decls) cur[d.prop] = d.value;
      found.set(m[1], cur);
    }
  }
  for (const [sel, props] of Object.entries(D.design.styles?.base || {})) {
    const m = sel.match(/^\.([\w-]+)$/);
    if (!m || !Object.keys(props).some((p) => TYPE_PROPS.has(p))) continue;
    found.set(m[1], { ...(found.get(m[1]) || {}), ...props });
  }
  return [...found.entries()]
    .sort((a, b) => approxPx(b[1]["font-size"]) - approxPx(a[1]["font-size"]) || a[0].localeCompare(b[0]));
}

const varNames = (D) => {
  const own = Object.keys(D.design.variables || {}).filter((k) => !D.parsed.variables.some((v) => v.name === k));
  return [...D.parsed.variables.map((v) => v.name), ...own];
};
const varValue = (D, name) => D.design.variables?.[name] ?? D.parsed.variables.find((v) => v.name === name)?.value ?? "";
export const isColorValue = (v) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$|currentcolor$|[a-z]+$)/i.test(String(v).trim()) && !/^(inherit|initial|unset|auto|none|normal)$/i.test(String(v).trim());
export const isSizeValue = (v) => /^-?[\d.]+(px|rem|em|vw|vh|%|ch)?$/i.test(String(v).trim()) || /^(calc|clamp|min|max)\(/i.test(String(v).trim());

function row(selector, label, sampleHtml) {
  return `<div class="cms-sg-row"><div class="cms-sg-meta"><code>${esc(label)}</code>` +
    `<span class="spec" data-cms-spec="${esc(selector)}"></span><span class="vars" data-cms-vars="${esc(selector)}"></span></div>` +
    `<div class="cms-sg-sample">${sampleHtml}</div></div>`;
}

/** The guide's markup. */
export function styleGuideHtml(D, sources) {
  const used = usedClasses(sources);
  const vars = varNames(D);
  const colors = vars.filter((v) => isColorValue(varValue(D, v)));

  const families = D.fonts?.families || [];
  const fontsHtml = families.map((f) => {
    const weights = [...new Set((f.faces || []).map((x) => Number(x.weight) || 400))].sort((a, b) => a - b);
    const stack = `'${f.name}', ${f.fallback || "sans-serif"}`;
    return `<div class="cms-sg-font"><b>${esc(f.name)}</b> <span class="cms-sg-dim">${esc(f.source === "google" ? "Google Fonts" : "self-hosted")} · fallback ${esc(f.fallback || "sans-serif")}</span>` +
      `<div class="aa" style="font-family:${esc(stack)}">Aa Bb Cc 0123</div>` +
      weights.map((w) => `<div class="w" style="font-family:${esc(stack)};font-weight:${w}">${w} — The quick brown fox jumps over the lazy dog</div>`).join("") + "</div>";
  }).join("") || '<div class="cms-sg-empty">No fonts set in Site settings.</div>';

  const SAMPLE = {
    h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", h5: "Heading 5", h6: "Heading 6",
    p: "Paragraph — body text as it appears in every page and rich text. The quick brown fox jumps over the lazy dog.",
  };
  const tags = [
    ...["h1", "h2", "h3", "h4", "h5", "h6", "p"].map((t) => row(t, TAG_SELECTORS[t], `<${t} data-cms-sample>${SAMPLE[t]}</${t}>`)),
    row("a", TAG_SELECTORS.a, '<p><a href="#" data-cms-sample>A text link</a></p>'),
    row("blockquote", TAG_SELECTORS.blockquote, "<blockquote data-cms-sample>A block quote: a passage set apart from the text around it.</blockquote>"),
    row("ul", TAG_SELECTORS.ul, "<ul data-cms-sample><li>First item</li><li>Second item</li><li>Third item</li></ul>"),
    row("ol", TAG_SELECTORS.ol, "<ol data-cms-sample><li>First item</li><li>Second item</li></ol>"),
  ].join("");

  const classes = typeClasses(D, used).map(([c]) => {
    const ex = used.get(c);
    const tag = /^(h[1-6]|p|div|a|span|li|blockquote|label|figcaption)$/.test(ex.tag) ? (ex.tag === "a" ? "div" : ex.tag) : "div";
    return row("." + c, "." + c, `<${tag} class="${esc(c)}" data-cms-sample>${esc(ex.text || "The quick brown fox jumps over the lazy dog")}</${tag}>`);
  }).join("");

  return `<style>${GUIDE_CSS}</style><div class="cms-sg" data-cms-guide>` +
    '<div class="cms-sg-title">Style Guide</div>' +
    '<div class="cms-sg-lead">Every text style on the site, at the breakpoint you are editing. Click a sample to style it — the change applies everywhere that tag or class is used. Colours and sizes come from Variables; fonts from Site settings.</div>' +
    `<div class="cms-sg-h">Colors · ${colors.length} variables</div><div class="cms-sg-colors">` +
    colors.map((v) => `<div class="cms-sg-sw"><i style="background:var(${esc(v)})"></i><div><b>${esc(v.replace(/^--/, ""))}</b><br><span class="cms-sg-dim">${esc(varValue(D, v))} · ${D.varUses.get(v) || 0} uses</span></div></div>`).join("") +
    "</div>" +
    `<div class="cms-sg-h">Fonts</div>${fontsHtml}` +
    `<div class="cms-sg-h">Tags · styled on every page</div>${tags}` +
    `<div class="cms-sg-h">Text styles · classes</div>${classes || '<div class="cms-sg-empty">No text classes found.</div>'}` +
    "</div>";
}

/** The guide as a Designer page (never saved). */
export function styleGuidePage(D, sources, shellFrom) {
  return {
    slug: STYLE_GUIDE, name: "Style Guide", virtual: true, layout: "utility",
    htmlOpen: shellFrom?.htmlOpen || "", head: shellFrom?.head || "", bodyOpen: shellFrom?.bodyOpen || '<body class="body-mod">',
    bodyHtml: styleGuideHtml(D, sources),
  };
}

/** Fill each sample's live spec (computed at this breakpoint) and its variables. */
export function paintStyleGuideMeta(D) {
  const doc = D.doc;
  if (!doc?.querySelector("[data-cms-guide]")) return;
  const authored = (sel) => {
    const out = new Set();
    for (const bp of ["base", "tablet", "landscape", "portrait"]) {
      for (const r of D.index.get(sel) || []) if (r.breakpoint === bp) for (const d of r.decls) for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) out.add(m[1]);
      for (const v of Object.values(D.design.styles?.[bp]?.[sel] || {})) for (const m of String(v).matchAll(/var\((--[\w-]+)/g)) out.add(m[1]);
    }
    return [...out];
  };
  for (const spec of doc.querySelectorAll("[data-cms-spec]")) {
    const row = spec.closest(".cms-sg-row");
    const n = row?.querySelector("[data-cms-sample]");
    if (!n) continue;
    const cs = D.win.getComputedStyle(n.tagName === "UL" || n.tagName === "OL" ? n.querySelector("li") || n : n);
    const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const lh = cs.lineHeight === "normal" ? "normal" : `${Math.round(parseFloat(cs.lineHeight))}px`;
    spec.textContent = `${family} · ${Math.round(parseFloat(cs.fontSize) * 10) / 10}px / ${lh} · ${cs.fontWeight}` +
      (cs.textTransform !== "none" ? ` · ${cs.textTransform}` : "") + (cs.letterSpacing !== "normal" ? ` · ${cs.letterSpacing}` : "");
    const v = authored(spec.getAttribute("data-cms-spec"));
    row.querySelector("[data-cms-vars]").textContent = v.length ? "uses " + v.map((x) => "var(" + x + ")").join(", ") : "";
  }
}
