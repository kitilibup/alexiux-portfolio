/**
 * A collection's list: find, filter, reorder, publish, feature, create, delete.
 *
 * Quick changes made here - drag to reorder, the home-page star, publish or
 * unpublish - are collected and saved together as one commit, so rearranging
 * the Work page is one deploy rather than one per row.
 */

import { el, toast, modal, confirmDialog, slugify, clone, assetUrl, plural } from "../lib/dom.js?v=6600ab59";
import { EMPTY_PROJECT } from "../lib/project-model.js?v=6600ab59";
import { store, commit, serializeRecord, sortRecords, siteUrl } from "../store.js?v=6600ab59";
import { viewPath } from "../store.js?v=6600ab59";
import { takenAddress } from "./collections.js?v=6600ab59";

export const listState = { dirty: false };

const FILTERS = [
  ["all", "All", () => true],
  ["live", "Published", (r) => !r.draft],
  ["draft", "Drafts", (r) => !!r.draft],
  ["home", "On home page", (r) => !!r.featured && !r.draft],
];

export function collectionView(collection, { go }) {
  const schema = store.schemas[collection];
  const records = store.items[collection];
  const isProjects = schema.preview === "project";
  const hasDrafts = schema.fields.some((f) => f.name === "draft");
  const imgField = schema.seo?.imageField;
  const descField = isProjects ? "cardDescription" : schema.seo?.descriptionField;
  const titleOf = (r) => String(r[schema.titleField] || r.title || r.slug || "").trim() || "Untitled";

  // Pending quick edits, by record: { order, featured, draft }.
  const pending = new Map();
  let order = records.slice();
  let filter = sessionStorage.getItem(`cms:filter:${collection}`) || "all";
  let query = "";

  const value = (r, k) => (pending.get(r)?.[k] ?? r[k]);
  const patch = (r, k, v) => {
    const p = { ...(pending.get(r) || {}) };
    if (v === r[k]) delete p[k]; else p[k] = v;
    Object.keys(p).length ? pending.set(r, p) : pending.delete(r);
    listState.dirty = pending.size > 0;
    paint();
  };

  /* -------------------------------------------------------- save bar -- */

  const saveBar = el("div", { className: "save-bar", hidden: true });
  const paintSaveBar = () => {
    saveBar.hidden = !pending.size;
    if (!pending.size) return;
    saveBar.replaceChildren(
      el("span", {}, `${plural(pending.size, schema.singular.toLowerCase())} changed`),
      el("button", { className: "link", onclick: () => { pending.clear(); order = records.slice(); listState.dirty = false; paint(); } }, "Discard"),
      el("button", { className: "btn primary", onclick: saveQuick }, "Save changes"));
  };

  async function saveQuick() {
    const changes = [];
    const updated = [];
    for (const [r, p] of pending) {
      const next = { ...r, ...p };
      changes.push({ path: r.__path, content: serializeRecord(collection, next) });
      updated.push([r, next]);
    }
    try {
      await commit(changes, `CMS: update ${plural(changes.length, collection === "projects" ? "project" : "entry")} from the list`, { view: "/work/" });
      for (const [r, next] of updated) Object.assign(r, next);
      sortRecords(records, schema);
      order = records.slice();
      pending.clear();
      listState.dirty = false;
      toast("Saved.");
      paint();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  /* ------------------------------------------------------------ rows -- */

  const tbody = el("tbody");

  /*
   * Reordering: drag a row by its handle (mouse, trackpad, touch or pen), or
   * focus the handle and press the arrow keys. Pointer events rather than the
   * browser's drag-and-drop, which Safari and Firefox don't start without
   * extra data and which doesn't work on touch at all. Works in any filter or
   * search: a row moves next to the one it's dropped on.
   */
  function moveTo(r, target, below) {
    if (!target || target === r) return;
    order = order.filter((x) => x !== r);
    order.splice(order.indexOf(target) + (below ? 1 : 0), 0, r);
    // Order numbers are what the cards show (01, 02, ...), so they're
    // renumbered from 1 rather than shuffled.
    order.forEach((x, i) => patch(x, "order", i + 1));
  }
  function startDrag(e, r, tr) {
    if (e.button !== 0) return;
    const fromHandle = !!e.target.closest(".handle");
    // On a touch screen only the handle drags (a finger on the row scrolls);
    // links, buttons and fields keep their own clicks.
    if (!fromHandle && (e.pointerType === "touch" || e.target.closest("a, button, input, select, textarea, label"))) return;
    if (fromHandle) e.preventDefault();
    const scroller = document.getElementById("main") || document.scrollingElement;
    const rows = [...tbody.children].filter((x) => x !== tr);
    const startX = e.clientX, startY = e.clientY, startScroll = scroller.scrollTop;
    let lastY = e.clientY, drop = null, frame = 0, started = false;
    // The row lifts once the pointer has moved a little, so a plain click
    // (or selecting nothing) doesn't start a drag.
    const begin = () => {
      started = true;
      tr.classList.add("dragging");
      document.body.classList.add("is-reordering");
      getSelection()?.removeAllRanges();
      frame = requestAnimationFrame(tick);
    };
    const mark = () => {
      const dy = lastY - startY + (scroller.scrollTop - startScroll);
      tr.style.transform = `translateY(${dy}px)`;
      let next = null;
      for (const x of rows) {
        const b = x.getBoundingClientRect();
        if (lastY < b.top + b.height / 2) { next = { row: x, below: false }; break; }
        next = { row: x, below: true };
      }
      for (const x of rows) x.classList.remove("drop-above", "drop-below");
      if (next) next.row.classList.add(next.below ? "drop-below" : "drop-above");
      drop = next;
    };
    const tick = () => {
      // Near the top or bottom edge, the list scrolls.
      const box = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      const edge = 48;
      const v = lastY < box.top + edge ? -Math.ceil((box.top + edge - lastY) / 4) : lastY > box.bottom - edge ? Math.ceil((lastY - box.bottom + edge) / 4) : 0;
      if (v) { scroller.scrollTop += v; mark(); }
      frame = requestAnimationFrame(tick);
    };
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      lastY = ev.clientY;
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        begin();
      }
      ev.preventDefault();
      mark();
    };
    const end = (ev, cancel) => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancelIt);
      document.removeEventListener("keydown", esc, true);
      if (!started) return;
      tr.classList.remove("dragging");
      tr.style.transform = "";
      document.body.classList.remove("is-reordering");
      for (const x of rows) x.classList.remove("drop-above", "drop-below");
      if (!cancel && drop && Math.abs(lastY - startY) > 3) {
        const target = rowRecord.get(drop.row);
        moveTo(r, target, drop.below);
        paint();
        tbody.querySelector(`[data-slug="${CSS.escape(r.slug)}"] .handle`)?.focus({ preventScroll: true });
      }
    };
    const up = (ev) => end(ev, false);
    const cancelIt = (ev) => end(ev, true);
    const esc = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); end(ev, true); } };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancelIt);
    document.addEventListener("keydown", esc, true);
  }
  function keyMove(e, r) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const visible = [...tbody.children].map((x) => rowRecord.get(x));
    const i = visible.indexOf(r);
    const j = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (j < 0 || j >= visible.length) return;
    moveTo(r, visible[j], e.key === "ArrowDown");
    paint();
    tbody.querySelector(`[data-slug="${CSS.escape(r.slug)}"] .handle`)?.focus();
  }
  const rowRecord = new WeakMap();

  function row(r) {
    const live = !value(r, "draft");
    const handle = schema.reorderable ? el("button", {
      type: "button", className: "handle",
      title: "Drag to reorder (or focus and use the arrow keys)",
      attrs: { "aria-label": `Reorder ${titleOf(r)}: arrow keys move it up or down` },
    }, "☰") : null;
    const tr = el("tr", { className: (live ? "" : "is-draft") + (pending.has(r) ? " is-changed" : ""), dataset: { slug: r.slug } },
      schema.reorderable ? el("td", { className: "handle-cell" }, handle) : null,
      el("td", { className: "thumb-cell" },
        r.thumbnail || r.heroImage || r[imgField] ? el("img", { src: assetUrl(r.thumbnail || r.heroImage || r[imgField]), alt: "", loading: "lazy" }) : el("span", { className: "no-thumb" })),
      el("td", { className: "name-cell" },
        el("a", { className: "strong", href: `#/${collection}/${r.slug}`, onclick: (e) => { e.preventDefault(); go({ name: collection, slug: r.slug }); } },
          titleOf(r)),
        el("div", { className: "muted" }, (viewPath(collection, r) || "").replace(/\/$/, "") || "/"),
        descField && r[descField] ? el("div", { className: "desc" }, String(r[descField]).trim()) : null),
      isProjects ? el("td", { className: "muted" }, r.year || "") : null,
      isProjects ? el("td", {}, el("div", { className: "chips small" }, ...(r.tags || []).map((t) => el("span", { className: "chip" }, t)))) : null,
      isProjects ? el("td", { className: "center" },
        el("button", {
          className: "star" + (value(r, "featured") ? " on" : ""),
          title: value(r, "featured") ? "Shown on the home page — click to remove" : "Not on the home page — click to add",
          attrs: { "aria-pressed": String(!!value(r, "featured")), "aria-label": "Show on home page" },
          onclick: () => patch(r, "featured", !value(r, "featured")),
        }, value(r, "featured") ? "★" : "☆")) : null,
      hasDrafts ? el("td", {},
        (schema.protected || []).includes(r.slug)
          ? el("span", { className: "pill live", title: "Always published" }, "Published")
          : el("button", {
              className: "pill " + (live ? "live" : "draft"),
              title: live ? "Published — click to unpublish" : "Draft — click to publish",
              onclick: () => patch(r, "draft", live),
            }, live ? "Published" : "Draft")) : null,
      el("td", { className: "row-actions" },
        !value(r, "draft") && viewPath(collection, r)
          ? el("a", { className: "link", href: siteUrl(viewPath(collection, r)), target: "_blank", rel: "noreferrer" }, "View")
          : null,
        collection === "pages" ? el("a", { className: "link", href: `#/designer/${r.slug}`, onclick: (e) => { e.preventDefault(); go({ name: "designer", slug: r.slug }); } }, "Designer") : null,
        schema.fixed ? null : el("button", { className: "link", onclick: () => duplicate(r) }, "Duplicate"),
        schema.fixed || (schema.protected || []).includes(r.slug) ? null : el("button", { className: "link danger", onclick: () => remove(r) }, "Delete")));

    rowRecord.set(tr, r);
    if (handle) {
      tr.classList.add("can-drag");
      tr.addEventListener("pointerdown", (e) => startDrag(e, r, tr));
      handle.addEventListener("keydown", (e) => keyMove(e, r));
    }
    return tr;
  }

  function paint() {
    const f = FILTERS.find(([k]) => k === filter)?.[2] || (() => true);
    const q = query.toLowerCase();
    const shown = order.filter((r) => f({ ...r, ...pending.get(r) }) && (!q ||
      [r.title, r.slug, r.cardDescription, ...(r.tags || [])].join(" ").toLowerCase().includes(q)));
    tbody.replaceChildren(...shown.map(row));
    empty.hidden = shown.length > 0;
    for (const b of filterBar.children) b.classList.toggle("on", b.dataset.filter === filter);
    paintSaveBar();
  }

  /* --------------------------------------------------------- actions -- */

  async function duplicate(source) {
    const base = `${titleOf(source)} copy`;
    let slug = slugify(base);
    for (let n = 2; records.some((r) => r.slug === slug); n++) slug = `${slugify(base)}-${n}`;
    const record = { ...clone(source), [schema.titleField || "title"]: base, slug, redirectFrom: [] };
    if (hasDrafts) record.draft = true;
    if (isProjects) record.featured = false;
    if (schema.sortBy === "order") record.order = nextOrder();
    delete record.updatedAt;
    await create(record, `CMS: duplicate ${collection}/${source.slug}`);
  }

  async function remove(record) {
    const refs = records.filter((r) => r !== record && r.nextProject === record.slug);
    const ok = await confirmDialog(`Delete "${(record.title || record.slug).trim()}"?`,
      (refs.length ? `${refs.map((r) => r.title.trim()).join(", ")} show${refs.length === 1 ? "s" : ""} it as Next case; ${refs.length === 1 ? "that" : "those"} will show no Next case until you pick another. ` : "") +
      "The file is deleted from the repository; it can be recovered from git history.",
      { ok: "Delete", danger: true });
    if (!ok) return;
    const changes = [{ path: record.__path, content: null }];
    for (const r of refs) changes.push({ path: r.__path, content: serializeRecord(collection, { ...r, nextProject: "" }) });
    try {
      await commit(changes, `CMS: delete ${collection}/${record.slug}`, { view: "/work/" });
      for (const r of refs) r.nextProject = "";
      records.splice(records.indexOf(record), 1);
      order = order.filter((r) => r !== record);
      pending.delete(record);
      toast("Deleted.");
      paint();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const nextOrder = () => Math.max(0, ...records.map((r) => r.order ?? 0)) + 1;

  async function create(record, message) {
    const path = `${schema.folder}/${record.slug}.json`;
    try {
      await commit([{ path, content: serializeRecord(collection, record) }], message);
      record.__path = path;
      records.push(record);
      sortRecords(records, schema);
      toast(`Created "${record.title}" as a draft.`);
      go({ name: collection, slug: record.slug });
    } catch (err) {
      toast(err.message, "error");
    }
  }

  /** An empty record for any collection, from its schema. */
  function blankRecord(title, slug) {
    if (collection === "pages") {
      // A page needs the site's shell (head, navbar, footer, scripts): About's.
      const shell = records.find((r) => r.slug === "about") || records[0];
      const rec = clone(Object.fromEntries(Object.entries(shell).filter(([k]) => !k.startsWith("__"))));
      delete rec.projectList;
      delete rec.updatedAt;
      return { ...rec, slug, navActive: [], seo: { title },
        bodyHtml: `<section class="section"><div class="container"><h1 class="case-heading">${title.replace(/[<&]/g, "")}</h1></div></section>` };
    }
    if (isProjects) {
      return { ...clone(EMPTY_PROJECT), title, slug, year: String(new Date().getFullYear()),
        // Same Next case as the others, so the new page isn't missing a section.
        nextProject: records.find((r) => !r.draft)?.slug || "", seo: {} };
    }
    const empty = { list: [], gallery: [], multiReference: [], toggle: false, number: 0 };
    const rec = {};
    for (const f of schema.fields) {
      if (f.name.startsWith("__") || f.name.includes(".")) continue;
      rec[f.name] = clone(empty[f.type] ?? "");
    }
    return { ...rec, [schema.titleField || "name"]: title, slug, seo: {} };
  }

  async function newRecord() {
    const prefix = schema.urlPrefix || (isProjects ? "/project/" : collection === "pages" ? "/" : `/${collection}/`);
    const noun = schema.singular.toLowerCase();
    const name = el("input", { type: "text", placeholder: isProjects ? "e.g. Booking app redesign" : `Name of the ${noun}`, autofocus: true, id: "new-name" });
    const url = el("code", { className: "muted" }, `${prefix}…`);
    const from = el("select", { id: "new-from" },
      el("option", { value: "" }, `Blank ${noun}`),
      ...records.map((r) => el("option", { value: r.slug }, `Copy of ${titleOf(r)}`)));
    name.oninput = () => { url.textContent = `${prefix}${slugify(name.value) || "…"}`; };

    const result = await modal({
      title: `New ${noun}`,
      body: el("div", { className: "fields" },
        el("div", { className: "field" }, el("label", { htmlFor: "new-name", className: "field-label" }, "Name"), name, el("p", { className: "hint" }, "Address: ", url)),
        el("div", { className: "field" }, el("label", { htmlFor: "new-from", className: "field-label" }, "Start from"), from,
          el("p", { className: "hint" }, `A copy takes the other ${noun}'s content and images, ready to rewrite.${hasDrafts ? " It starts as a draft either way." : ""}`))),
      actions: [
        { label: "Cancel", value: null },
        { label: "Create", primary: true, onClick: () => {
          const title = name.value.trim();
          const slug = slugify(title);
          if (!title || !slug) { toast("Give it a name first.", "error"); return undefined; }
          if (records.some((r) => r.slug === slug)) { toast(`"${prefix}${slug}" already exists.`, "error"); return undefined; }
          if (collection === "pages" && takenAddress(slug)) { toast(`/${slug}/ is already ${takenAddress(slug)} \u2014 choose another name.`, "error"); return undefined; }
          return { title, slug, from: from.value };
        } },
      ],
    });
    if (!result) return;

    const source = records.find((r) => r.slug === result.from);
    const record = source
      ? { ...clone(source), [schema.titleField || "title"]: result.title, slug: result.slug, redirectFrom: [] }
      : blankRecord(result.title, result.slug);
    if (hasDrafts) record.draft = true;
    if (isProjects) record.featured = false;
    if (schema.sortBy === "order") record.order = nextOrder();
    delete record.__path;
    delete record.updatedAt;
    await create(record, `CMS: create ${collection}/${record.slug}`);
  }

  /* ---------------------------------------------------------- layout -- */

  const filterBar = el("div", { className: "seg" }, ...(isProjects ? FILTERS : hasDrafts ? FILTERS.filter(([k]) => k !== "home") : []).map(([k, label]) =>
    el("button", { type: "button", className: "seg-btn", dataset: { filter: k },
      onclick: () => { filter = k; sessionStorage.setItem(`cms:filter:${collection}`, k); paint(); } }, label)));
  const search = el("input", { type: "search", className: "search", placeholder: `Search ${schema.label.toLowerCase()}`,
    oninput: (e) => { query = e.target.value; paint(); } });
  const empty = el("p", { className: "hint empty", hidden: true }, "Nothing matches.");

  const head = el("tr", {},
    schema.reorderable ? el("th", { className: "handle-cell" }) : null,
    el("th", {}), el("th", {}, "Name"),
    isProjects ? [el("th", {}, "Year"), el("th", {}, "Tags"), el("th", { className: "center", title: "Shown on the home page" }, "Home")] : null,
    hasDrafts ? el("th", {}, "Status") : null,
    el("th", {}));

  const counts = hasDrafts
    ? `${records.filter((r) => !r.draft).length} published · ${records.filter((r) => r.draft).length} draft` + (isProjects ? ` · ${records.filter((r) => r.featured && !r.draft).length} on the home page` : "")
    : schema.note || "";

  paint();
  return el("div", { className: "page" },
    el("header", { className: "page-head" },
      el("div", {}, el("h1", {}, schema.label), el("p", { className: "muted" }, counts)),
      el("div", { className: "actions" },
        schema.fixed ? null : el("button", { className: "btn primary", onclick: newRecord }, `New ${schema.singular.toLowerCase()}`))),
    hasDrafts ? el("div", { className: "list-tools" }, filterBar, search,
      schema.reorderable ? el("span", { className: "muted small" }, "Drag a row to change the order on the Work page") : null) : null,
    el("table", { className: "table" + (schema.reorderable ? " reorderable" : "") }, el("thead", {}, head), tbody),
    empty, saveBar);
}
