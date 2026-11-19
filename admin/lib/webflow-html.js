/**
 * Webflow rich text <-> the editor's DOM.
 *
 * The browser's own serializer (innerHTML) rewrites markup it didn't touch:
 * <img/> becomes <img>, &#x27; becomes ', &quot; in text becomes ". Saving an
 * unchanged project would then rewrite every image tag and every apostrophe.
 * This serializer writes exactly what Webflow writes, so a field that wasn't
 * edited comes back byte-identical, and an edit changes only what was edited.
 *
 * normalizeRich() is the other half: it brings what contenteditable produces
 * (<b>, <div>, stray <span style>, placeholder <br>) into Webflow's rich-text
 * vocabulary before saving. It never changes markup that is already valid,
 * which is what the round-trip test (tools/test-cms) checks against every
 * rich-text field on the site.
 */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Webflow's blank line: a paragraph holding a zero-width joiner. */
export const ZWJ = "‍";

/* ------------------------------------------------------------ serialize -- */

/** Attributes only the editors use; never saved. */
const EDITOR_DATA = new Set(["data-cms-local-src", "data-cms-dim", "data-cms-ignore", "data-cms-locked", "data-cms-component", "data-cms-label", "data-cms-preview", "data-cms-attrs", "data-cms-marker"]);
const editorOnly = (name, keepBindings) =>
  name === "contenteditable" || name === "spellcheck" || name === "draggable" ||
  (name.startsWith("data-cms") && (!keepBindings || EDITOR_DATA.has(name)));

/**
 * keepBindings: keep data-cms-* binding attributes (templates and pages are
 * saved with their bindings; the build drops them from the published page).
 */
let keepBindings = false;
export function serializeWithBindings(fn) {
  const was = keepBindings;
  keepBindings = true;
  try { return fn(); } finally { keepBindings = was; }
}

function serializeAttrs(el) {
  let out = "";
  // An image shown from the browser's copy of a fresh upload (dom.js
  // showLocalCopies) is saved with its real address.
  const real = el.getAttribute("data-cms-local-src");
  for (const a of el.attributes) {
    if (editorOnly(a.name, keepBindings)) continue;
    let v = a.name === "src" && real != null ? real : a.value;
    // A browser-only address would be a dead link on the site.
    if (/^blob:/i.test(v) && (a.name === "src" || a.name === "href")) continue;
    if (a.name === "class") {
      const kept = v.split(/\s+/).filter((c) => c && !c.startsWith("cms-"));
      // Drop the attribute only if the editor is what put it there.
      if (!kept.length && /(^|\s)cms-/.test(v)) continue;
      if (kept.length !== v.split(/\s+/).filter(Boolean).length) v = kept.join(" ");
    }
    out += ` ${a.name}="${esc(v)}"`;
  }
  return out;
}

export function serializeNode(node) {
  if (node.nodeType === 3) return esc(node.data);
  if (node.nodeType !== 1) return "";
  if (node.hasAttribute("data-cms-ignore")) return "";
  // A collection template's field shown with sample content in the Designer:
  // it is saved as the marker it stands for, never as the sample.
  if (node.hasAttribute("data-cms-marker")) return `{{=${node.getAttribute("data-cms-marker")}}}`;
  const tag = node.tagName.toLowerCase();
  let attrs = serializeAttrs(node);
  // Attributes that hold a field (src="{{=heroImage}}") go back to their marker.
  const mapped = node.getAttribute("data-cms-attrs");
  if (mapped) {
    for (const pair of mapped.split(",")) {
      const [attr, field] = pair.split(":");
      attrs = attrs.replace(new RegExp(`( ${attr}=")[^"]*(")`), `$1{{=${field}}}$2`);
    }
  }
  if (VOID.has(tag)) return `<${tag}${attrs}/>`;
  // Template contents and raw-text elements are serialized as they were.
  if (tag === "script" || tag === "style") return `<${tag}${attrs}>${node.textContent}</${tag}>`;
  return `<${tag}${attrs}>${serializeChildren(node)}</${tag}>`;
}

export function serializeChildren(node) {
  let out = "";
  for (const child of node.childNodes) out += serializeNode(child);
  return out;
}

/* ------------------------------------------------------------ normalize -- */

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "figure"]);
const TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);
const INLINE_KEEP = new Set(["strong", "em", "a", "br", "sup", "sub", "code"]);
const RENAME = { b: "strong", i: "em" };
const DROP = new Set(["script", "style", "meta", "link", "title", "template", "noscript", "object"]);

const hasText = (el) => el.textContent.replace(/[\s‍ ]/g, "") !== "";
const hasMedia = (el) => !!el.querySelector?.("img,iframe,video");

function rename(el, tag) {
  const doc = el.ownerDocument;
  const out = doc.createElement(tag);
  for (const a of el.attributes) out.setAttribute(a.name, a.value);
  while (el.firstChild) out.appendChild(el.firstChild);
  el.replaceWith(out);
  return out;
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

/** Inline content: keep the allowed tags, unwrap everything else. */
function cleanInline(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) { child.remove(); continue; }
    if (child.nodeType !== 1) continue;
    let el = child;
    let tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) { el.remove(); continue; }
    if (RENAME[tag]) { el = rename(el, RENAME[tag]); tag = RENAME[tag]; }
    cleanInline(el);
    if (!INLINE_KEEP.has(tag)) { unwrap(el); continue; }
    // Formatting attributes from contenteditable or a paste never survive.
    el.removeAttribute("style");
    if (tag !== "a") el.removeAttribute("class");
    if (tag !== "br" && !el.childNodes.length) el.remove();
  }
}

/** Collapse a block's content to Webflow's form. */
function finishTextBlock(el) {
  cleanInline(el);
  el.removeAttribute("style");
  // A <br> closing a block is contenteditable's caret placeholder.
  while (el.lastChild?.nodeName === "BR" && el.childNodes.length > 1) el.lastChild.remove();
  if (!hasText(el) && !hasMedia(el)) {
    el.replaceChildren(el.ownerDocument.createTextNode(ZWJ));
    return;
  }
  // A blank line that has been typed into is no longer blank.
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.data.includes(ZWJ)) t.data = t.data.replaceAll(ZWJ, "");
  }
}

function normalizeList(list) {
  for (const child of [...list.childNodes]) {
    if (child.nodeType === 3) {
      if (child.data.trim()) {
        const li = list.ownerDocument.createElement("li");
        child.replaceWith(li);
        li.appendChild(child);
      } else child.remove();
      continue;
    }
    if (child.nodeType !== 1) { child.remove(); continue; }
    let tag = child.tagName.toLowerCase();
    let li = child;
    if (tag !== "li") { li = list.ownerDocument.createElement("li"); child.replaceWith(li); li.appendChild(child); }
    // <li><p>x</p></li> from pasting: the paragraph is dropped, its text kept.
    for (const inner of [...li.children]) {
      const t = inner.tagName.toLowerCase();
      if (t === "ul" || t === "ol") normalizeList(inner);
      else if (TEXT_BLOCKS.has(t) || t === "div") unwrap(inner);
    }
    for (const n of [...li.childNodes]) {
      if (n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL")) continue;
      if (n.nodeType === 1) {
        const wrapper = li.ownerDocument.createElement("span");
        n.replaceWith(wrapper); wrapper.appendChild(n); cleanInline(wrapper); unwrap(wrapper);
      }
    }
    li.removeAttribute("style");
    while (li.lastChild?.nodeName === "BR" && li.childNodes.length > 1) li.lastChild.remove();
    if (!hasText(li) && !li.querySelector("ul,ol")) li.remove();
  }
  list.removeAttribute("style");
  if (!list.children.length) list.remove();
}

/**
 * Bring a rich-text root into Webflow's vocabulary, in place.
 *
 * Top level: p, h1-h6, blockquote, ul/ol, figure. Inline: strong, em, a, br,
 * sup, sub, code. Anything else is converted or unwrapped; nothing with text
 * in it is ever dropped.
 */
export function normalizeRich(root) {
  const doc = root.ownerDocument;
  let inlineRun = null;
  const runs = [];

  for (const child of [...root.childNodes]) {
    const isEl = child.nodeType === 1;
    const tag = isEl ? child.tagName.toLowerCase() : null;

    if (child.nodeType === 8 || (isEl && DROP.has(tag))) { child.remove(); continue; }

    if (isEl && (BLOCKS.has(tag) || tag === "div")) {
      inlineRun = null;
      if (tag === "figure") {
        for (const cap of child.querySelectorAll("figcaption")) {
          if (!hasText(cap)) cap.remove();
          else { cleanInline(cap); cap.removeAttribute("style"); }
        }
        if (!child.querySelector("img,iframe")) child.remove();
        continue;
      }
      if (tag === "ul" || tag === "ol") { normalizeList(child); continue; }
      if (tag === "div") {
        // A div holding blocks is a wrapper; one holding text is a paragraph.
        if ([...child.children].some((c) => BLOCKS.has(c.tagName.toLowerCase()) || c.tagName === "DIV")) {
          const kids = [...child.childNodes];
          child.replaceWith(...kids);
          // Re-run over what was just lifted to the top level.
          return normalizeRich(root);
        }
        finishTextBlock(rename(child, "p"));
        continue;
      }
      finishTextBlock(child);
      continue;
    }

    // Loose text and inline elements are gathered into a paragraph.
    if (child.nodeType === 3 && !child.data.trim() && !inlineRun) { child.remove(); continue; }
    if (!inlineRun) {
      inlineRun = doc.createElement("p");
      runs.push(inlineRun);
      root.insertBefore(inlineRun, child);
    }
    inlineRun.appendChild(child);
    if (child.nodeName === "BR" && inlineRun.childNodes.length === 1) {
      // A bare <br> between blocks is an empty line.
      inlineRun = null;
    }
  }
  for (const p of runs) finishTextBlock(p);
  return root;
}

/** Serialize a rich-text root as stored: normalized, editor bits removed. */
export function richValue(root) {
  const clone = root.cloneNode(true);
  normalizeRich(clone);
  const html = serializeChildren(clone);
  // An editor with nothing in it is an empty field, not a blank line.
  return clone.textContent.replace(/[\s‍ ]/g, "") || clone.querySelector("img,iframe")
    ? html : "";
}

/* ---------------------------------------------------------------- paste -- */

/**
 * Turn pasted HTML (Google Docs, Word, another website) into clean rich text:
 * structure kept - paragraphs, headings, lists, quotes, links, bold, italic -
 * fonts, colours, classes and layout thrown away.
 */
export function cleanPastedHtml(html, doc) {
  const tmp = doc.createElement("div");
  tmp.innerHTML = html;
  // Google Docs wraps everything in <b style="font-weight:normal">.
  for (const b of tmp.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]')) unwrap(b);
  // Bold/italic expressed as CSS become real tags before styles are stripped.
  for (const span of tmp.querySelectorAll("span[style]")) {
    const s = span.getAttribute("style");
    let wrapped = span;
    if (/font-weight:\s*(bold|[6-9]00)/.test(s)) wrapped = rename(wrapped, "strong");
    else if (/font-style:\s*italic/.test(s)) wrapped = rename(wrapped, "em");
  }
  for (const h of tmp.querySelectorAll("h1")) rename(h, "h2");
  for (const el of tmp.querySelectorAll("section,article,header,footer,main,aside,td,th,dd,dt,pre")) rename(el, "div");
  for (const el of tmp.querySelectorAll("table,tbody,thead,tr,dl")) unwrap(el);
  for (const img of tmp.querySelectorAll("img,picture,svg,video,iframe,figure")) img.remove();
  for (const a of tmp.querySelectorAll("a")) {
    const href = a.getAttribute("href") || "";
    for (const attr of [...a.attributes]) a.removeAttribute(attr.name);
    if (!href || /^javascript:/i.test(href)) { unwrap(a); continue; }
    a.setAttribute("href", href);
    if (/^https?:\/\//i.test(href)) a.setAttribute("target", "_blank");
  }
  for (const el of tmp.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) if (attr.name !== "href" && attr.name !== "target") el.removeAttribute(attr.name);
  }
  normalizeRich(tmp);
  return serializeChildren(tmp);
}

/** Plain text pasted: blank lines separate paragraphs, single newlines break. */
export function textToParagraphs(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/* ------------------------------------------------------------- caret -- */

/** Caret as a character offset from the start of root, so it survives a re-render. */
export function caretOffset(root) {
  const sel = root.ownerDocument.getSelection();
  if (!sel?.rangeCount || !root.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(sel.anchorNode, sel.anchorOffset);
  return range.toString().length;
}

export function setCaretOffset(root, offset) {
  if (offset == null) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  let left = offset;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (left <= t.data.length) {
      const r = doc.createRange();
      r.setStart(t, left);
      r.collapse(true);
      const sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    left -= t.data.length;
  }
}
