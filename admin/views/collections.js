/**
 * Collections - Webflow's CMS panel: every collection, a new collection,
 * and each collection's fields (Collection settings).
 *
 * A collection is a schema (content/_schema/<name>.json), a folder of items
 * (content/<name>/), and - for collections with their own pages - a
 * template page (content/_templates/<name>.json) laid out in the Designer.
 */

import { el, toast, modal, confirmDialog, slugify, clone, stripInternal } from "../lib/dom.js?v=6600ab59";
import { store, commit, pageLabel, serializeRecord } from "../store.js?v=6600ab59";
import { moveLinks } from "../lib/collections.js?v=6600ab59";

/** Where a collection field is bound: its template page and Collection Lists on pages. */
export function fieldShownOn(collection, field) {
  const attr = new RegExp(`data-cms-(?:text|src|alt|href|bg|if|if-not)="${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.[^"]*)?"`, "g");
  const count = (html) => (String(html || "").match(attr) || []).length;
  const out = [];
  const sc = store.schemas[collection];
  const tpl = collection === "projects" ? store.template : store.templates[collection];
  const n = tpl ? count(tpl.body) : 0;
  if (n) out.push(`the ${sc?.label || collection} template${n > 1 ? ` (${n} spots)` : ""}`);
  for (const p of store.items.pages || []) {
    const html = String(p.bodyHtml || "");
    if (!html.includes(`data-cms-collection="${collection}"`)) continue;
    const k = count(html);
    if (k) out.push(`${pageLabel(p)}${k > 1 ? ` (${k} spots)` : ""}`);
  }
  return out;
}

/** What already uses an address at the site root, or null if it's free. */
export function takenAddress(prefix) {
  const system = { admin: "the CMS", assets: "the site's files", project: "where projects live", "404": "the Not Found page", index: "the home page" };
  if (system[prefix]) return system[prefix];
  const page = (store.items.pages || []).find((p) => p.slug === prefix);
  if (page) return `the ${pageLabel(page)} page's address`;
  for (const [name, sc] of Object.entries(store.schemas)) {
    if (sc.urlPrefix && sc.urlPrefix.replace(/^\/|\/$/g, "") === prefix) return `where ${sc.label || name} live`;
  }
  return null;
}

/** Webflow's field types and how this CMS stores them. */
export const FIELD_TYPES = [
  ["text", "Plain text"], ["textarea", "Plain text (multi-line)"], ["richtext", "Rich text"], ["image", "Image"], ["gallery", "Multi-image"],
  ["video", "Video link"], ["url", "Link"], ["email", "Email"], ["phone", "Phone"], ["number", "Number"], ["date", "Date"],
  ["toggle", "Switch"], ["color", "Color"], ["select", "Option"], ["reference", "Reference"], ["multiReference", "Multi-reference"],
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const SYSTEM = new Set(["slug", "draft", "order", "title", "name"]);

const camel = (label) => slugify(label).replace(/-([a-z0-9])/g, (m, c) => c.toUpperCase()) || "field";

export function collectionsView({ go }) {
  const names = store.collectionNames.filter((n) => store.schemas[n].kind !== "singleton" && n !== "pages");
  const page = el("div", { className: "page" });
  page.append(
    el("header", { className: "page-head" },
      el("div", {}, el("h1", {}, "Collections"), el("p", { className: "muted" }, "Structured content: each collection has fields, items, and a template page that lays out every item.")),
      el("div", { className: "actions" }, el("button", { className: "btn primary", onclick: () => newCollection(go) }, "New collection"))),
    el("table", { className: "table" },
      el("thead", {}, el("tr", {}, el("th", {}, "Collection"), el("th", {}, "Items"), el("th", {}, "Pages at"), el("th", {}, "Fields"), el("th", {}))),
      el("tbody", {}, ...names.map((n) => {
        const sc = store.schemas[n];
        const items = store.items[n] || [];
        const live = items.filter((r) => !r.draft).length;
        return el("tr", {},
          el("td", {}, el("a", { className: "strong", href: `#/${n}`, onclick: (e) => { e.preventDefault(); go({ name: n }); } }, sc.label),
            el("div", { className: "muted" }, sc.singular)),
          el("td", { className: "muted" }, `${items.length} (${live} published)`),
          el("td", {}, el("code", {}, n === "projects" ? "/project/…" : sc.urlPrefix ? `${sc.urlPrefix}…` : "no pages")),
          el("td", { className: "muted" }, String(sc.fields.filter((f) => !f.name.startsWith("__") && !f.name.includes(".")).length)),
          el("td", { className: "row-actions" },
            el("button", { className: "link", onclick: () => go({ name: n }) }, "Items"),
            el("button", { className: "link", onclick: () => editFields(n, go) }, "Fields"),
            el("button", { className: "link", onclick: () => collectionSettings(n) }, "Settings"),
            sc.template || n === "projects" ? el("button", { className: "link", onclick: () => go({ name: "designer", slug: `__template-${n}` }) }, "Template") : null,
            CORE_COLLECTIONS.has(n) ? null : el("button", { className: "link danger", onclick: () => deleteCollection(n) }, "Delete")));
      }))));
  return page;
}

/* ---------------------------------------------------- collection settings --
 * Rename a collection and move its item pages to a new address. Moving
 * rewrites every link to its items across the site's content in the same
 * commit, and the old addresses keep working as redirects.
 */

async function collectionSettings(name) {
  const sc = store.schemas[name];
  const fixedAddress = name === "projects" || !sc.urlPrefix;
  const label = el("input", { type: "text", value: sc.label });
  const singular = el("input", { type: "text", value: sc.singular || "" });
  const current = (sc.urlPrefix || "").replace(/^\/|\/$/g, "");
  const url = el("input", { type: "text", value: current, disabled: fixedAddress });
  const items = store.items[name] || [];
  const r = await modal({
    title: `${sc.label} settings`,
    body: el("div", { className: "fields" },
      el("div", { className: "field" }, el("label", { className: "field-label" }, "Collection name"), label),
      el("div", { className: "field" }, el("label", { className: "field-label" }, "Item name (singular)"), singular),
      el("div", { className: "field" }, el("label", { className: "field-label" }, "Address of item pages"),
        el("div", { className: "slug-field" }, el("span", { className: "slug-prefix" }, "/"), url, el("span", { className: "slug-prefix" }, "/item-slug/")),
        el("p", { className: "hint" }, fixedAddress
          ? (name === "projects" ? "Project pages are always at /project/\u2026 \u2014 the site is built around it." : "This collection has no item pages.")
          : `Changing it moves all ${items.length} item page${items.length === 1 ? "" : "s"}, updates every link to them, and keeps the old addresses working as redirects.`))),
    actions: [{ label: "Cancel", value: null }, { label: "Save", primary: true, onClick: () => {
      if (!label.value.trim() || !singular.value.trim()) { toast("Name the collection and its items.", "error"); return undefined; }
      const prefix = slugify(url.value);
      if (!fixedAddress && prefix !== current) {
        if (!prefix) { toast("Give the item pages an address.", "error"); return undefined; }
        const taken = takenAddress(prefix);
        if (taken) { toast(`/${prefix}/ is already ${taken} \u2014 choose another address.`, "error"); return undefined; }
      }
      return { label: label.value.trim(), singular: singular.value.trim(), prefix: fixedAddress ? current : prefix };
    } }],
  });
  if (!r) return;
  const moved = !fixedAddress && r.prefix !== current;
  const schemaFile = `content/_schema/${name}.json`;
  const next = { ...stripInternal(sc), label: r.label, singular: r.singular };
  delete next.name;
  const changes = [];
  if (moved) {
    const oldPrefix = `/${current}/`, newPrefix = `/${r.prefix}/`;
    next.urlPrefix = newPrefix;
    next.previousUrlPrefixes = [...new Set([...(sc.previousUrlPrefixes || []), oldPrefix])].filter((x) => x !== newPrefix);
    next.fields = sc.fields.map((f) => (f.type === "slug" ? { ...f, prefix: newPrefix } : f));
    const slugs = items.map((x) => x.slug).filter(Boolean);
    const rewrite = (obj) => { const a = JSON.stringify(stripInternal(obj)); const b = moveLinks(a, oldPrefix, newPrefix, slugs); return a === b ? null : JSON.parse(b); };
    // Content that can link to an item: every record of every collection, components, templates.
    for (const c of store.collectionNames) {
      for (const rec of store.items[c] || []) {
        if (!rec.__path) continue;
        const out = rewrite(rec);
        if (out) changes.push({ path: rec.__path, content: store.schemas[c]?.kind === "singleton" ? JSON.stringify(out, null, 2) + "\n" : serializeRecord(c, out) });
      }
    }
    for (const comp of Object.values(store.components || {})) {
      const out = comp.__path && rewrite(comp);
      if (out) changes.push({ path: comp.__path, content: JSON.stringify(out, null, 2) + "\n" });
    }
    const tpls = [["content/_templates/project.json", store.template], ...Object.entries(store.templates || {}).map(([n, t]) => [store.schemas[n]?.template, t])];
    for (const [file, t] of tpls) {
      const out = file && t && rewrite(t);
      if (out) changes.push({ path: file, content: JSON.stringify(out, null, 2) + "\n" });
    }
  }
  changes.unshift({ path: schemaFile, content: JSON.stringify(next, null, 2) + "\n" });
  try {
    await commit(changes, moved ? `CMS: move ${r.label} to /${r.prefix}/` : `CMS: rename ${r.label}`);
    toast(moved ? `${r.label} moved to /${r.prefix}/ \u2014 ${changes.length - 1} file${changes.length === 2 ? "" : "s"} with links updated.` : `${r.label} saved.`);
    location.reload();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ------------------------------------------------------ delete collection -- */

// The site is built around these; they can't be deleted from the CMS.
const CORE_COLLECTIONS = new Set(["projects", "pages"]);

/** Pages, templates and components that list a collection, and collections that reference it. */
export function collectionUsage(name) {
  const lists = [];
  const tag = `data-cms-collection="${name}"`;
  for (const p of store.items.pages || []) if (String(p.bodyHtml || "").includes(tag)) lists.push(pageLabel(p));
  if (String(store.template?.body || "").includes(tag)) lists.push("the Projects template");
  for (const [n, t] of Object.entries(store.templates || {})) if (n !== name && String(t?.body || "").includes(tag)) lists.push(`the ${store.schemas[n]?.label || n} template`);
  for (const c of Object.values(store.components || {})) if (String(c.html || "").includes(tag)) lists.push(`the ${c.label || "component"}`);
  const refs = [];
  for (const [n, sc] of Object.entries(store.schemas)) {
    if (n === name) continue;
    for (const f of sc.fields || []) if ((f.type === "reference" || f.type === "multiReference") && f.collection === name) refs.push(`${sc.label} \u203a ${f.label}`);
  }
  return { lists, refs };
}

async function deleteCollection(name) {
  const sc = store.schemas[name];
  const items = store.items[name] || [];
  const { lists, refs } = collectionUsage(name);
  if (lists.length || refs.length) {
    // Removing it from under a page would leave a broken list there: say what to change first.
    await modal({
      title: `${sc.label} is still in use`,
      body: el("div", { className: "fields" },
        lists.length ? el("p", {}, `A Collection List shows it on ${lists.join(", ")}. Remove that list in the Designer first.`) : null,
        refs.length ? el("p", {}, `These fields point to it: ${refs.join(", ")}. Delete or change them under Fields first.`) : null),
      actions: [{ label: "OK", primary: true, value: true }],
    });
    return;
  }
  const confirm = el("input", { type: "text", placeholder: sc.label, autocomplete: "off", spellcheck: false });
  const ok = await modal({
    title: `Delete ${sc.label}?`,
    body: el("div", { className: "fields" },
      el("p", {}, `This removes the collection, its ${items.length} item${items.length === 1 ? "" : "s"}${sc.template ? `, their pages at ${sc.urlPrefix}\u2026` : ""}${sc.template ? " and the template page" : ""}. It can't be undone from the CMS (the files stay in the site's history on GitHub).`),
      el("div", { className: "field" }, el("label", { className: "field-label" }, `Type ${sc.label} to confirm`), confirm)),
    actions: [{ label: "Cancel", value: null }, { label: "Delete collection", danger: true, onClick: () => {
      if (confirm.value.trim() !== sc.label) { toast(`Type "${sc.label}" exactly to delete it.`, "error"); return undefined; }
      return true;
    } }],
  });
  if (!ok) return;
  const changes = [{ path: `content/_schema/${name}.json`, content: null }, ...items.filter((r) => r.__path).map((r) => ({ path: r.__path, content: null }))];
  if (sc.template) changes.push({ path: sc.template, content: null });
  try {
    await commit(changes, `CMS: delete collection ${sc.label}`);
    toast(`${sc.label} deleted.`);
    location.hash = "#/collections";
    location.reload();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* --------------------------------------------------------- new collection -- */

async function newCollection(go) {
  const plural = el("input", { type: "text", placeholder: "e.g. Testimonials", autofocus: true });
  const singular = el("input", { type: "text", placeholder: "e.g. Testimonial" });
  const url = el("input", { type: "text", placeholder: "testimonial" });
  const pages = el("input", { type: "checkbox", checked: true });
  plural.oninput = () => {
    if (!singular.dataset.touched) singular.value = plural.value.replace(/ies$/i, "y").replace(/s$/i, "");
    if (!url.dataset.touched) url.value = slugify(singular.value);
  };
  singular.oninput = () => { singular.dataset.touched = "1"; if (!url.dataset.touched) url.value = slugify(singular.value); };
  url.oninput = () => { url.dataset.touched = "1"; };
  const r = await modal({
    title: "New collection",
    body: el("div", { className: "fields" },
      el("div", { className: "field" }, el("label", { className: "field-label" }, "Collection name"), plural),
      el("div", { className: "field" }, el("label", { className: "field-label" }, "Item name (singular)"), singular),
      el("div", { className: "field" }, el("label", { className: "toggle" }, pages, el("span", {}, "Each item gets its own page (a Collection template)"))),
      el("div", { className: "field" }, el("label", { className: "field-label" }, "Address of item pages"), el("div", { className: "slug-field" }, el("span", { className: "slug-prefix" }, "/"), url, el("span", { className: "slug-prefix" }, "/item-slug/"))),
      el("p", { className: "hint" }, "It starts with Name and Slug. Add more fields next, then lay out the template page in the Designer.")),
    actions: [{ label: "Cancel", value: null }, { label: "Create collection", primary: true, onClick: () => {
      const name = slugify(plural.value);
      if (!name || !singular.value.trim()) { toast("Name the collection and its items.", "error"); return undefined; }
      if (store.schemas[name] || ["pages", "media", "designer", "collections", "settings", "seo", "admin", "assets", "project"].includes(name)) { toast(`"${name}" is taken.`, "error"); return undefined; }
      const prefix = slugify(url.value);
      if (pages.checked) {
        if (!prefix) { toast("Give the item pages an address.", "error"); return undefined; }
        const taken = takenAddress(prefix);
        if (taken) { toast(`/${prefix}/ is already ${taken} \u2014 choose another address.`, "error"); return undefined; }
      }
      return { name, label: plural.value.trim(), singular: singular.value.trim(), prefix, pages: pages.checked };
    } }],
  });
  if (!r) return;

  const schema = {
    label: r.label, singular: r.singular, kind: "collection", folder: `content/${r.name}`,
    ...(r.pages ? { template: `content/_templates/${r.name}.json`, urlPrefix: `/${r.prefix}/` } : {}),
    sortBy: "order", titleField: "name", reorderable: true, stampUpdated: true,
    seo: { titleField: "name", descriptionField: "summary", imageField: "image" },
    groups: ["Content", "SEO"],
    keyOrder: ["name", "slug", "order", "draft"],
    fields: [
      { name: "name", label: "Name", type: "text", required: true, group: "Content" },
      { name: "slug", label: "Slug", type: "slug", sourceField: "name", prefix: r.pages ? `/${r.prefix}/` : "", required: true, group: "Content" },
      { name: "draft", label: "Status", type: "toggle", toggleLabel: "Draft — not on the site", group: "Content" },
      { name: "seo.title", label: "Browser tab title", type: "text", omitEmpty: true, group: "SEO" },
      { name: "seo.description", label: "Meta description", type: "textarea", omitEmpty: true, group: "SEO" },
      { name: "seo.noindex", label: "Search engines", type: "toggle", toggleLabel: "Hide this page from search engines", group: "SEO" },
    ],
  };
  const changes = [{ path: `content/_schema/${r.name}.json`, content: JSON.stringify(schema, null, 2) + "\n" }];
  if (r.pages) {
    // The new template page starts from the Services template's shell (head,
    // navbar, footer, scripts) and a simple bound layout, ready for the Designer.
    const base = store.templates.services || Object.values(store.templates).find(Boolean);
    const shell = clone(base?.shell || store.template.shell);
    const tpl = {
      _comment: [`The ${r.label} template page. Elements show fields through data-cms-* bindings (admin/lib/binder.js). Lay it out in the Designer.`],
      shell,
      body: `<div class="section"><div class="container"><h1 class="case-heading" data-cms-text="name">${r.singular} name</h1></div></div>`,
    };
    changes.push({ path: `content/_templates/${r.name}.json`, content: JSON.stringify(tpl, null, 2) + "\n" });
  }
  try {
    await commit(changes, `CMS: new collection ${r.label}`);
    toast(`${r.label} created. Add fields, then items.`);
    location.reload();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* -------------------------------------------------------- field editor -- */

async function editFields(name, go) {
  const schema = clone(Object.fromEntries(Object.entries(store.schemas[name]).filter(([k]) => k !== "name")));
  const own = (f) => !f.name.startsWith("__") && !f.name.includes(".");
  let fields = schema.fields.filter(own);
  const rest = schema.fields.filter((f) => !own(f));
  const collections = store.collectionNames.filter((n) => store.schemas[n].kind === "collection");
  const list = el("div", { className: "field-list" });

  const paint = () => {
    list.replaceChildren(...fields.map((f, i) => {
      const fixed = SYSTEM.has(f.name) || (name === "projects" && !f.custom);
      const label = el("input", { type: "text", value: f.label || "", placeholder: "Label" });
      label.oninput = () => { f.label = label.value; };
      const type = el("select", { disabled: fixed }, ...FIELD_TYPES.map(([v, t]) => el("option", { value: v, selected: v === (f.type === "list" ? "text" : f.type) }, t)),
        f.type === "list" ? el("option", { value: "list", selected: true }, "List of short texts") : null,
        f.type === "slug" ? el("option", { value: "slug", selected: true }, "Slug") : null,
        f.type === "canvas" ? el("option", { value: "canvas", selected: true }, "Page") : null);
      type.onchange = () => { f.type = type.value; paint(); };
      const help = el("input", { type: "text", value: f.help || "", placeholder: "Help text (optional)" });
      help.oninput = () => { f.help = help.value || undefined; };
      const req = el("input", { type: "checkbox", checked: !!f.required, disabled: fixed });
      req.onchange = () => { f.required = req.checked || undefined; };
      const extra = [];
      if (f.type === "select") {
        const opts = el("input", { type: "text", value: (f.options || []).map((o) => o.label).join(", "), placeholder: "Choices, separated by commas" });
        opts.oninput = () => { f.options = opts.value.split(",").map((x) => x.trim()).filter(Boolean).map((x) => ({ value: slugify(x), label: x })); };
        extra.push(opts);
      }
      if (f.type === "reference" || f.type === "multiReference") {
        const coll = el("select", {}, ...collections.map((c) => el("option", { value: c, selected: c === f.collection }, store.schemas[c].label)));
        coll.onchange = () => { f.collection = coll.value; };
        if (!f.collection) f.collection = collections[0];
        extra.push(coll);
      }
      if (f.type === "phone") { f.type = "text"; f.pattern = "^\\+?[0-9 ()-]{6,}$"; f.patternHelp = "should be a phone number"; }
      return el("div", { className: "field-row" + (fixed ? " fixed" : "") },
        el("div", { className: "field-row-main" },
          el("span", { className: "handle" }, "☰"), label, type,
          el("label", { className: "inline-check" }, req, "Required"),
          el("span", { className: "muted small" }, f.name),
          el("span", { className: "spacer" }),
          el("button", { className: "icon-btn", title: "Move up", disabled: i === 0, onclick: () => { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; paint(); } }, "↑"),
          el("button", { className: "icon-btn", title: "Move down", disabled: i === fields.length - 1, onclick: () => { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; paint(); } }, "↓"),
          fixed ? null : el("button", { className: "icon-btn", title: "Delete field", onclick: async () => {
            const used = (store.items[name] || []).filter((r) => r[f.name] != null && r[f.name] !== "" && !(Array.isArray(r[f.name]) && !r[f.name].length)).length;
            const shown = fieldShownOn(name, f.name);
            const parts = [];
            if (shown.length) parts.push(`It's shown on ${shown.join(", ")}: those spots will be left empty until you unbind or remove them in the Designer.`);
            if (used) parts.push(`${used} item(s) have a value in it. The values stay in the files but won't be shown or edited.`);
            if (parts.length && !(await confirmDialog(`Delete ${f.label}?`, parts.join(" "), { ok: "Delete", danger: true }))) return;
            fields.splice(i, 1); paint();
          } }, "×")),
        el("div", { className: "field-row-extra" }, help, ...extra));
    }));
  };
  paint();

  const addType = el("select", {}, ...FIELD_TYPES.map(([v, t]) => el("option", { value: v }, t)));
  const addLabel = el("input", { type: "text", placeholder: "New field label" });
  const add = () => {
    const label = addLabel.value.trim();
    if (!label) return toast("Name the field.", "error");
    let key = camel(label);
    while (schema.fields.some((x) => x.name === key) || fields.some((x) => x.name === key)) key += "2";
    const f = { name: key, label, type: addType.value === "phone" ? "text" : addType.value, group: schema.groups?.[0] || "Content", custom: true };
    if (addType.value === "image") f.altField = `${key}Alt`;
    if (addType.value === "phone") Object.assign(f, { pattern: "^\\+?[0-9 ()-]{6,}$", patternHelp: "should be a phone number" });
    fields.push(f);
    addLabel.value = "";
    paint();
  };
  addLabel.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

  const ok = await modal({
    title: `${schema.label} · Collection settings`,
    wide: true,
    body: el("div", {},
      el("p", { className: "hint" }, "The fields every item has. Names in grey are what the data files and template bindings use."),
      list,
      el("div", { className: "field-add" }, addLabel, addType, el("button", { className: "btn", onclick: add }, "+ Add field"))),
    actions: [{ label: "Cancel", value: null }, { label: "Save fields", primary: true, value: true }],
  });
  if (!ok) return;
  schema.fields = [...fields, ...rest];
  schema.keyOrder = [...new Set([...(schema.keyOrder || []), ...fields.map((f) => f.name)])];
  try {
    await commit([{ path: `content/_schema/${name}.json`, content: JSON.stringify(schema, null, 2) + "\n" }], `CMS: fields of ${schema.label}`);
    toast("Fields saved.");
    location.reload();
  } catch (err) {
    toast(err.message, "error");
  }
}

export { TYPE_LABEL };
