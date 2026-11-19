/**
 * Everything the CMS has loaded, and the one way of saving it.
 *
 * Collections are described by schemas in content/_schema/. Each record keeps
 * the path it was read from in `__path`, so renames know what to delete.
 */

import { CONFIG } from "./config.js?v=6600ab59";
import { el, $, toast, stripInternal, assetUrl } from "./lib/dom.js?v=6600ab59";

export const store = {
  backend: null,
  user: null,
  schemas: {},       // name -> schema
  items: {},         // name -> [record]   (singleton: [record])
  template: null,    // content/_templates/project.json
  partials: {},      // navbar etc., for the preview
  media: null,
  siteImages: null,
  collectionNames: [],
  templates: {},
  components: {},
};

/* ------------------------------------------------------------------ load -- */

export async function loadAll() {
  const b = store.backend;
  // Every schema in content/_schema is a collection or a settings screen;
  // CONFIG.collections only sets the order of the ones it names.
  const found = (await b.listDir("content/_schema")).filter((f) => f.name.endsWith(".json")).map((f) => f.name.slice(0, -5));
  const preferred = CONFIG.collections.filter((n) => found.includes(n));
  const names = [...preferred, ...found.filter((n) => !preferred.includes(n)).sort()];
  store.collectionNames = names;
  store.templates = {};
  await Promise.all(names.map(async (name) => {
    const schema = await b.readJson(`content/_schema/${name}.json`);
    schema.name = name;
    store.schemas[name] = schema;
    if (schema.template && name !== "projects") {
      store.templates[name] = await b.readJson(schema.template).catch(() => null);
    }
    if (schema.kind === "singleton") {
      let record = {};
      try { record = await b.readJson(schema.file); } catch (err) { if (err.status !== 404) throw err; }
      record.__path = schema.file;
      store.items[name] = [record];
      return;
    }
    const files = (await b.listDir(schema.folder)).filter((f) => f.name.endsWith(".json"));
    const records = await Promise.all(files.map(async (f) => {
      const r = await b.readJson(f.path);
      r.__path = f.path;
      return r;
    }));
    store.items[name] = sortRecords(records, schema);
  }));

  store.template = await b.readJson("content/_templates/project.json");
  // Components (navbar, footer): one source, used by every page.
  store.components = {};
  for (const f of (await b.listDir("content/components")).filter((x) => x.name.endsWith(".json"))) {
    const c = await b.readJson(f.path);
    c.__path = f.path;
    store.components[f.name.slice(0, -5)] = c;
  }
  const partial = (n) => b.readFile(`src/_includes/partials/${n}`).catch(() => "");
  const [navbar, navbarMain, globalStyles, scrollUp] = await Promise.all([
    partial("navbar-project.njk"), partial("navbar-main.njk"), partial("global-styles.njk"), partial("scroll-up-project.njk"),
  ]);
  store.partials = { navbar, navbarMain, globalStyles, scrollUp };
}

export function sortRecords(records, schema) {
  const key = schema.sortBy || "slug";
  return records.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return av - bv || String(a.slug).localeCompare(String(b.slug));
    return String(av ?? "").localeCompare(String(bv ?? ""));
  });
}

/** Path a record is saved under. */
export function recordPath(collection, record) {
  const schema = store.schemas[collection];
  return schema.kind === "singleton" ? schema.file : `${schema.folder}/${record.slug}.json`;
}

/** Where a record is published, or null for things that aren't pages. */
export function viewPath(collection, record) {
  const schema = store.schemas[collection];
  if (!schema || !record?.slug) return null;
  if (collection === "projects") return `/project/${record.slug}/`;
  if (collection === "pages") return record.slug === "index" ? "/" : record.slug === "404" ? "/404.html" : `/${record.slug}/`;
  if (schema.kind === "collection" && schema.urlPrefix) return `${schema.urlPrefix}${record.slug}/`;
  return null;
}

/**
 * Field order on disk follows the schema, so files stay readable and diffs
 * stay small no matter what order the editor set things in.
 */
export function serializeRecord(collection, record) {
  const schema = store.schemas[collection];
  // The date of the last save, for the sitemap's lastmod. Set on the record
  // itself so the in-memory copy matches what was written.
  if (schema.stampUpdated) record.updatedAt = new Date().toISOString().slice(0, 10);
  const plain = stripInternal(record);
  const ordered = {};
  for (const key of schema.keyOrder || []) if (key in plain) ordered[key] = plain[key];
  for (const [k, v] of Object.entries(plain)) if (!(k in ordered)) ordered[k] = v;
  return JSON.stringify(ordered, null, 2) + "\n";
}

/* ------------------------------------------------------------------ save -- */

/**
 * changes: [{ path, content: string | null, base64? }]
 * One commit on GitHub, one batch on the local server.
 */
export async function commit(changes, message, { view } = {}) {
  await store.backend.commit(changes, message);
  watchBuild(view);
}

/* ----------------------------------------------------------- publishing -- */

let buildTimer = null;

/**
 * Report what the build actually did. A commit only means the content was
 * saved; the site isn't updated until the build finishes, so this polls
 * rather than claiming success up front.
 */
export function watchBuild(viewPath) {
  clearTimeout(buildTimer);
  const local = store.backend.mode === "local";
  let tries = 0;
  setBuildStatus(local ? "Rebuilding…" : "Publishing…", "busy");
  const poll = async () => {
    tries += 1;
    try {
      const run = await store.backend.latestRun();
      if (run && run.status !== "completed") {
        setBuildStatus(local ? "Rebuilding…" : "Publishing…", "busy");
      } else if (run?.conclusion === "success") {
        setBuildStatus(local ? "Site rebuilt" : "Published", "ok", viewPath);
        return;
      } else if (run?.conclusion) {
        const what = run.conclusion === "cancelled" ? "was cancelled" : "failed";
        setBuildStatus(local ? `Rebuild ${what} — see the terminal` : `Publishing ${what} — your changes are saved, the live site wasn't updated`, "error", null, run.html_url);
        return;
      }
    } catch {
      // The workflow may not exist yet; stay quiet rather than alarm.
    }
    if (tries < (local ? 60 : 30)) buildTimer = setTimeout(poll, local ? 700 : 6000);
    else setBuildStatus("Still building — check back in a minute", "busy");
  };
  buildTimer = setTimeout(poll, local ? 500 : 5000);
}

/** A page's name as people know it (Home, About, Work…), the same everywhere in the CMS. */
export function pageLabel(p) {
  if (!p) return "";
  const known = { index: "Home", about: "About", work: "Work", collaborate: "Collaborate", 404: "404 — Not found" }[p.slug];
  return known || p.seo?.title?.split(/\s[\u2014|-]\s/)[0] || p.slug;
}

export function siteUrl(path = "/") {
  if (store.backend?.mode === "local") return assetUrl(path);
  return (CONFIG.siteUrl || "/").replace(/\/+$/, "") + path;
}

function setBuildStatus(text, kind, viewPath, detailsUrl) {
  let bar = $("#build-status");
  if (!bar) document.body.append((bar = el("div", { id: "build-status", attrs: { role: "status" } })));
  bar.className = kind;
  // replaceChildren writes null as the text "null", so leave absent links out.
  bar.replaceChildren(...[
    el("span", { className: "dot" }), text,
    kind === "ok" ? el("a", { href: siteUrl(viewPath || "/"), target: "_blank", rel: "noreferrer" }, "View") : null,
    detailsUrl ? el("a", { href: detailsUrl, target: "_blank", rel: "noreferrer" }, "Details") : null,
  ].filter(Boolean));
  if (kind === "ok") setTimeout(() => bar.remove(), 8000);
}

export { toast };
