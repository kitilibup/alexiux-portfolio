/**
 * Dynamic content on the Designer canvas, the way Webflow shows it.
 *
 * Elements bound to collection fields (data-cms-*) show the real content of
 * an item: on a template page, the item chosen in the item picker; inside a
 * Collection List, each published item - the first one is the editable
 * template, the others are mirrors of it.
 *
 * Only the display changes. Every change is recorded and undone before the
 * page is serialized (withSource), so what is saved is the template with its
 * bindings, never the item data that was on show.
 */

import { valueAt } from "../lib/binder.js?v=6600ab59";
import { sanitizeRich, displayNumber, deliverableSlots } from "../lib/project-model.js?v=6600ab59";

const BOUND = "[data-cms-text],[data-cms-src],[data-cms-alt],[data-cms-href],[data-cms-bg],[data-cms-if],[data-cms-if-not]";

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) ||
  (typeof v === "string" && !v.replace(/<[^>]+>|[\s‍]/g, "") && !/<(img|iframe)/i.test(v));
const safeUrl = (v) => (/^\s*(javascript|vbscript|data):/i.test(String(v)) ? "#" : String(v));

/** Undo log: everything the display changed, newest last. */
function journal(D) { return (D.__bindJournal ||= []); }

function setAttr(D, n, name, value) {
  journal(D).push({ n, kind: "attr", name, prev: n.getAttribute(name) });
  if (value == null) n.removeAttribute(name); else n.setAttribute(name, value);
}
function setHtml(D, n, html) {
  journal(D).push({ n, kind: "html", prev: n.innerHTML });
  n.innerHTML = html;
}
function toggleClass(D, n, cls, on) {
  if (n.classList.contains(cls) === on) return;
  journal(D).push({ n, kind: "class", cls, had: !on });
  n.classList.toggle(cls, on);
}

/** The collection an element's bindings read from, and the item it shows. */
export function bindContext(D, n) {
  const list = n?.closest?.("[data-cms-collection]");
  if (list && list !== n) return { collection: list.getAttribute("data-cms-collection"), list };
  const t = D.page?.template;
  return t ? { collection: t, template: true } : null;
}

/** Fill one element's bindings from an item. */
function fill(D, n, item, collection) {
  const type = D.fieldType(collection, n.getAttribute("data-cms-text") || "");
  const text = n.getAttribute("data-cms-text");
  if (text) {
    const v = valueAt(item, text);
    if (isEmpty(v)) setAttr(D, n, "data-cms-dz-empty", "");
    else if (type === "richtext") setHtml(D, n, sanitizeRich(String(v)));
    else setHtml(D, n, String(Array.isArray(v) ? v.join(", ") : v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]));
  }
  const src = n.getAttribute("data-cms-src");
  if (src) {
    const v = valueAt(item, src);
    if (!isEmpty(v)) {
      setAttr(D, n, "src", D.assetUrl(String(v)));
      setAttr(D, n, "srcset", null);
      setAttr(D, n, "sizes", null);
    }
  }
  const alt = n.getAttribute("data-cms-alt");
  if (alt) setAttr(D, n, "alt", String(valueAt(item, alt) ?? ""));
  const href = n.getAttribute("data-cms-href");
  if (href) {
    const v = valueAt(item, href);
    if (!isEmpty(v)) setAttr(D, n, "href", safeUrl(v));
  }
  const bg = n.getAttribute("data-cms-bg");
  if (bg) {
    const v = valueAt(item, bg);
    if (!isEmpty(v)) {
      journal(D).push({ n, kind: "attr", name: "style", prev: n.getAttribute("style") });
      n.style.backgroundImage = `url("${D.assetUrl(String(v)).replace(/"/g, "%22")}")`;
    }
  }
  const showIf = n.getAttribute("data-cms-if");
  if (showIf) toggleClass(D, n, "w-condition-invisible", isEmpty(valueAt(item, showIf)));
  const hideIf = n.getAttribute("data-cms-if-not");
  if (hideIf) toggleClass(D, n, "w-condition-invisible", !isEmpty(valueAt(item, hideIf)));
}

/** Fill every bound element under root whose context is `list` (or the page). */
function fillTree(D, root, item, collection, list) {
  const nodes = [root, ...root.querySelectorAll(BOUND)].filter((n) => n.matches?.(BOUND));
  for (const n of nodes) {
    const owner = n.closest("[data-cms-collection]");
    const own = owner === n ? n.parentElement?.closest("[data-cms-collection]") || null : owner;
    if ((own || null) !== (list || null)) continue;
    fill(D, n, item, collection);
  }
}

/** Show real items: Collection Lists everywhere, the sample item on templates. */
export function displayBindings(D) {
  if (!D.doc || D.page?.virtual) return;
  const region = D.bodyNodes().filter((x) => x.nodeType === 1);

  for (const top of region) {
    for (const list of [top, ...top.querySelectorAll("[data-cms-collection]")].filter((x) => x.matches?.("[data-cms-collection]"))) {
      if (list.closest("[data-cms-mirror]")) continue;
      const name = list.getAttribute("data-cms-collection");
      const limit = Number(list.getAttribute("data-cms-limit")) || 0;
      let items = D.collectionItems(name);
      if (limit) items = items.slice(0, limit);
      const tpl = [...list.children].find((c) => !c.hasAttribute("data-cms-mirror"));
      if (!tpl) continue;
      const pristine = tpl.cloneNode(true);
      if (items[0]) fillTree(D, tpl, items[0], name, list);
      for (const item of items.slice(1)) {
        const copy = pristine.cloneNode(true);
        copy.setAttribute("data-cms-mirror", "");
        copy.setAttribute("data-cms-ignore", "");
        journal(D).push({ n: copy, kind: "added" });
        list.append(copy);
        fillTree(D, copy, item, name, list);
      }
      // The empty state shows only when there are no items, as published.
      const empty = list.parentElement?.querySelector(`:scope > [data-cms-empty-collection="${name}"]`);
      if (empty) toggleClass(D, empty, "cms-dz-hidden", items.length > 0);
    }
  }

  const tpl = D.page?.template;
  if (tpl) {
    const item = D.sampleItem(tpl);
    if (item) for (const top of region) fillTree(D, top, item, tpl, null);
  }
  projectGrids(D, region);
}

/*
 * Project lists on pages (Home: featured projects, Work: all). The build
 * regenerates them from the Projects collection with the first card as the
 * template (src/_data/cms.js renderProjectGrid + fillCard), so the canvas
 * shows them the same way: the first card is the editable template, filled
 * with the first project, its project fields locked (they come from
 * Projects); every other project is a mirror of it. The page's other static
 * cards are hidden - the build never uses them.
 */
const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const CARD_FIELDS = [
  [".text-project-description", "Number", (p) => esc(displayNumber(p))],
  [".text-divider", "Year", (p) => esc(p.year)],
  ["h3.case-heading", "Title", (p) => esc(p.title || p.slug)],
  ["p.case-grid-description", "Card description", (p) => esc(p.cardDescription)],
  [".list-container.deliverables-container", "Deliverables", (p) => deliverableSlots(p.deliverables)],
  [".cast-category", "Category", (p) => esc(p.category)],
];
function fillProjectCard(D, card, p, lock) {
  for (const [sel, label, value] of CARD_FIELDS) {
    const el = card.querySelector(sel);
    if (!el) continue;
    if (lock) {
      setAttr(D, el, "data-cms-marker", label);
      setAttr(D, el, "data-cms-label", label);
      setAttr(D, el, "data-cms-from", "projects");
    }
    setHtml(D, el, value(p));
  }
  const img = card.querySelector("img.project-thumbnail");
  if (img) {
    if (lock) { setAttr(D, img, "data-cms-marker", "Thumbnail"); setAttr(D, img, "data-cms-label", "Thumbnail"); setAttr(D, img, "data-cms-from", "projects"); }
    if (p.thumbnail) setAttr(D, img, "src", D.assetUrl(p.thumbnail));
    setAttr(D, img, "srcset", null);
    setAttr(D, img, "sizes", null);
  }
  for (const a of card.querySelectorAll('a[href^="/project/"]')) setAttr(D, a, "href", `/project/${p.slug}`);
}
function projectGrids(D, region) {
  const which = D.page?.projectList;
  if (!which || !D.collectionItems) return;
  let items = D.collectionItems("projects");
  if (which === "featured") items = items.filter((p) => p.featured);
  for (const top of region) {
    for (const grid of [top, ...top.querySelectorAll(".w-dyn-items")].filter((x) => x.matches?.(".w-dyn-items"))) {
      const cards = [...grid.children].filter((c) => c.matches(".collection-item.w-dyn-item") && !c.hasAttribute("data-cms-mirror"));
      if (!cards.length) continue;
      const first = cards[0];
      const pristine = first.cloneNode(true);
      for (const c of cards.slice(1)) { setAttr(D, c, "style", "display:none"); setAttr(D, c, "data-cms-ignore", ""); }
      if (!items.length) continue;
      fillProjectCard(D, first, items[0], true);
      for (const p of items.slice(1)) {
        const copy = pristine.cloneNode(true);
        copy.setAttribute("data-cms-mirror", "");
        copy.setAttribute("data-cms-ignore", "");
        journal(D).push({ n: copy, kind: "added" });
        grid.append(copy);
        fillProjectCard(D, copy, p, false);
      }
    }
  }
}

/** Put back everything the display changed. */
export function clearBindings(D) {
  const log = journal(D);
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.kind === "added") e.n.remove();
    else if (e.kind === "html") e.n.innerHTML = e.prev;
    else if (e.kind === "class") e.n.classList.toggle(e.cls, e.had);
    else if (e.prev == null) e.n.removeAttribute(e.name);
    else e.n.setAttribute(e.name, e.prev);
  }
  log.length = 0;
}

/** Run fn on the template as stored (bindings, no item data), then show items again. */
export function withSource(D, fn) {
  clearBindings(D);
  try { return fn(); } finally { displayBindings(D); }
}

/** A Collection List mirror maps a click to the same spot in the editable first item. */
export function mirrorTarget(n) {
  const mirror = n?.closest?.("[data-cms-mirror]");
  if (!mirror) return null;
  const tpl = [...mirror.parentElement.children].find((c) => !c.hasAttribute("data-cms-mirror"));
  if (!tpl) return null;
  const path = [];
  for (let x = n; x !== mirror; x = x.parentElement) path.unshift([...x.parentElement.children].indexOf(x));
  return path.reduce((x, i) => x?.children[i], tpl) || tpl;
}
