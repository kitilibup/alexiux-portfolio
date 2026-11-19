/**
 * Generic collections (everything but Projects, which has its own renderer):
 * render an item's page from its collection template, and describe it for
 * SEO. Shared by the build and the CMS; the caller supplies the DOM.
 *
 *   makeRoot(html) -> an element holding the parsed markup
 *     build: linkedom      CMS: document.createElement
 */

import { bind } from "./binder.js?v=6600ab59";
import { serializeChildren } from "./webflow-html.js?v=6600ab59";
import { fillCard, findEl } from "./project-model.js?v=6600ab59";

/** Address of an item on the site. */
export const itemUrl = (schema, item) => `${schema.urlPrefix || `/${schema.name}/`}${item.slug}/`;

/** Field types by path, so the binder knows rich text from plain text. */
export function fieldTypes(schema) {
  const types = new Map();
  for (const f of schema.fields || []) types.set(f.name, f.type);
  return (path) => types.get(String(path).split(".")[0]) || "text";
}

/** The Work page's card markup, used wherever another collection shows projects. */
export function workCardTemplate(workPage) {
  const html = workPage?.bodyHtml || "";
  const grid = findEl(html, '<div\\b[^>]*class="[^"]*w-dyn-items[^"]*"[^>]*>');
  if (!grid) return "";
  const inner = html.slice(grid.innerStart, grid.innerEnd);
  const first = findEl(inner, '<div\\b[^>]*class="collection-item w-dyn-item"[^>]*>');
  return first ? inner.slice(first.start, first.end) : "";
}

/**
 * The page body for one item.
 *   ctx.collections   name -> published items (for references)
 *   ctx.cardTemplate  the project card markup
 */
export function renderItemBody(template, schema, item, makeRoot, ctx = {}) {
  return bindMarkup(template.body, schema, item, makeRoot, ctx);
}

/**
 * Any markup with data-cms-* bindings, filled from one item. The item knows
 * its own page ("__url"), for links to the current item.
 */
export function bindMarkup(html, schema, item, makeRoot, ctx = {}) {
  const root = makeRoot(html);
  if (item && item.slug && !item.__url && (schema.urlPrefix || schema.name === "projects")) {
    item = { ...item, __url: schema.name === "projects" ? `/project/${item.slug}/` : itemUrl(schema, item) };
  }
  const refField = new Map((schema.fields || []).filter((f) => /reference/i.test(f.type)).map((f) => [f.name, f.collection]));
  bind(root, item, {
    fieldType: fieldTypes(schema),
    // Reference fields hold slugs; lists of them become the items, in order,
    // drafts and missing ones dropped.
    resolve: (value, path) => {
      const coll = refField.get(String(path).split(".")[0]);
      if (!coll) return value;
      const pool = ctx.collections?.[coll] || [];
      const pick = (slug) => pool.find((x) => x.slug === slug && !x.draft);
      return Array.isArray(value) ? value.map(pick).filter(Boolean) : pick(value);
    },
    card: (collection, ref) => (collection === "projects" && ctx.cardTemplate ? fillCard(ctx.cardTemplate, ref) : ""),
  });
  return serializeChildren(root);
}

/** What the SEO module needs to know about an item (admin/lib/seo.js). */
export function seoRecord(schema, item) {
  const map = schema.seo || {};
  return {
    ...item,
    title: item[map.titleField || schema.titleField || "title"] ?? item.title,
    cardDescription: item[map.descriptionField] ?? "",
    thumbnail: item[map.imageField] ?? "",
    __url: itemUrl(schema, item),
    __schemaType: map.schemaType || (schema.name === "services" ? "Service" : "CreativeWork"),
  };
}

/** Rewrites /old/<slug> links to /new/<slug> in a JSON text, for these slugs only. */
export function moveLinks(text, oldPrefix, newPrefix, slugs) {
  if (!slugs.length || oldPrefix === newPrefix) return text;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc(oldPrefix)}(${slugs.map(esc).join("|")})(?=[/"'?#)\\s\\\\]|$)`, "g");
  return text.replace(re, (m, slug) => `${newPrefix}${slug}`);
}
