/**
 * Collection template bindings - Webflow's dynamic content, as attributes.
 *
 * A collection template page is ordinary page markup in which elements say
 * which field they show. The attributes are what the Designer edits, and they
 * never reach the published page (the serializer drops data-cms-*).
 *
 *   data-cms-text="name"            element's content = the field (text escaped;
 *                                   rich text fields as HTML)
 *   data-cms-src="image"            img src (srcset/sizes are dropped)
 *   data-cms-alt="imageAlt"         img alt
 *   data-cms-href="link"            a href
 *   data-cms-bg="image"             background-image on the style attribute
 *   data-cms-if="field"             hidden (w-condition-invisible) when empty
 *   data-cms-if-not="field"         hidden when the field has a value
 *   data-cms-list="field"           repeat the first child for each list item;
 *                                   inside it "." is the item itself, or field
 *                                   names of a referenced item
 *   data-cms-empty="field"          the "No items found" block for a list
 *                                   (hidden with w-dyn-hide while there are items)
 *   data-cms-empty-remove="field"   an empty-state block that is left out while
 *                                   there are items (Webflow's other pattern)
 *   data-cms-list-remove-empty      on a list: left out entirely when empty
 *   data-cms-srcset / -sizes="f"    responsive image candidates, if the item has them
 *   data-cms-collection="name"      Collection List: repeat the first child for each
 *                                   published item of a collection (data-cms-limit="n")
 *   data-cms-empty-collection="n"   its empty state, left out while there are items
 *   data-cms-card="collection"      replaced by that collection's card for the
 *                                   item (e.g. the Work page's project card)
 *
 * A path can index a list: deliverables.0. Empty bound text gets Webflow's
 * w-dyn-bind-empty class, the way Webflow publishes an empty field.
 *
 * Works on any DOM - the browser's, or linkedom's in the build.
 */

import { sanitizeRich } from "./project-model.js?v=6600ab59";

const ATTRS = ["data-cms-text", "data-cms-src", "data-cms-alt", "data-cms-href", "data-cms-bg", "data-cms-if", "data-cms-if-not", "data-cms-list", "data-cms-empty", "data-cms-empty-remove", "data-cms-srcset", "data-cms-sizes", "data-cms-card", "data-cms-collection", "data-cms-empty-collection"];
export const BINDING_ATTRS = ATTRS;

/** Value at a path: "name", "deliverables.2", "." (the item itself). */
export function valueAt(item, path) {
  if (path === "." || path === "") return item;
  if (path === "__url" && item && item.slug) return item.__url || (item.__collectionPrefix ? `${item.__collectionPrefix}${item.slug}/` : `/${item.slug}/`);
  return String(path).split(".").reduce((v, k) => (v == null ? undefined : v[/^\d+$/.test(k) ? Number(k) : k]), item);
}

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "string" && !v.replace(/<[^>]+>|[\s‍]/g, "") && !/<(img|iframe)/i.test(v));

/**
 * Add a state class where Webflow puts it, so bound pages match what Webflow
 * published byte for byte:
 *   w-dyn-bind-empty   before the element's own Webflow component class
 *                      ("rich-text-block-project w-dyn-bind-empty w-richtext")
 *   w-dyn-hide         before w-dyn-empty on an empty state, else last
 *                      ("empty-state w-dyn-hide w-dyn-empty", "images-grid w-dyn-items w-dyn-hide")
 *   others             last ("list-item-container w-condition-invisible")
 */
function addClass(el, cls) {
  const list = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  if (list.includes(cls)) return;
  let at = list.length;
  if (cls === "w-dyn-bind-empty") {
    const i = list.findIndex((c) => /^w-/.test(c) && !/^w-(dyn-|condition-)|^w--/.test(c));
    if (i !== -1) at = i;
  } else if (cls === "w-dyn-hide") {
    const i = list.indexOf("w-dyn-empty");
    if (i !== -1) at = i;
  }
  list.splice(at, 0, cls);
  el.setAttribute("class", list.join(" "));
}
function removeClass(el, cls) {
  const list = (el.getAttribute("class") || "").split(/\s+/).filter((c) => c && c !== cls);
  list.length ? el.setAttribute("class", list.join(" ")) : el.removeAttribute("class");
}

/**
 * Fill a template subtree from an item.
 *   ctx.fieldType(path)  -> "richtext" | other, to decide text vs HTML
 *   ctx.resolve(value, field) -> for references: slug(s) -> item(s)
 */
export function bind(root, item, ctx = {}) {
  const doc = root.ownerDocument;
  const fieldType = ctx.fieldType || (() => "text");

  // Lists first: each repeated copy is bound against its own item. A list
  // is a field of the item (data-cms-list) or a whole collection
  // (data-cms-collection - Webflow's Collection List element).
  for (const list of [...root.querySelectorAll("[data-cms-list], [data-cms-collection]")]) {
    if (!root.contains(list)) continue;
    if (list.parentElement?.closest?.("[data-cms-list], [data-cms-collection]")) continue;
    const coll = list.getAttribute("data-cms-collection");
    const path = list.getAttribute("data-cms-list") || "";
    let values;
    if (coll) {
      values = (ctx.collectionItems?.(coll) || []).slice(0, Number(list.getAttribute("data-cms-limit")) || undefined);
    } else {
      values = valueAt(item, path);
      values = ctx.resolve ? ctx.resolve(values, path) : values;
    }
    values = Array.isArray(values) ? values : [];
    for (const e of root.querySelectorAll(`[data-cms-empty-collection="${coll}"]`)) if (coll && values.length) e.remove();
    const tpl = list.firstElementChild;
    if (tpl) {
      const copies = values.map((v) => {
        const copy = tpl.cloneNode(true);
        const holder = doc.createElement("div");
        holder.appendChild(copy);
        bind(holder, v, { ...ctx, fieldType: (coll ? ctx.collectionFieldType?.(coll) : ctx.itemFieldType?.(path)) || fieldType });
        // Bound to its own item: done. Without this the outer item's pass
        // below would bind it again and blank it.
        for (const e of [holder.firstChild, ...holder.firstChild.querySelectorAll?.("*") || []]) {
          if (e?.removeAttribute) for (const a of ATTRS) e.removeAttribute(a);
        }
        return holder.firstChild;
      });
      list.replaceChildren(...copies);
    }
    list.removeAttribute("data-cms-list");
    list.removeAttribute("data-cms-collection");
    // Webflow either hides an empty list or leaves it out, per template.
    if (list.hasAttribute("data-cms-list-remove-empty")) {
      if (!values.length) { list.remove(); continue; }
    } else if (values.length) removeClass(list, "w-dyn-hide"); else addClass(list, "w-dyn-hide");
  }
  for (const empty of root.querySelectorAll("[data-cms-empty]")) {
    const has = !isEmpty(valueAt(item, empty.getAttribute("data-cms-empty")));
    if (has) addClass(empty, "w-dyn-hide"); else removeClass(empty, "w-dyn-hide");
  }
  for (const empty of root.querySelectorAll("[data-cms-empty-remove]")) {
    if (!isEmpty(valueAt(item, empty.getAttribute("data-cms-empty-remove")))) empty.remove();
  }
  // Cards of another collection, rendered by that collection's own code.
  for (const el of root.querySelectorAll("[data-cms-card]")) {
    const html = ctx.card?.(el.getAttribute("data-cms-card"), item);
    if (html == null) continue;
    const holder = doc.createElement("div");
    holder.innerHTML = html;
    el.replaceWith(...holder.childNodes);
  }

  for (const el of root.querySelectorAll("[data-cms-if], [data-cms-if-not]")) {
    const path = el.getAttribute("data-cms-if") ?? el.getAttribute("data-cms-if-not");
    const empty = isEmpty(valueAt(item, path));
    const hide = el.hasAttribute("data-cms-if") ? empty : !empty;
    if (hide) addClass(el, "w-condition-invisible"); else removeClass(el, "w-condition-invisible");
  }

  for (const el of root.querySelectorAll("[data-cms-text]")) {
    const path = el.getAttribute("data-cms-text");
    const v = valueAt(item, path);
    if (fieldType(path) === "richtext") {
      el.innerHTML = isEmpty(v) ? "" : sanitizeRich(String(v));
    } else {
      el.textContent = v == null ? "" : String(v);
    }
    if (isEmpty(v)) addClass(el, "w-dyn-bind-empty"); else removeClass(el, "w-dyn-bind-empty");
  }

  for (const el of root.querySelectorAll("[data-cms-src]")) {
    const v = valueAt(item, el.getAttribute("data-cms-src"));
    el.setAttribute("src", v ? String(v) : "");
    // Stale candidates would win over the new src - unless they're bound
    // too, in which case they're updated in place (attribute order kept).
    if (!el.hasAttribute("data-cms-srcset")) el.removeAttribute("srcset");
    if (!el.hasAttribute("data-cms-sizes")) el.removeAttribute("sizes");
    if (!v) addClass(el, "w-dyn-bind-empty"); else removeClass(el, "w-dyn-bind-empty");
  }
  for (const [attr, name] of [["data-cms-srcset", "srcset"], ["data-cms-sizes", "sizes"]]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const v = valueAt(item, el.getAttribute(attr));
      if (v) el.setAttribute(name, String(v)); else el.removeAttribute(name);
    }
  }
  for (const el of root.querySelectorAll("[data-cms-alt]")) {
    el.setAttribute("alt", String(valueAt(item, el.getAttribute("data-cms-alt")) ?? ""));
  }
  for (const el of root.querySelectorAll("[data-cms-href]")) {
    const v = valueAt(item, el.getAttribute("data-cms-href"));
    const safe = v && !/^\s*(javascript|vbscript|data):/i.test(String(v));
    el.setAttribute("href", safe ? String(v) : "#");
  }
  for (const el of root.querySelectorAll("[data-cms-bg]")) {
    const v = valueAt(item, el.getAttribute("data-cms-bg"));
    const style = (el.getAttribute("style") || "").replace(/background-image:[^;]*;?/g, "").trim();
    el.setAttribute("style", v ? `${style}${style && !style.endsWith(";") ? ";" : ""}background-image:url("${String(v).replace(/"/g, "")}")` : style);
  }
  return root;
}

/** Fields a template uses, for the Designer's binding menus and validation. */
export function boundFields(root) {
  const out = new Set();
  for (const a of ATTRS) for (const el of root.querySelectorAll(`[${a}]`)) out.add(el.getAttribute(a).split(".")[0]);
  return out;
}
