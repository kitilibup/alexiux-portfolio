/**
 * Editing one record: tabs of fields from the schema, a live preview of the
 * page, and saving.
 *
 * The record is edited as a copy, so leaving without saving changes nothing.
 * Saving validates, writes the file, and - for a renamed project - deletes the
 * old file and repoints every Next case reference, all in one commit.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, clone, getField, setField, sameValue, stripInternal, confirmDialog, assetUrl, withLocalCopies } from "../lib/dom.js?v=6600ab59";
import { renderProjectBody, renderHtmlOpen, validateProject, withPositions } from "../lib/project-model.js?v=6600ab59";
import { renderItemBody, bindMarkup, workCardTemplate } from "../lib/collections.js?v=6600ab59";
import { renderComponent, pageIdOf } from "../lib/components.js?v=6600ab59";
import { sweetText } from "../lib/site-head.js?v=6600ab59";
import { store, commit, recordPath, serializeRecord, sortRecords, siteUrl, viewPath } from "../store.js?v=6600ab59";
import { fieldControl, pageStyles } from "../fields/index.js?v=6600ab59";

export const editorState = { dirty: false, save: null };

export function editorView(collection, slug, { go, isNew = false } = {}) {
  const schema = store.schemas[collection];
  const records = store.items[collection];
  const original = schema.kind === "singleton" ? records[0] : records.find((r) => r.slug === slug);
  if (!original) return el("div", { className: "page" }, el("p", { className: "hint" }, "Not found."));

  const draft = clone(original);
  const listeners = new Set();
  // Binary files a field produced (fonts, for now), committed with the next save.
  const pendingFiles = new Map();
  const status = el("span", { className: "status" });
  const saveBtn = el("button", { className: "btn primary", disabled: true }, "Save");

  const paintDirty = () => {
    editorState.dirty = pendingFiles.size > 0 || !sameValue(stripInternal(draft), stripInternal(original));
    saveBtn.disabled = !editorState.dirty;
    status.textContent = editorState.dirty ? "Unsaved changes" : "";
    status.className = "status" + (editorState.dirty ? " warn" : "");
  };

  const ctx = {
    draft, original, collection, isNew,
    get: (name) => getField(draft, name),
    set(name, value) {
      const prev = getField(draft, name);
      if (value === undefined) {
        const keys = name.split(".");
        const last = keys.pop();
        const parent = keys.length ? getField(draft, keys.join(".")) : draft;
        if (parent) delete parent[last];
      } else setField(draft, name, value);
      paintDirty();
      for (const fn of listeners) fn(name, prev);
      if (name === schema.titleField) title.textContent = value || "Untitled";
    },
    subscribe: (fn) => listeners.add(fn),
    addFile: (path, base64) => { pendingFiles.set(path, base64); paintDirty(); },
  };

  /* --------------------------------------------------------------- tabs -- */

  const groups = new Map();
  for (const g of schema.groups || []) groups.set(g, []);
  for (const f of schema.fields) {
    const g = f.group || "Details";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }

  const panels = new Map();
  const tabs = el("div", { className: "tabs", attrs: { role: "tablist" } });
  let activeTab = sessionGet(`tab:${collection}`) || [...groups.keys()][0];
  if (!groups.has(activeTab)) activeTab = [...groups.keys()][0];

  for (const [name, fields] of groups) {
    const panel = el("section", { className: "panel", attrs: { role: "tabpanel" } },
      el("div", { className: "fields" }, ...fields.map((f) => fieldControl(f, ctx))));
    panels.set(name, panel);
    tabs.append(el("button", {
      type: "button",
      className: "tab",
      attrs: { role: "tab" },
      dataset: { tab: name },
      onclick: () => showTab(name),
    }, name));
  }

  function showTab(name) {
    activeTab = name;
    sessionSet(`tab:${collection}`, name);
    for (const [n, p] of panels) p.hidden = n !== name;
    for (const t of tabs.children) t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false");
  }

  /* ------------------------------------------------------------ preview -- */

  // Projects, and every collection with a template page (Services, ones made
  // in the CMS), preview the page as it will be published.
  const hasPreview = schema.preview === "project" || !!store.templates[schema.name];
  const preview = hasPreview ? pagePreview(ctx, schema) : null;
  const previewBtn = hasPreview ? el("button", {
    className: "btn", title: "Show the page as it will be published, updating as you edit",
    onclick: () => togglePreview(),
  }, "Preview") : null;
  let previewOn = false;
  const layout = el("div", { className: "editor-layout" });
  function togglePreview(force) {
    previewOn = force ?? !previewOn;
    layout.classList.toggle("with-preview", previewOn);
    previewBtn?.classList.toggle("on", previewOn);
    if (previewOn) preview.refresh();
    sessionSet("preview", previewOn ? "1" : "");
  }

  /* --------------------------------------------------------------- save -- */

  async function save() {
    if (!editorState.dirty && !isNew) return;
    const errors = validate(schema, draft, collection);
    if (errors.length) {
      toast(errors[0], "error");
      return;
    }

    const changes = [];
    const path = recordPath(collection, draft);
    const renamed = schema.kind !== "singleton" && original.__path && original.__path !== path;
    if (renamed && records.some((r) => r !== original && r.slug === draft.slug)) {
      return toast(`Another ${schema.singular.toLowerCase()} already uses the URL "${draft.slug}".`, "error");
    }

    // A published project keeps answering at its old address (a redirect page).
    if (renamed && collection === "projects" && !original.draft) {
      draft.redirectFrom = [...new Set([...(draft.redirectFrom || []), original.slug])].filter((s) => s !== draft.slug);
    }
    changes.push({ path, content: serializeRecord(collection, draft) });
    for (const [p, content] of pendingFiles) changes.push({ path: p, content, base64: true });

    // A rename keeps references working: everything pointing at the old slug
    // is repointed in the same commit.
    const repointed = [];
    if (renamed) {
      changes.push({ path: original.__path, content: null });
      for (const r of records) {
        if (r === original || r.nextProject !== original.slug) continue;
        const updated = { ...r, nextProject: draft.slug };
        changes.push({ path: r.__path, content: serializeRecord(collection, updated) });
        repointed.push([r, updated]);
      }
    }

    if (draft.draft === false && original.draft !== false && schema.preview === "project") {
      const ok = await confirmDialog("Publish this project?",
        "It will appear on the Work page" + (draft.featured ? " and the home page" : "") + " once the site rebuilds.",
        { ok: "Publish" });
      if (!ok) return;
    }

    saveBtn.disabled = true;
    status.textContent = "Saving…";
    status.className = "status";
    try {
      const label = draft.slug || schema.label;
      await commit(changes, `CMS: ${renamed ? `rename ${original.slug} to ${draft.slug}` : `update ${collection}/${label}`}`, {
        view: viewPath(collection, draft),
      });
      for (const [r, updated] of repointed) Object.assign(r, updated);
      pendingFiles.clear();
      const fresh = clone(draft);
      for (const k of Object.keys(original)) if (!(k in fresh)) delete original[k];
      Object.assign(original, fresh, { __path: path });
      if (schema.kind !== "singleton") sortRecords(records, schema);
      editorState.dirty = false;
      isNew = false;
      paintDirty();
      status.textContent = "Saved";
      status.className = "status ok";
      if (renamed) {
        toast(`Saved. The address is now ${viewPath(collection, draft)}`);
        go({ name: collection, slug: draft.slug }, { replace: true });
      }
    } catch (err) {
      status.textContent = "Not saved";
      status.className = "status warn";
      saveBtn.disabled = false;
      toast(err.message, "error");
    }
  }
  saveBtn.onclick = save;
  editorState.save = save;

  /* ------------------------------------------------------------- header -- */

  const title = el("h1", {}, draft[schema.titleField] || schema.label);
  const view = viewPath(collection, draft);
  const header = el("header", { className: "page-head sticky" },
    el("div", { className: "head-left" },
      schema.kind === "singleton" ? null
        : el("button", { className: "link back", onclick: () => go({ name: collection }) }, `← ${schema.label}`),
      el("div", { className: "title-row" }, title,
        draft.draft ? el("span", { className: "badge draft" }, "Draft") : null)),
    el("div", { className: "actions" },
      status,
      view && !draft.draft ? el("a", { className: "btn", href: siteUrl(view), target: "_blank", rel: "noreferrer", title: "Open the published page" }, "View ↗") : null,
      previewBtn, saveBtn));

  layout.append(el("div", { className: "editor-main" }, tabs, ...panels.values()));
  if (preview) layout.append(preview.node);
  showTab(activeTab);
  if (hasPreview && sessionGet("preview") === "1" && innerWidth > 1300) togglePreview(true);
  paintDirty();
  if (isNew) { editorState.dirty = true; saveBtn.disabled = false; status.textContent = "Not saved yet"; status.className = "status warn"; }

  const page = el("div", { className: "page editor" }, header,
    schema.note ? el("p", { className: "hint" }, schema.note) : null, layout);
  // Toolbars and the preview stick below the header, whatever its height.
  new ResizeObserver(() => page.style.setProperty("--head-h", header.offsetHeight + "px")).observe(header);
  return page;
}

export { viewPath };

function validate(schema, draft, collection) {
  const errors = [];
  for (const f of schema.fields) {
    const v = getField(draft, f.name);
    if (f.required && (v == null || v === "" || (Array.isArray(v) && !v.length))) errors.push(`${f.label} is required.`);
    if (f.pattern && v && !new RegExp(f.pattern).test(String(v))) errors.push(`${f.label}: ${f.patternHelp || "doesn't look right."}`);
  }
  if (collection === "projects") errors.push(...validateProject(draft, store.items.projects));
  return errors;
}

/* ------------------------------------------------------------ preview -- */

/**
 * The page as it will be published, rendered by the same code the build uses:
 * a project through its template, any other collection item through its
 * template page's bindings. The frame is a fixed window that scrolls inside
 * itself. Scripts are not run (no analytics from the CMS, no Webflow
 * interactions), so elements that animate in are shown in their final state.
 */
function pagePreview(ctx, schema) {
  const frame = el("iframe", { className: "preview-frame", title: "Page preview", attrs: { sandbox: "allow-same-origin" } });
  const width = el("select", { className: "preview-width", title: "Preview width" },
    el("option", { value: "1440" }, "Desktop"), el("option", { value: "991" }, "Tablet"), el("option", { value: "390" }, "Phone"));
  const stage = el("div", { className: "preview-stage" }, frame);
  const node = el("aside", { className: "preview" },
    el("div", { className: "preview-bar" }, el("strong", {}, "Preview"), el("span", { className: "muted" }, "Updates as you edit"), width),
    stage);

  const isProject = schema.preview === "project";
  const t = isProject ? store.template : store.templates[schema.name];
  const css = (CONFIG.siteCss || []).map((h) => `<link rel="stylesheet" href="${h}">`).join("");
  const styles = pageStyles(t.shell.head, t.shell.customHead);
  const rebase = (html) => withLocalCopies(html).replace(/(src|href)="\/(?!\/)/g, (m, a) => `${a}="${assetUrl("/")}`);
  // Navbar and footer are Components, as in the build.
  const component = (name) => renderComponent(store.components[name]?.html || "", { pageId: pageIdOf(t.shell.htmlOpen) });
  const navbar = t.shell.navbar ? component(t.shell.navbar) : store.partials.navbar;
  const footer = t.shell.footer ? component(t.shell.footer) : t.shell.footerHtml || "";
  // Sweet Text (<big-dot>•<big-dot> → styled span), as the build does it.
  // Inert parsing: nothing in the markup loads or runs while it is bound.
  const makeRoot = (html) => {
    const doc = new DOMParser().parseFromString("<!doctype html><body><div id=r></div></body>", "text/html");
    const root = doc.getElementById("r");
    root.innerHTML = html;
    return root;
  };

  const bodyFor = (item) => {
    if (isProject) {
      const projects = withPositions(store.items.projects.map((r) => (r.slug === ctx.original.slug ? item : r)));
      const bindHtml = (html, x) => bindMarkup(html, schema, x, makeRoot, { collections: store.items });
      return { open: renderHtmlOpen(item, t), body: renderProjectBody(projects.find((x) => x.slug === item.slug) || item, t, projects, { bindHtml }) };
    }
    const collections = { ...store.items, [schema.name]: (store.items[schema.name] || []).map((r) => (r.slug === ctx.original.slug ? item : r)) };
    const cardTemplate = workCardTemplate((store.items.pages || []).find((p) => p.slug === "work"));
    return {
      open: t.shell.htmlOpen.replace("{{=slug}}", String(item.slug || "").replace(/[^\w-]/g, "")),
      body: renderItemBody(t, schema, item, makeRoot, { collections, cardTemplate }),
    };
  };

  let timer = null;
  let scrollY = 0;
  const render = () => {
    const { open, body } = bodyFor(ctx.draft);
    scrollY = frame.contentWindow?.scrollY || scrollY;
    frame.srcdoc = open.replace(/<!--[\s\S]*?-->/, "") +
      `<head><meta charset="utf-8">${css}${styles}<style>html{scroll-behavior:auto}.view-circle{display:none}</style></head>` +
      t.shell.bodyOpen + store.partials.globalStyles + t.shell.wrapperOpen +
      rebase(navbar + sweetText(body) + footer) + t.shell.wrapperClose + "</body></html>";
  };
  frame.addEventListener("load", () => {
    frame.contentWindow.scrollTo(0, scrollY);
    // Links in the preview would navigate the preview; they're for reading here.
    frame.contentDocument.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); }, true);
    fitScale();
  });

  const fitScale = () => {
    const w = Number(width.value);
    const avail = stage.clientWidth || 600;
    const scale = Math.min(1, avail / w);
    frame.style.width = `${w}px`;
    frame.style.height = `${Math.round(stage.clientHeight / scale)}px`;
    frame.style.transform = `scale(${scale})`;
  };
  width.onchange = fitScale;
  new ResizeObserver(fitScale).observe(stage);

  ctx.subscribe(() => {
    if (!node.isConnected || node.offsetParent === null) return;
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  });
  return { node, refresh: render };
}

/* ------------------------------------------------------- tab memory -- */

function sessionGet(k) { try { return sessionStorage.getItem("cms:" + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem("cms:" + k, v); } catch { /* private mode */ } }
