/**
 * Fonts: settings -> fonts.css, and fallback stacks applied to the site CSS.
 *
 * content/settings/site.json `fonts`:
 *   display    font-display for every face (swap: text shows at once in the
 *              fallback, then switches)
 *   families   [{ name, source: "google" | "upload" | "system",
 *                 fallback: "system-ui, Arial, sans-serif",
 *                 faces: [{ weight, style, src, unicodeRange?, subset? }] }]
 *
 * Fonts are always self-hosted (Google Fonts are downloaded once by the CMS),
 * so visitors' browsers never contact Google.
 */

const q = (name) => (/^[\w-]+$/.test(name) ? name : `'${String(name).replace(/'/g, "")}'`);
const quoteName = (name) => `'${String(name).replace(/'/g, "")}'`;

export const GENERIC = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "math", "emoji", "inherit", "initial", "unset"];
/** Fonts that come with operating systems - named in stacks, never loaded. */
export const SYSTEM_FONTS = ["helvetica neue", "helvetica", "arial", "verdana", "georgia", "times new roman", "times", "segoe ui", "ubuntu", "roboto", "-apple-system", "blinkmacsystemfont", "tahoma", "trebuchet ms", "courier new", "menlo", "consolas", "monaco"];

export function fontsCss(fonts = {}) {
  const display = fonts.display || "swap";
  const out = ["/* Generated from Settings > Fonts. Edit fonts in the CMS, not here. */"];
  for (const fam of fonts.families || []) {
    for (const f of fam.faces || []) {
      if (!f.src) continue;
      const fmt = /\.woff2$/i.test(f.src) ? "woff2" : /\.woff$/i.test(f.src) ? "woff" : /\.otf$/i.test(f.src) ? "opentype" : "truetype";
      if (f.subset) out.push(`/* ${f.subset} */`);
      out.push("@font-face {",
        `  font-family: ${quoteName(fam.name)};`,
        `  font-style: ${f.style || "normal"};`,
        `  font-weight: ${f.weight || 400};`,
        `  font-display: ${display};`,
        `  src: url(${f.src}) format('${fmt}');`,
        ...(f.unicodeRange ? [`  unicode-range: ${f.unicodeRange};`] : []),
        "}");
    }
  }
  return out.join("\n") + "\n";
}

/** Font families the stylesheet asks for, with how often. */
export function familiesUsed(css) {
  const used = new Map();
  for (const m of String(css).matchAll(/font-family:\s*([^;}]+)/g)) {
    const first = m[1].split(",")[0].trim().replace(/^['"]|['"]$/g, "").replace(/\s*!important$/, "");
    if (!first || GENERIC.includes(first.toLowerCase()) || SYSTEM_FONTS.includes(first.toLowerCase()) || /^webflow-icons$/i.test(first)) continue;
    used.set(first, (used.get(first) || 0) + 1);
  }
  return used;
}

/**
 * Rewrite every font-family declaration whose first font is a configured
 * family so it ends with that family's fallback stack. Only declarations
 * naming the family first are touched, and only their fallback part.
 */
export function applyFallbacks(css, fonts = {}) {
  const stacks = new Map();
  for (const fam of fonts.families || []) {
    if (fam.fallback && fam.fallback.trim()) stacks.set(fam.name.toLowerCase(), fam.fallback.trim());
  }
  if (!stacks.size) return css;
  return String(css).replace(/font-family:\s*([^;}]+)/g, (decl, value) => {
    const important = /!important\s*$/.test(value) ? " !important" : "";
    const list = value.replace(/!important\s*$/, "").split(",").map((s) => s.trim()).filter(Boolean);
    const first = list[0]?.replace(/^['"]|['"]$/g, "");
    const stack = first && stacks.get(first.toLowerCase());
    if (!stack) return decl;
    return `font-family: ${q(first)}, ${stack}${important}`;
  });
}

/** Parse an @font-face stylesheet (fonts.css or a Google Fonts css2 response). */
export function parseFontFaces(css) {
  const faces = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[2];
    const get = (k) => (body.match(new RegExp(`${k}:\\s*([^;]+);`)) || [])[1]?.trim();
    const src = (get("src") || "").match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1];
    faces.push({
      family: (get("font-family") || "").replace(/^['"]|['"]$/g, ""),
      style: get("font-style") || "normal",
      weight: Number(get("font-weight")) || get("font-weight") || 400,
      src,
      unicodeRange: get("unicode-range") || undefined,
      subset: m[1] || undefined,
    });
  }
  return faces;
}
