/**
 * The Designer's left side: a rail of tools and the panel it opens.
 *   A  Add          elements and layouts (sections from every page)
 *   Z  Navigator    the page as a tree; drag to move
 *   P  Pages        switch, create, duplicate, delete
 *      Variables    the site's CSS variables, grouped like Webflow's: colours, sizes, fonts
 *   G  Style selectors  tags ("All H1 Headings") and every class, how often it's used
 */

import { TYPES as VAR_TYPES, typeOf as typeOfValue, fits as fitsType } from "../lib/variables.js?v=6600ab59";
import { el, toast, modal, confirmDialog, slugify, clone } from "../lib/dom.js?v=6600ab59";
import { pickImage } from "../views/media.js?v=6600ab59";
import { takenAddress } from "../views/collections.js?v=6600ab59";
import { embedForUrl } from "../lib/project-model.js?v=6600ab59";
import { serializeNode as serializeOne, serializeWithBindings } from "../lib/webflow-html.js?v=6600ab59";
const serializeNode = (n) => serializeWithBindings(() => serializeOne(n));
import { ELEMENT_GROUPS, elementType, customClasses, canContain, TAG_SELECTORS } from "./model.js?v=6600ab59";
import { STYLE_GUIDE } from "./styleguide.js?v=6600ab59";

const TOOLS = [
  ["add", "+", "Add elements (A)", "a"],
  ["navigator", "☰", "Navigator (Z)", "z"],
  ["pages", "⎘", "Pages (P)", ""],
  ["variables", "◐", "Variables", ""],
  ["styles", "#", "Style selectors (G)", "g"],
];

const ICON = { Section: "▭", Container: "▢", "Div Block": "□", Grid: "▦", Columns: "‖", Heading: "H", Paragraph: "¶",
  "Text Link": "⇗", "Text Block": "T", "Block Quote": "“", "Rich Text": "¶", List: "•", "List Item": "•", Button: "▭",
  "Link Block": "⇗", Image: "▨", Video: "▶", Embed: "</>", "Collection List Wrapper": "≡", "Collection List": "≡", "Collection Item": "▫" };

export function leftPanels(D, { rail, panel }) {
  let open = sessionGet("left") || "navigator";
  const buttons = TOOLS.map(([id, ico, title]) => el("button", {
    title, className: open === id ? "on" : "",
    onclick: () => { open = open === id ? "" : id; sessionSet("left", open); paint(); },
  }, ico));
  rail.replaceChildren(...buttons);

  // Keyboard: A / Z / G toggle panels, like Webflow.
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const t = TOOLS.find(([, , , key]) => key && key === e.key.toLowerCase());
    if (t && document.querySelector(".dz")) { open = open === t[0] ? "" : t[0]; sessionSet("left", open); paint(); }
  });

  function paint() {
    buttons.forEach((b, i) => b.classList.toggle("on", TOOLS[i][0] === open));
    panel.hidden = !open;
    const builders = { add: addPanel, navigator: navigatorPanel, pages: pagesPanel, variables: variablesPanel, styles: stylesPanel };
    panel.replaceChildren(...(open ? builders[open](D) : []));
  }

  return { refresh: () => { if (open === "navigator" || open === "pages" || open === "styles" || open === "variables") paint(); }, paint };
}

/* ------------------------------------------------------------------ Add -- */

function addPanel(D) {
  const out = [el("div", { className: "dz-ph" }, "Add elements")];
  for (const g of ELEMENT_GROUPS) {
    out.push(el("div", { className: "dz-sec" },
      el("div", { className: "dz-sec-title" }, g.label),
      el("div", { className: "dz-grid" }, ...g.items.map((item) => el("button", {
        className: "dz-tile", title: `Add ${item.name}`,
        onclick: async () => {
          if (!D.doc) return;
          let html = item.html;
          if (item.pickImage) {
            const src = await pickImage({ title: "Image" });
            if (!src) return;
            html = `<img src="${src}" loading="lazy" alt=""/>`;
          }
          if (item.askVideo) {
            const url = window.prompt("Video link (YouTube, Vimeo, Wistia or Loom)");
            const e = url && embedForUrl(url);
            if (!e) { if (url) toast("That isn't a video link the site can embed.", "error"); return; }
            html = `<div style="padding-top:56.25%" class="w-video w-embed"><iframe src="${e.src}" width="960" height="540" scrolling="no" title="${e.title}" frameborder="0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture;" allowfullscreen="true"></iframe></div>`;
          }
          D.insertHtml(html);
        },
      }, el("span", { className: "ico" }, ICON[item.name] || "□"), item.name)))));
  }

  // Webflow's Collection List: the published items of a collection, repeated.
  const colls = (D.collectionNames?.() || []).filter((c) => c !== "pages");
  if (colls.length) {
    out.push(el("div", { className: "dz-sec" },
      el("div", { className: "dz-sec-title" }, "CMS"),
      el("div", { className: "dz-grid" }, el("button", {
        className: "dz-tile", title: "A list of a collection's items",
        onclick: async () => {
          if (!D.doc) return;
          const pick = el("select", {}, ...colls.map((c) => el("option", { value: c }, D.schemaOf(c).label)));
          const limit = el("input", { type: "number", min: 0, placeholder: "all" });
          const r = await modal({ title: "Collection List", body: el("div", { className: "fields" },
              el("div", { className: "field" }, el("label", { className: "field-label" }, "Collection"), pick),
              el("div", { className: "field" }, el("label", { className: "field-label" }, "Show at most"), limit)),
            actions: [{ label: "Cancel", value: null }, { label: "Add", primary: true, onClick: () => ({ c: pick.value, n: Number(limit.value) || 0 }) }] });
          if (!r) return;
          const sc = D.schemaOf(r.c);
          const title = sc.titleField || "name";
          const img = sc.fields.find((f) => f.type === "image" && (f.name === sc.seo?.imageField || true))?.name;
          const link = r.c === "projects" ? "/project/" : sc.urlPrefix;
          D.insertHtml(`<div class="w-dyn-list"><div role="list" class="w-dyn-items" data-cms-collection="${r.c}"${r.n ? ` data-cms-limit="${r.n}"` : ""}>` +
            `<div role="listitem" class="w-dyn-item">${img ? `<img src="" loading="lazy" alt="" data-cms-src="${img}"/>` : ""}<h3 data-cms-text="${title}">${sc.singular} name</h3>` +
            `${link ? `<a href="#" data-cms-href="__url">View ${sc.singular.toLowerCase()}</a>` : ""}</div></div>` +
            `<div class="w-dyn-empty" data-cms-empty-collection="${r.c}"><div>No items found.</div></div></div>`);
        },
      }, el("span", { className: "ico" }, "\u2261"), "Collection List"))));
  }

  // Layouts: every section already on the site, ready to reuse.
  const layouts = [];
  for (const p of D.allPages()) {
    const holder = document.createElement("div");
    holder.innerHTML = D.edits.get(p.slug) ?? p.bodyHtml ?? "";
    [...holder.children].forEach((sec, i) => {
      const heading = sec.querySelector("h1,h2,h3,.section-label")?.textContent.trim().slice(0, 40);
      layouts.push({ page: D.pageName(p), name: heading || `${elementType(sec)} ${i + 1}`, html: serializeNode(sec) });
    });
  }
  out.push(el("div", { className: "dz-sec" },
    el("div", { className: "dz-sec-title" }, "Layouts from your pages"),
    ...layouts.map((l) => el("button", { className: "dz-layout", title: "Insert a copy after the selected element",
      onclick: () => { if (D.doc) D.insertHtml(l.html, { inside: false }); } }, l.name, el("small", {}, l.page)))));
  return out;
}

/* ------------------------------------------------------------ Navigator -- */

function navigatorPanel(D) {
  // The Style Guide: just its samples, by the selector each one styles.
  if (D.page?.virtual) {
    const samples = [...(D.doc?.querySelectorAll("[data-cms-sample]") || [])];
    return [el("div", { className: "dz-ph" }, "Navigator", el("span", { className: "dz-status" }, `${samples.length} styles`)),
      ...samples.map((n) => el("div", {
        className: "dz-nav-row" + (D.selected === n ? " sel" : ""),
        onclick: () => { D.select(n, { scroll: true }); D.refresh(); },
      }, n.closest(".cms-sg-row")?.querySelector("code")?.textContent || n.tagName.toLowerCase()))];
  }
  const list = el("div", {});
  const collapsed = D.navCollapsed || (D.navCollapsed = new WeakSet());
  let dragging = null;

  const row = (n, depth) => {
    // A collection field's content on a template: one purple row, not editable.
    if (n.hasAttribute("data-cms-marker")) {
      return [el("div", { className: "dz-nav-row bound", style: { paddingLeft: 6 + depth * 12 + "px" }, title: "Comes from each item's content",
        onmouseenter: () => { D.hovered = n; D.paintOverlay(); }, onmouseleave: () => { D.hovered = null; D.paintOverlay(); } },
        el("span", { className: "dz-caret" }, ""), el("span", { className: "dz-nav-ico" }, "\u25c8"),
        el("span", {}, n.getAttribute("data-cms-label")), el("span", { className: "dz-nav-cls" }, "CMS field"))];
    }
    const kids = [...n.children].filter((c) => !c.hasAttribute("data-cms-ignore"));
    const isOpen = !collapsed.has(n);
    const r = el("div", {
      className: "dz-nav-row" + (n === D.selected ? " sel" : ""),
      style: { paddingLeft: 6 + depth * 12 + "px" },
      draggable: true,
      onclick: () => D.select(n, { scroll: true }),
      onmouseenter: () => { D.hovered = n; D.paintOverlay(); },
      onmouseleave: () => { D.hovered = null; D.paintOverlay(); },
    },
      el("span", { className: "dz-caret", onclick: (e) => { e.stopPropagation(); isOpen ? collapsed.add(n) : collapsed.delete(n); paintList(); } }, kids.length ? (isOpen ? "▾" : "▸") : ""),
      el("span", { className: "dz-nav-ico" }, ICON[elementType(n)] || "□"),
      el("span", {}, elementType(n)),
      el("span", { className: "dz-nav-cls" }, customClasses(n).join(" ")));
    r.addEventListener("dragstart", (e) => { dragging = n; e.dataTransfer.effectAllowed = "move"; });
    r.addEventListener("dragover", (e) => {
      if (!dragging || dragging === n || dragging.contains(n)) return;
      e.preventDefault();
      const y = e.offsetY / r.offsetHeight;
      const where = y < 0.3 ? "before" : y > 0.7 || !canContain(n) ? "after" : "inside";
      r.dataset.where = where;
      r.className = `dz-nav-row drop-${where}` + (n === D.selected ? " sel" : "");
    });
    r.addEventListener("dragleave", () => { r.className = "dz-nav-row" + (n === D.selected ? " sel" : ""); });
    r.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragging) D.move(dragging, n, r.dataset.where || "after");
      dragging = null;
    });
    const out = [r];
    if (isOpen) for (const c of kids) out.push(...row(c, depth + 1));
    return out;
  };

  /** A component instance: one green row; its tree only while it's being edited. */
  const compRow = (w) => {
    const name = w.getAttribute("data-cms-component");
    if (D.editingComponent === name) return [...w.children].flatMap((c) => row(c, 0));
    return [el("div", {
      className: "dz-nav-row comp" + (D.selectedComponent === name ? " sel" : ""),
      style: { paddingLeft: "6px" },
      title: "Component \u2014 double-click to edit",
      onclick: () => { D.select(null); D.selectedComponent = name; D.refresh(); },
      ondblclick: () => D.editComponent(name),
      onmouseenter: () => { D.hovered = w; D.paintOverlay(); },
      onmouseleave: () => { D.hovered = null; D.paintOverlay(); },
    }, el("span", { className: "dz-caret" }, ""), el("span", { className: "dz-nav-ico" }, "\u25c6"),
      el("span", {}, D.componentLabel(name)), el("span", { className: "dz-nav-cls" }, "Component"))];
  };

  const paintList = () => {
    const nodes = D.bodyNodes().filter((n) => n.nodeType === 1);
    const comps = D.doc ? [...D.doc.querySelectorAll("[data-cms-component]")] : [];
    const start = D.doc?.getElementById("cms-start");
    const before = comps.filter((w) => start && (w.compareDocumentPosition(start) & 4));
    const after = comps.filter((w) => !before.includes(w));
    list.replaceChildren(...before.flatMap(compRow), ...(D.editingComponent ? [] : nodes.flatMap((n) => row(n, 0))), ...after.flatMap(compRow));
    list.querySelector(".dz-nav-row.sel")?.scrollIntoView({ block: "nearest" });
  };
  paintList();
  return [el("div", { className: "dz-ph" }, "Navigator", el("span", { className: "dz-status" }, "drag to move")), list];
}

/* ---------------------------------------------------------------- Pages -- */

const CORE = new Set(["index", "about", "work", "collaborate", "404"]);

function pagesPanel(D) {
  const newPage = async () => {
    const name = el("input", { type: "text", placeholder: "e.g. Services", autofocus: true });
    const from = el("select", {}, el("option", { value: "" }, "Blank page"), ...D.allPages().filter((p) => p.layout !== "utility").map((p) => el("option", { value: p.slug }, `Copy of ${D.pageName(p)}`)));
    const result = await modal({
      title: "New page",
      body: el("div", { className: "fields" },
        el("div", { className: "field" }, el("label", { className: "field-label" }, "Page name"), name),
        el("div", { className: "field" }, el("label", { className: "field-label" }, "Start from"), from)),
      actions: [{ label: "Cancel", value: null }, { label: "Create page", primary: true, onClick: () => {
        const slug = slugify(name.value);
        if (!slug) { toast("Name the page first.", "error"); return undefined; }
        const taken = D.allPages().some((p) => p.slug === slug) ? "a page" : takenAddress(slug);
        if (taken) { toast(`/${slug}/ is already ${taken} \u2014 choose another name.`, "error"); return undefined; }
        return { slug, title: name.value.trim(), from: from.value };
      } }],
    });
    if (!result) return;
    const base = D.allPages().find((p) => p.slug === (result.from || "about"));
    const rec = clone(Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith("__"))));
    Object.assign(rec, {
      slug: result.slug,
      navActive: [],
      projectList: undefined,
      seo: { title: result.title },
      bodyHtml: result.from ? (D.edits.get(base.slug) ?? base.bodyHtml)
        : `<section class="section"><div class="container"><h1 class="case-heading">${result.title.replace(/[<&]/g, "")}</h1></div></section>`,
      updatedAt: undefined,
    });
    delete rec.projectList;
    delete rec.updatedAt;
    D.newPages.set(rec.slug, rec);
    D.markDirty();
    D.openPage(rec.slug);
  };

  // Custom code, as in Webflow's page settings: for one page, or for every
  // item page a template lays out.
  const codeDialog = async (title, hint, cur) => {
    const area = (value) => el("textarea", { className: "dz-code", rows: 9, spellcheck: false, value, style: { width: "100%", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px" } });
    const head = area(cur.customHead), end = area(cur.customBodyEnd);
    const result = await modal({
      title,
      body: el("div", { className: "fields" },
        el("p", { className: "hint" }, hint),
        el("div", { className: "field" }, el("label", { className: "field-label" }, "Inside <head>"), head),
        el("div", { className: "field" }, el("label", { className: "field-label" }, "Before </body>"), end)),
      actions: [{ label: "Cancel", value: null }, { label: "Done", primary: true, value: true }],
    });
    if (!result || (head.value === cur.customHead && end.value === cur.customBodyEnd)) return null;
    return { customHead: head.value, customBodyEnd: end.value };
  };
  const templateCode = async (t) => {
    const code = await codeDialog(`${t.name}: custom code`,
      "Code for every page this template lays out. It comes after the site-wide code from Site settings \u2192 Custom code; each item can add its own in its CMS settings. It runs on the site as-is and is not run inside the CMS.",
      D.templateShell(t.slug));
    if (!code) return;
    D.templateCode.set(t.slug, code);
    D.markDirty();
    toast("Custom code changed \u2014 Save to publish it.");
  };
  const pageCode = async (p) => {
    const code = await codeDialog(`${D.pageName(p)}: custom code`,
      "Code for this page only. It comes after the site-wide code from Site settings \u2192 Custom code. It runs on the site as-is and is not run inside the CMS.",
      D.pageShell(p.slug));
    if (!code) return;
    D.pageCode.set(p.slug, code);
    D.markDirty();
    toast("Custom code changed \u2014 Save to publish it.");
  };

  return [
    el("div", { className: "dz-ph" }, "Pages", el("button", { className: "dz-link", onclick: newPage }, "+ New page")),
    ...D.allPages().map((p) => el("div", { className: "dz-page" + (p.slug === D.page?.slug ? " sel" : ""), onclick: () => D.openPage(p.slug) },
      el("span", {}, D.pageName(p), D.edits.has(p.slug) || D.pageCode.has(p.slug) || D.newPages.has(p.slug) ? el("span", { className: "dot" }, "•") : null,
        el("br"), el("small", {}, p.slug === "index" ? "/" : p.slug === "404" ? "/404.html" : `/${p.slug}/`)),
      el("span", {},
        el("button", { className: "dz-link", title: "Custom code for this page", style: { marginRight: "8px" }, onclick: (e) => { e.stopPropagation(); pageCode(p); } }, "</>"),
        el("button", { className: "dz-link", title: "SEO and page settings", onclick: (e) => { e.stopPropagation(); D.go({ name: "pages", slug: p.slug }); } }, "⚙"),
        CORE.has(p.slug) ? null : el("button", { className: "dz-link", title: "Delete page", style: { marginLeft: "8px", color: "#ff7b7b" },
          onclick: async (e) => {
            e.stopPropagation();
            if (!(await confirmDialog(`Delete ${D.pageName(p)}?`, "The page is removed when you save. Links to it will break.", { ok: "Delete", danger: true }))) return;
            if (D.newPages.has(p.slug)) D.newPages.delete(p.slug); else D.deletedPages.add(p.slug);
            D.markDirty();
            if (D.page?.slug === p.slug) D.openPage("index");
          } }, "✕")))),
    el("div", { className: "dz-ph" }, "Styles"),
    el("div", { className: "dz-page" + (D.page?.slug === STYLE_GUIDE ? " sel" : ""), onclick: () => D.openPage(STYLE_GUIDE) },
      el("span", {}, "Style Guide", el("br"), el("small", {}, "Colors, fonts, tags and text styles"))),
    el("div", { className: "dz-ph" }, "CMS Collection pages"),
    ...D.templatePages().map((t) => el("div", { className: "dz-page" + (t.slug === D.page?.slug ? " sel" : ""), onclick: () => D.openPage(t.slug) },
      el("span", {}, t.name, D.edits.has(t.slug) || D.templateCode.has(t.slug) ? el("span", { className: "dot" }, "\u2022") : null, el("br"),
        el("small", {}, t.template === "projects" ? "/project/\u2026" : `${D.schemaOf(t.template)?.urlPrefix || "/"}\u2026`)),
      el("span", {},
        el("button", { className: "dz-link", title: "Custom code for this template page", onclick: (e) => { e.stopPropagation(); templateCode(t); } }, "</>"),
        el("button", { className: "dz-link", title: `Edit ${D.schemaOf(t.template)?.label} content`, style: { marginLeft: "8px" }, onclick: (e) => { e.stopPropagation(); D.go({ name: t.template }); } }, "\u2699")))),
    el("div", { className: "dz-sec" }, el("small", { style: { color: "#9b9b9b" } },
      "A template lays out every item of its collection. Purple parts show the item's own content; edit that content in the collection.")),
  ];
}

/* ------------------------------------------------------------ Variables -- */

function variablesPanel(D) {
  const isHex = (x) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(x).trim());
  const toHex6 = (x) => (x.length === 4 ? "#" + [...x.slice(1)].map((c) => c + c).join("") : x);
  const own = Object.keys(D.design.variables || {}).filter((k) => !D.parsed.variables.some((v) => v.name === k));
  const list = [...D.parsed.variables.map((v) => ({ ...v, original: true })), ...own.map((name) => ({ name, value: D.design.variables[name], original: false }))];

  // Which selectors use each variable (for "used by").
  const usedBy = new Map();
  for (const r of D.parsed.rules) for (const d of r.decls) for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) {
    if (!usedBy.has(m[1])) usedBy.set(m[1], new Set());
    usedBy.get(m[1]).add(r.selector);
  }
  for (const bp of Object.values(D.design.styles || {})) for (const [sel, props] of Object.entries(bp)) for (const v of Object.values(props)) for (const m of String(v).matchAll(/var\((--[\w-]+)/g)) {
    if (!usedBy.has(m[1])) usedBy.set(m[1], new Set());
    usedBy.get(m[1]).add(sel);
  }
  const kindOf = (val) => (VAR_TYPES.find((t) => t.id === typeOfValue(val)) || { group: "Other" }).group;

  const rows = list.map((v) => {
    const cur = D.design.variables?.[v.name] ?? v.value;
    const changed = v.original && v.name in (D.design.variables || {});
    const color = isHex(cur) || /^rgb|^hsl/i.test(cur);
    const sw = el("span", { className: "sw", style: color ? { background: cur } : { background: "#383838", color: "#bbb", fontSize: "10px", display: "grid", placeItems: "center" } }, color ? "" : /px|rem|em|%/.test(cur) ? "\u2194" : "Aa");
    const text = el("input", { type: "text", value: cur });
    const pick = color ? el("input", { type: "color", value: isHex(cur) ? toHex6(cur) : "#000000", style: { width: "24px", height: "24px", padding: "0", border: "0", background: "none" } }) : null;
    const setV = (val) => {
      D.design.variables = D.design.variables || {};
      if (v.original && (!val || val === v.value)) delete D.design.variables[v.name];
      else if (val) D.design.variables[v.name] = val;
      if (color) sw.style.background = val || v.value;
      D.styleChanged();
    };
    text.oninput = () => { setV(text.value.trim()); if (pick && isHex(text.value)) pick.value = toHex6(text.value.trim()); };
    if (pick) pick.oninput = () => { text.value = pick.value; setV(pick.value); };
    const users = [...(usedBy.get(v.name) || [])];
    const usedLine = users.length ? el("div", { className: "uses", title: users.join("\n") }, "Used by " + users.slice(0, 4).join(", ") + (users.length > 4 ? ` +${users.length - 4}` : "")) : null;
    const node = el("div", { className: "dz-var" + (changed ? " changed" : "") }, sw,
      el("div", {},
        el("div", { className: "name" }, v.name.replace(/^--/, ""), v.original ? null : el("span", { className: "uses" }, "  \u00b7 yours")),
        el("div", { className: "dz-color", style: { margin: "4px 0" } }, pick, text),
        el("div", { className: "uses" }, v.original ? `${D.varUses.get(v.name) || 0} uses in the site's styles \u00b7 original ${v.value}` : "Use it from any colour or size field (var)",
          changed ? el("button", { className: "dz-link", style: { marginLeft: "6px" }, onclick: () => { delete D.design.variables[v.name]; D.styleChanged(); refresh(); } }, "reset") : null,
          !v.original ? el("button", { className: "dz-link", style: { marginLeft: "6px", color: "#ff7b7b" }, onclick: () => { delete D.design.variables[v.name]; D.styleChanged(); refresh(); } }, "delete") : null),
        usedLine));
    return { kind: kindOf(cur), node };
  });
  const grouped = [...VAR_TYPES.map((t) => t.group), "Other"].flatMap((k) => {
    const g = rows.filter((r) => r.kind === k);
    return g.length ? [el("div", { className: "dz-sec-title dz-var-group" }, `${k} \u00b7 ${g.length}`), ...g.map((r) => r.node)] : [];
  });

  // Create a variable, Webflow-style: name, type, value.
  const name = el("input", { type: "text", placeholder: "name, e.g. accent" });
  const type = el("select", {}, ...VAR_TYPES.map((t) => el("option", { value: t.id }, t.label)));
  const value = el("input", { type: "text", placeholder: "#146ef5" });
  type.onchange = () => { value.placeholder = VAR_TYPES.find((t) => t.id === type.value).example; };
  const add = () => {
    const n = "--" + name.value.trim().toLowerCase().replace(/^--/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (n === "--") return toast("Name the variable.", "error");
    if (list.some((v) => v.name === n)) return toast(`${n} already exists.`, "error");
    const val = value.value.trim();
    if (!val || /[{};<>]/.test(val)) return toast("Give it a value.", "error");
    if (!fitsType(type.value, val)) { const t = VAR_TYPES.find((x) => x.id === type.value); return toast(`"${val}" isn't a ${t.label.toLowerCase()} (e.g. ${t.example}).`, "error"); }
    D.design.variables = D.design.variables || {};
    D.design.variables[n] = val;
    D.styleChanged();
    refresh();
  };
  value.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  const refresh = () => { const box = document.querySelector(".dz-panel"); if (box) box.replaceChildren(...variablesPanel(D)); };
  return [el("div", { className: "dz-ph" }, "Variables"),
    el("div", { className: "dz-sec" }, el("div", { className: "dz-sec-title" }, "New variable"),
      el("div", { className: "dz-field" }, name), el("div", { className: "dz-color" }, type, value, el("button", { className: "dz-btn", onclick: add }, "Add"))),
    ...grouped,
    el("div", { className: "dz-sec" }, el("small", { style: { color: "#9b9b9b" } }, "Changing a variable changes every style that uses it, on every page. See them all together in the Style Guide (Pages \u203a Styles)."))];
}

/* ------------------------------------------------------ Style selectors -- */

function stylesPanel(D) {
  const search = el("input", { type: "text", className: "dz-search", placeholder: "Search tags and classes" });
  const list = el("div");
  const used = new Map();
  for (const n of D.bodyNodes().filter((x) => x.nodeType === 1)) {
    for (const x of [n, ...n.querySelectorAll("[class]")]) for (const c of customClasses(x)) used.set(c, (used.get(c) || 0) + 1);
  }
  const all = [...D.classes.keys()].filter((c) => !/^w-/.test(c)).sort();
  const hasRule = (t) => D.index.has(t) || Object.values(D.design.styles || {}).some((bp) => t in bp);
  const tags = Object.keys(TAG_SELECTORS).filter(hasRule);
  const pick = (selector) => { D.selected = null; D.styleTarget = selector; D.paintOverlay(); D.paintRight(); paint(); };
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const tagRows = tags.filter((t) => !q || TAG_SELECTORS[t].toLowerCase().includes(q) || t === q).map((t) => {
      let n = 0;
      try { n = D.doc?.querySelectorAll(t).length || 0; } catch { /* none */ }
      return el("div", { className: "dz-cls tag" + (D.styleTarget === t ? " sel" : ""), title: `<${t}> on every page`, onclick: () => pick(t) },
        el("span", {}, TAG_SELECTORS[t]), el("span", { className: "n" }, n ? `${n} on page` : ""));
    });
    list.replaceChildren(
      ...(tagRows.length ? [el("div", { className: "dz-sec-title dz-var-group" }, "Tags"), ...tagRows, el("div", { className: "dz-sec-title dz-var-group" }, "Classes")] : []),
      ...all.filter((c) => !q || c.includes(q)).slice(0, 400).map((c) => el("div", {
      className: "dz-cls" + (D.styleTarget === "." + c ? " sel" : ""),
      title: `${D.classes.get(c).length} rules`,
      onclick: () => {
        D.selected = null;
        D.styleTarget = "." + c;
        D.paintOverlay();
        D.paintRight();
        paint();
      },
    }, el("span", {}, c), el("span", { className: "n" }, used.has(c) ? `${used.get(c)} on page` : ""))));
  };
  search.oninput = paint;
  paint();
  return [el("div", { className: "dz-ph" }, "Style selectors", el("span", { className: "dz-status" }, `${tags.length} tags \u00b7 ${all.length} classes`)), search, list];
}

function sessionGet(k) { try { return sessionStorage.getItem("cms:dz:" + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem("cms:dz:" + k, v); } catch { /* private mode */ } }
