/**
 * Variables beyond colours: the kinds of value a variable holds (as in
 * Webflow: Color, Size, Number, Percentage, Font family), the numbers the site
 * repeats that could become variables, and switching those places over.
 *
 * Works on the parsed stylesheet (css-model parseCss) and design.json; the
 * stylesheet itself is never edited - a place switched to a variable is a
 * Designer override `prop: var(--name)` for that selector and breakpoint.
 * No DOM; used by the CMS's Variables page and the tests.
 */

const NUM = /^-?(?:\d+\.?\d*|\.\d+)$/;
const LEN = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|vw|vh|vmin|vmax|ch|ex|svh|dvh)$/i;
const PCT = /^-?(?:\d+\.?\d*|\.\d+)%$/;
const FN = /^(calc|clamp|min|max)\(/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|transparent$|currentcolor$)/i;

export const TYPES = [
  { id: "color", label: "Color", group: "Colors", example: "#146ef5" },
  { id: "size", label: "Size", group: "Sizes", example: "1.5rem" },
  { id: "number", label: "Number", group: "Numbers", example: "1.4" },
  { id: "percentage", label: "Percentage", group: "Percentages", example: "50%" },
  { id: "font", label: "Font family", group: "Fonts", example: "'Inter Display', sans-serif" },
];

/** The kind of value, or "other". */
export function typeOf(value) {
  const v = String(value ?? "").trim();
  if (COLOR.test(v)) return "color";
  if (LEN.test(v) || FN.test(v) || v === "0") return "size";
  if (PCT.test(v)) return "percentage";
  if (NUM.test(v)) return "number";
  if (/['",]|serif|sans|mono|system-ui/i.test(v)) return "font";
  return "other";
}

/** Whether a value fits a type (for "New variable"). */
export function fits(type, value) {
  const t = typeOf(value);
  return t === type || (type === "size" && t === "number" && Number(value) === 0);
}

/* What the repeated values are for: property -> family. */
const FAMILIES = [
  [/^font-size$/, "font-size", "Font size"],
  [/^line-height$/, "line-height", "Line height"],
  [/^letter-spacing$/, "letter-spacing", "Letter spacing"],
  [/^(margin|padding)(-(top|right|bottom|left))?$|^(row-|column-)?gap$|^grid-(row|column)-gap$/, "spacing", "Spacing"],
  [/^border(-(top|bottom)-(left|right))?-radius$/, "radius", "Radius"],
  [/^border(-(top|right|bottom|left))?-width$/, "border", "Border width"],
  [/^(max-|min-)?(width|height)$/, "dimension", "Width / height"],
  [/^opacity$/, "opacity", "Opacity"],
  [/^z-index$/, "layer", "Layer (z-index)"],
];
export const familyOf = (prop) => {
  const f = FAMILIES.find(([re]) => re.test(prop));
  return f ? { id: f[1], label: f[2] } : null;
};

/** A plain repeated number worth a variable: one token, not zero, not auto/calc. */
const candidateValue = (v, family) => {
  const s = String(v).trim();
  if (!(LEN.test(s) || PCT.test(s) || NUM.test(s)) || /^-?0+(\.0+)?[a-z%]*$/i.test(s)) return false;
  // "Full width/height" is layout, not a design value.
  return !(family === "dimension" && /^100(%|vw|vh|svh|dvh)$/i.test(s));
};
// Webflow's own framework classes (.w-button, .w-nav...) aren't the site's design.
const frameworkSelector = (sel) => /(^|[\s>+~,(])\.w-[\w-]/.test(sel);

/**
 * Numbers the site uses in several places, per family: what a variable could
 * replace. Counts places as they apply now - an original value the Designer
 * has overridden doesn't count, an override does.
 *   -> [{ family, label, value, places: [{ bp, selector, prop }] }], most used first
 */
export function numericCandidates(rules, design = {}, { min = 3 } = {}) {
  const groups = new Map();
  const seen = new Set();
  const add = (bp, selector, prop, value) => {
    const fam = familyOf(prop);
    if (!fam || !candidateValue(value, fam.id) || frameworkSelector(selector)) return;
    const k = `${bp}\u0000${selector}\u0000${prop}`;
    if (seen.has(k)) return;
    seen.add(k);
    const key = `${fam.id}\u0000${value.trim()}`;
    if (!groups.has(key)) groups.set(key, { family: fam.id, label: fam.label, value: value.trim(), places: [] });
    groups.get(key).places.push({ bp, selector, prop });
  };
  const styles = design.styles || {};
  // Overrides first: they're what applies where they exist.
  for (const [bp, sels] of Object.entries(styles)) for (const [selector, props] of Object.entries(sels || {})) for (const [prop, value] of Object.entries(props || {})) add(bp, selector, prop, String(value));
  for (const r of rules) {
    if (!r.breakpoint || r.selector === ":root") continue;   // only places the Designer can override
    for (const d of r.decls) {
      if (styles[r.breakpoint]?.[r.selector]?.[d.prop] != null) continue;
      add(r.breakpoint, r.selector, d.prop, d.value);
    }
  }
  return [...groups.values()].filter((g) => g.places.length >= min)
    .sort((a, b) => b.places.length - a.places.length || a.label.localeCompare(b.label));
}

/** A name for a new variable from its family and value: spacing-2rem, font-size-18px. */
export const suggestName = (family, value) => `${family}-${String(value).trim().replace(/%/g, "pct").replace(/\./g, "-").replace(/[^a-z0-9-]+/gi, "").toLowerCase()}`;

/** Create (or set) a variable and point these places at it. */
export function useVariable(design, name, value, places = []) {
  design.variables = design.variables || {};
  design.variables[name] = value;
  design.styles = design.styles || {};
  for (const { bp, selector, prop } of places) {
    design.styles[bp] = design.styles[bp] || {};
    design.styles[bp][selector] = design.styles[bp][selector] || {};
    design.styles[bp][selector][prop] = `var(${name})`;
  }
  return design;
}

const refRe = (name) => new RegExp(`var\\(\\s*${name.replace(/[-]/g, "\\-")}\\s*(?:,[^()]*(?:\\([^()]*\\)[^()]*)*)?\\)`, "g");

/** Where the Designer's styles use a variable: [{ bp, selector, prop }]. */
export function placesUsing(design, name) {
  const out = [];
  const re = refRe(name);
  for (const [bp, sels] of Object.entries(design.styles || {})) for (const [selector, props] of Object.entries(sels || {})) for (const [prop, v] of Object.entries(props || {})) {
    re.lastIndex = 0;
    if (re.test(String(v))) out.push({ bp, selector, prop });
  }
  return out;
}

/** Remove a variable; styles that used it keep its value (like Webflow's detach). */
export function detachVariable(design, name) {
  const value = design.variables?.[name];
  if (value == null) return design;
  for (const sels of Object.values(design.styles || {})) for (const props of Object.values(sels || {})) for (const k of Object.keys(props || {})) props[k] = String(props[k]).replace(refRe(name), value);
  for (const k of Object.keys(design.variables)) if (k !== name) design.variables[k] = String(design.variables[k]).replace(refRe(name), value);
  delete design.variables[name];
  return design;
}
