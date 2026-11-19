/**
 * The Designer's model of a page: what each element is, what it may contain,
 * the elements you can add, and where a style property's value comes from.
 */

import { BREAKPOINTS } from "../lib/css-model.js?v=6600ab59";

/* ------------------------------------------------------------ elements -- */

/** Webflow's name for an element, from its tag and classes. */
export function elementType(el) {
  const tag = el.tagName.toLowerCase();
  const c = el.classList;
  if (c.contains("w-dyn-list")) return "Collection List Wrapper";
  if (c.contains("w-dyn-items")) return "Collection List";
  if (c.contains("w-dyn-item")) return "Collection Item";
  if (c.contains("w-richtext")) return "Rich Text";
  if (c.contains("w-layout-grid")) return "Grid";
  if (c.contains("w-video")) return "Video";
  if (c.contains("w-embed")) return "Embed";
  if (c.contains("w-form")) return "Form Block";
  if (c.contains("w-nav")) return "Navbar";
  if (c.contains("w-button")) return "Button";
  if (c.contains("w-row")) return "Columns";
  if (c.contains("w-col")) return "Column";
  switch (tag) {
    case "img": return "Image";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "Heading";
    case "p": return "Paragraph";
    case "a": return el.querySelector("div,img,h1,h2,h3,h4,h5,h6,p,section") || c.contains("w-inline-block") ? "Link Block" : "Text Link";
    case "ul": case "ol": return "List";
    case "li": return "List Item";
    case "section": return "Section";
    case "figure": return "Figure";
    case "figcaption": return "Caption";
    case "form": return "Form";
    case "input": return "Input";
    case "textarea": return "Text Area";
    case "label": return "Field Label";
    case "span": return "Text Span";
    case "strong": case "b": return "Bold Text";
    case "em": case "i": return "Italic Text";
    case "blockquote": return "Block Quote";
    case "iframe": return "Embed";
    case "svg": return "SVG";
    case "nav": return "Nav";
    case "header": return "Header";
    case "footer": return "Footer";
    default:
      if ([...c].some((x) => /(^|-)container($|-)/.test(x))) return "Container";
      if (c.contains("section") || [...c].some((x) => /(^|-)section($|-)/.test(x))) return "Section";
      return "Div Block";
  }
}

/** Classes that are styling choices (Webflow's own w-* runtime classes aren't). */
export const customClasses = (el) =>
  [...el.classList].filter((c) => !/^(w-|cms-)/.test(c) && c !== "w--current");

/**
 * Webflow's tag selectors: an element without a class is styled through its
 * tag, for every page ("All H1 Headings", "All Paragraphs", ...).
 */
export const TAG_SELECTORS = {
  body: "Body (All Pages)", h1: "All H1 Headings", h2: "All H2 Headings", h3: "All H3 Headings", h4: "All H4 Headings",
  h5: "All H5 Headings", h6: "All H6 Headings", p: "All Paragraphs", a: "All Links", ul: "All Unordered Lists",
  ol: "All Ordered Lists", li: "All List Items", blockquote: "All Block Quotes", strong: "All Bold Text", em: "All Italic Text",
  img: "All Images", figure: "All Figures", figcaption: "All Figure Captions", label: "All Form Labels",
};
export const tagSelectorFor = (el) => (TAG_SELECTORS[el.tagName.toLowerCase()] ? el.tagName.toLowerCase() : "");
export const selectorLabel = (sel) => TAG_SELECTORS[sel] || sel;

/** The selector Webflow styles an element with: its classes, combined. */
export const selectorFor = (el) => {
  const cls = customClasses(el);
  return cls.length ? cls.map((c) => "." + c).join("") : "";
};

const VOID = new Set(["img", "input", "br", "hr", "source", "meta", "link"]);
const TEXTY = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "span", "blockquote", "figcaption", "label", "strong", "em"]);

/** Can other elements be placed inside this one? */
export function canContain(el) {
  const tag = el.tagName.toLowerCase();
  if (VOID.has(tag) || tag === "iframe" || tag === "svg" || tag === "script") return false;
  if (el.classList.contains("w-embed") || el.classList.contains("w-dyn-list") || el.classList.contains("w-richtext")) return false;
  if (TEXTY.has(tag) && tag !== "li") return false;
  return true;
}

/** Elements whose text is edited by double-clicking. */
export function isTextEditable(el) {
  const tag = el.tagName.toLowerCase();
  if (el.classList.contains("w-richtext")) return true;
  if (TEXTY.has(tag) || (tag === "a" && elementType(el) !== "Link Block") || el.classList.contains("w-button")) return true;
  // A div holding only text (Webflow's "Text Block").
  return tag === "div" && el.children.length === 0 && el.textContent.trim() !== "";
}

/* -------------------------------------------------------- add panel -- */

export const ELEMENT_GROUPS = [
  { label: "Structure", items: [
    { id: "section", name: "Section", html: '<section class="section"><div class="container"></div></section>' },
    { id: "container", name: "Container", html: '<div class="container"></div>' },
    { id: "div", name: "Div Block", html: "<div></div>" },
    { id: "grid", name: "Grid", html: '<div class="w-layout-grid"><div></div><div></div></div>' },
    { id: "columns", name: "Columns", html: '<div class="w-row"><div class="w-col w-col-6"></div><div class="w-col w-col-6"></div></div>' },
  ] },
  { label: "Typography", items: [
    { id: "heading", name: "Heading", html: "<h2>Heading</h2>" },
    { id: "paragraph", name: "Paragraph", html: "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique.</p>" },
    { id: "textlink", name: "Text Link", html: '<a href="#">Text Link</a>' },
    { id: "textblock", name: "Text Block", html: "<div>This is some text inside of a div block.</div>" },
    { id: "quote", name: "Block Quote", html: "<blockquote>Block Quote</blockquote>" },
    { id: "richtext", name: "Rich Text", html: '<div class="w-richtext"><h2>Heading</h2><p>A rich text element can be used with static or dynamic content.</p></div>' },
    { id: "list", name: "List", html: '<ul role="list"><li>List item</li><li>List item</li></ul>' },
  ] },
  { label: "Basic", items: [
    { id: "button", name: "Button", html: '<a href="#" class="w-button">Button Text</a>' },
    { id: "linkblock", name: "Link Block", html: '<a href="#" class="w-inline-block"></a>' },
    { id: "image", name: "Image", html: '<img src="" loading="lazy" alt=""/>', pickImage: true },
    { id: "video", name: "Video", html: '<div style="padding-top:56.25%" class="w-video w-embed"></div>', askVideo: true },
    { id: "embed", name: "Embed", html: '<div class="w-embed"></div>' },
  ] },
];

/* ----------------------------------------------------------- cascade --
 * Which contexts feed a breakpoint, in cascade order. Desktop styles flow
 * down to tablet and phones, and up to the wide breakpoints; each breakpoint
 * can then override.
 */
const DOWN = ["base", "tablet", "landscape", "portrait"];
const UP = ["base", "lg", "xl", "xxl"];

export function contextsFor(bp) {
  const chain = DOWN.includes(bp) ? DOWN : UP;
  return chain.slice(0, chain.indexOf(bp) + 1);
}

export const bpLabel = (id) => BREAKPOINTS.find((b) => b.id === id)?.label || id;

/**
 * A property's authored value for an exact selector at a breakpoint.
 *   value    what applies (after overrides)
 *   from     breakpoint it comes from ("" when unset)
 *   here     set at this very breakpoint
 *   override comes from the CMS rather than Webflow's CSS
 */
export function authoredValue(index, design, selector, prop, bp) {
  let found = { value: "", from: "", here: false, override: false };
  for (const ctx of contextsFor(bp)) {
    for (const r of index.get(selector) || []) {
      if (r.breakpoint !== ctx) continue;
      const d = [...r.decls].reverse().find((x) => x.prop === prop);
      if (d) found = { value: d.value, from: ctx, here: ctx === bp, override: false };
    }
    const ov = design.styles?.[ctx]?.[selector]?.[prop];
    if (ov) found = { value: ov, from: ctx, here: ctx === bp, override: true };
  }
  return found;
}

/** selector -> rules with exactly that selector. */
export function selectorIndex(rules) {
  const idx = new Map();
  for (const r of rules) {
    if (!idx.has(r.selector)) idx.set(r.selector, []);
    idx.get(r.selector).push(r);
  }
  return idx;
}

/* ------------------------------------------------------ style sections -- */

export const STYLE_SECTIONS = [
  { title: "Layout", props: [
    { p: "display", kind: "select", options: ["", "block", "flex", "grid", "inline-block", "inline", "none"] },
    { p: "flex-direction", kind: "select", options: ["", "row", "column", "row-reverse", "column-reverse"], when: "flex" },
    { p: "justify-content", kind: "select", options: ["", "flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"], when: "flex|grid" },
    { p: "align-items", kind: "select", options: ["", "stretch", "flex-start", "center", "flex-end", "baseline"], when: "flex|grid" },
    { p: "flex-wrap", kind: "select", options: ["", "nowrap", "wrap"], when: "flex" },
    { p: "grid-template-columns", kind: "text", when: "grid" },
    { p: "grid-column-gap", kind: "length", when: "grid" },
    { p: "grid-row-gap", kind: "length", when: "grid" },
    { p: "gap", kind: "length", when: "flex|grid" },
  ] },
  { title: "Spacing", box: true, props: [
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
  ].map((p) => ({ p, kind: "length" })) },
  { title: "Size", props: [
    { p: "width", kind: "length" }, { p: "height", kind: "length" },
    { p: "min-width", kind: "length" }, { p: "min-height", kind: "length" },
    { p: "max-width", kind: "length" }, { p: "max-height", kind: "length" },
    { p: "overflow", kind: "select", options: ["", "visible", "hidden", "scroll", "auto"] },
    { p: "object-fit", kind: "select", options: ["", "fill", "contain", "cover", "none", "scale-down"] },
  ] },
  { title: "Position", props: [
    { p: "position", kind: "select", options: ["", "static", "relative", "absolute", "fixed", "sticky"] },
    { p: "top", kind: "length" }, { p: "right", kind: "length" }, { p: "bottom", kind: "length" }, { p: "left", kind: "length" },
    { p: "z-index", kind: "number" },
  ] },
  { title: "Typography", props: [
    { p: "font-family", kind: "font" },
    { p: "font-weight", kind: "select", options: ["", "100", "200", "300", "400", "500", "600", "700", "800", "900"] },
    { p: "font-size", kind: "length" },
    { p: "line-height", kind: "length" },
    { p: "letter-spacing", kind: "length" },
    { p: "color", kind: "color" },
    { p: "text-align", kind: "select", options: ["", "left", "center", "right", "justify"] },
    { p: "text-transform", kind: "select", options: ["", "none", "uppercase", "lowercase", "capitalize"] },
    { p: "font-style", kind: "select", options: ["", "normal", "italic"] },
    { p: "text-decoration", kind: "select", options: ["", "none", "underline", "line-through"] },
    { p: "white-space", kind: "select", options: ["", "normal", "nowrap", "pre-wrap"] },
  ] },
  { title: "Backgrounds", props: [
    { p: "background-color", kind: "color" },
    { p: "background-image", kind: "text" },
    { p: "background-size", kind: "select", options: ["", "auto", "cover", "contain"] },
    { p: "background-position", kind: "text" },
  ] },
  { title: "Borders", props: [
    { p: "border-radius", kind: "length" },
    { p: "border-width", kind: "length" },
    { p: "border-style", kind: "select", options: ["", "none", "solid", "dashed", "dotted"] },
    { p: "border-color", kind: "color" },
  ] },
  { title: "Effects", props: [
    { p: "opacity", kind: "number" },
    { p: "box-shadow", kind: "text" },
    { p: "transform", kind: "text" },
    { p: "transition", kind: "text" },
    { p: "cursor", kind: "select", options: ["", "auto", "pointer", "default", "text", "not-allowed"] },
  ] },
];
