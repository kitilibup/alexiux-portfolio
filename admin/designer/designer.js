/**
 * The Designer - a visual page builder modelled on Webflow's Designer.
 *
 *   top      page, breakpoints, undo/redo, preview, save
 *   left     Add · Navigator · Pages (with the Style Guide) · Variables · Style selectors
 *   canvas   the real page with the site's CSS and the design overrides live
 *   right    Style (classes, states, every property per breakpoint) · Settings
 *   bottom   breadcrumbs
 *
 * Structure and text are edited in the page's markup (saved through the
 * Webflow serializer, so untouched markup keeps its bytes). Styles go to
 * content/settings/design.json and are layered over Webflow's CSS by
 * admin/lib/css-model.js - in the canvas exactly as in the build.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, confirmDialog, clone, assetUrl, toSiteHtml, fromSiteHtml } from "../lib/dom.js?v=6600ab59";
import { serializeNode as serializeOne, serializeWithBindings } from "../lib/webflow-html.js?v=6600ab59";
// The Designer saves bindings (data-cms-*) along with the markup.
const serializeNode = (n) => serializeWithBindings(() => serializeOne(n));
import { renderComponent, unrenderComponent, pageIdOf } from "../lib/components.js?v=6600ab59";
import { templateForDesigner, withPositions } from "../lib/project-model.js?v=6600ab59";
import { parseCss, applyDesign, classIndex, variableUses, BREAKPOINTS } from "../lib/css-model.js?v=6600ab59";
import { applyFallbacks, fontsCss } from "../lib/fonts.js?v=6600ab59";
import { store, commit, serializeRecord, siteUrl, pageLabel } from "../store.js?v=6600ab59";
import { elementType, customClasses, selectorFor, selectorIndex, bpLabel, canContain as canContainEl } from "./model.js?v=6600ab59";
import { leftPanels } from "./panels-left.js?v=6600ab59";
import { stylePanel } from "./panel-style.js?v=6600ab59";
import { settingsPanel } from "./panel-settings.js?v=6600ab59";
import { STYLE_GUIDE, styleGuidePage, paintStyleGuideMeta } from "./styleguide.js?v=6600ab59";
import { displayBindings, clearBindings, withSource, mirrorTarget } from "./bindings.js?v=6600ab59";
import { fieldTypes, itemUrl } from "../lib/collections.js?v=6600ab59";

export const designerState = { dirty: false, save: null };

/** Widths Webflow previews each breakpoint at. */
const PREVIEW_WIDTH = { base: null, tablet: 768, landscape: 568, portrait: 320, lg: 1280, xl: 1440, xxl: 1920 };
const BP_ICON = {
  xxl: '<svg width="16" height="12" viewBox="0 0 16 12"><rect x=".5" y=".5" width="15" height="9" rx="1" fill="none" stroke="currentColor"/><path d="M5 11.5h6" stroke="currentColor"/><text x="8" y="7" font-size="5" text-anchor="middle" fill="currentColor">XL</text></svg>',
  xl: '<svg width="16" height="12" viewBox="0 0 16 12"><rect x=".5" y=".5" width="15" height="9" rx="1" fill="none" stroke="currentColor"/><path d="M5 11.5h6" stroke="currentColor"/><text x="8" y="7" font-size="5" text-anchor="middle" fill="currentColor">L</text></svg>',
  lg: '<svg width="16" height="12" viewBox="0 0 16 12"><rect x=".5" y=".5" width="15" height="9" rx="1" fill="none" stroke="currentColor"/><path d="M5 11.5h6" stroke="currentColor"/><text x="8" y="7" font-size="5" text-anchor="middle" fill="currentColor">M</text></svg>',
  base: '<svg width="16" height="12" viewBox="0 0 16 12"><rect x=".5" y=".5" width="15" height="9" rx="1" fill="none" stroke="currentColor"/><path d="M5 11.5h6" stroke="currentColor"/></svg>',
  tablet: '<svg width="12" height="14" viewBox="0 0 12 14"><rect x=".5" y=".5" width="11" height="13" rx="1.5" fill="none" stroke="currentColor"/><circle cx="6" cy="11.3" r=".8" fill="currentColor"/></svg>',
  landscape: '<svg width="16" height="10" viewBox="0 0 16 10"><rect x=".5" y=".5" width="15" height="9" rx="1.5" fill="none" stroke="currentColor"/><circle cx="13.3" cy="5" r=".8" fill="currentColor"/></svg>',
  portrait: '<svg width="10" height="14" viewBox="0 0 10 14"><rect x=".5" y=".5" width="9" height="13" rx="1.5" fill="none" stroke="currentColor"/><circle cx="5" cy="11.5" r=".8" fill="currentColor"/></svg>',
};

/*
 * Elements an animation hides when the page loads (the "View more" circle on
 * project cards, slide-ins...). The canvas doesn't run animations, so it shows
 * them faded with a dashed outline - in place, selectable, not covering the
 * content - and fully on hover (or when their parent is hovered). Preview
 * hides them as the live site does.
 */
export function hiddenAtLoad(src) {
  const out = new Set(['[style*="opacity:0"]', '[style*="opacity: 0"]']);
  try {
    const data = JSON.parse(String(src).slice(String(src).indexOf("window.SITE_INTERACTIONS = ") + 27).replace(/;\s*$/, ""));
    for (const list of Object.values(data.actionLists || {})) {
      if (!list.useFirstGroupAsInitialState) continue;
      for (const it of list.actionItemGroups?.[0]?.actionItems || []) {
        if (it.actionTypeId !== "STYLE_OPACITY" || Number(it.config.value) !== 0) continue;
        const t = it.config.target || {};
        if (t.selector) out.add(t.selector);
        else if (t.id) { const id = String(t.id).split("|").pop(); out.add(`[data-w-id="${id}"]`); out.add(`[data-ix="${id}"]`); }
      }
    }
  } catch { /* no interactions: inline styles only */ }
  return [...out];
}
function animHiddenCss(sels = []) {
  if (!sels.length) return "";
  const on = (suffix = "") => sels.map((s) => `html:not(.cms-preview-mode) ${s}${suffix}`).join(",");
  const reveal = sels.map((s) => `html:not(.cms-preview-mode) :hover > ${s}`).join(",");
  return `${on()}{opacity:.3!important;outline:1px dashed rgba(20,110,245,.55);outline-offset:-1px;transition:opacity .15s}` +
    `${on(":hover")},${reveal}{opacity:1!important}`;
}

const CANVAS_CSS = `
html{scroll-behavior:auto}
.w-condition-invisible{outline:1px dashed rgba(123,92,255,.6)}
[data-cms-ignore]{all:initial}
#cms-overlay{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none}
#cms-overlay .box{position:absolute;pointer-events:none;box-sizing:border-box}
#cms-overlay .hover{outline:1px solid #146ef5;outline-offset:-1px}
#cms-overlay .sel{outline:2px solid #146ef5;outline-offset:-1px}
#cms-overlay .tag{position:absolute;left:-2px;top:-18px;height:18px;padding:0 6px;font:500 11px/18px -apple-system,BlinkMacSystemFont,sans-serif;color:#fff;background:#146ef5;white-space:nowrap;border-radius:2px 2px 0 0}
#cms-overlay .tag.below{top:auto;bottom:-18px;border-radius:0 0 2px 2px}
#cms-overlay .hover .tag{background:#146ef5;opacity:.85}
#cms-overlay .comp{outline:1px solid #2bbf6a;outline-offset:-1px}
#cms-overlay .comp .tag{background:#2bbf6a}
#cms-overlay .sel.in-comp{outline-color:#2bbf6a}
#cms-overlay .sel.in-comp .tag{background:#2bbf6a}
[data-cms-dim]{opacity:.28!important;pointer-events:none!important;transition:opacity .15s}
#cms-overlay .bound{outline:1px dashed #a678ff;outline-offset:-1px;background:rgba(166,120,255,.06)}
#cms-overlay .bound .tag{background:#7b5cff}
[data-cms-text],[data-cms-src],[data-cms-list],[data-cms-collection],[data-cms-href],[data-cms-bg]{box-shadow:inset 0 0 0 1px rgba(166,120,255,.55)}
[data-cms-dz-empty]{opacity:.45}
.cms-dz-hidden{display:none!important}
html.cms-preview-mode [data-cms-text],html.cms-preview-mode [data-cms-src],html.cms-preview-mode [data-cms-list],html.cms-preview-mode [data-cms-collection],html.cms-preview-mode [data-cms-href],html.cms-preview-mode [data-cms-bg]{box-shadow:none}
[contenteditable="true"]{outline:none;cursor:text}
.cms-preview-mode #cms-overlay{display:none}
`;

/* ------------------------------------------------------------------ view -- */

export async function designerView(slug, { go }) {
  const D = {
    go,
    pages: store.items.pages,
    page: null,
    bp: sessionGet("bp") || "base",
    state: "",
    selected: null,
    hovered: null,
    styleTarget: null,      // a class or tag selector chosen in Style selectors
    edits: new Map(),       // slug -> edited bodyHtml (not saved yet)
    templateCode: new Map(), // template slug -> { customHead, customBodyEnd } (not saved yet)
    pageCode: new Map(), // static page slug -> { customHead, customBodyEnd } (not saved yet)
    newPages: new Map(),    // slug -> record created in the Designer
    deletedPages: new Set(),
    design: null,
    savedDesign: null,
    preview: false,
    editingComponent: null,
    componentEdits: new Map(),
    sample: {},               // collection -> slug of the item a template previews
    clipboard: null,
    history: [],
    hi: -1,
  };

  // The stylesheet and design data the canvas needs.
  const cssFile = (CONFIG.siteCss || []).map((h) => h.replace(/^(\.\.\/)+/, "")).find((h) => !/fonts\.css$/.test(h));
  const [css, designRaw, ixRaw] = await Promise.all([
    store.backend.readFile(cssFile),
    store.backend.readJson("content/settings/design.json").catch(() => ({ variables: {}, styles: {} })),
    store.backend.readFile("assets/js/interactions.js").catch(() => ""),
  ]);
  D.animHidden = hiddenAtLoad(ixRaw);
  D.css = css;
  D.parsed = parseCss(css);
  D.index = selectorIndex(D.parsed.rules);
  D.classes = classIndex(D.parsed.rules);
  D.varUses = variableUses(css);
  D.design = { variables: {}, styles: {}, ...designRaw };
  D.savedDesign = JSON.stringify(D.design);
  D.fonts = store.items.settings?.[0]?.fonts || {};

  /* --------------------------------------------------------- layout -- */

  const frame = el("iframe", { className: "dz-frame", title: "Canvas", attrs: { sandbox: "allow-same-origin" } });
  const frameWrap = el("div", { className: "dz-frame-wrap" }, frame);
  const canvas = el("div", { className: "dz-canvas" }, frameWrap);
  const crumbs = el("div", { className: "dz-crumbs" });
  const status = el("span", { className: "dz-status" });
  const saveBtn = el("button", { className: "dz-btn primary", disabled: true, title: "Save (⌘S)" }, "Save");
  const undoBtn = el("button", { className: "dz-btn", title: "Undo (⌘Z)", disabled: true }, "↶");
  const redoBtn = el("button", { className: "dz-btn", title: "Redo (⇧⌘Z)", disabled: true }, "↷");
  const widthLabel = el("span", { className: "dz-width" });
  const pageSelect = el("select", { className: "dz-page-select", title: "Page" });
  // Shown while a component is being edited (Webflow's component bar).
  const banner = el("div", { className: "dz-comp-banner", hidden: true });
  // On a collection template: which item fills it (Webflow's item switcher).
  const sampleSelect = el("select", { className: "dz-page-select", title: "Item shown in the template", hidden: true });
  sampleSelect.onchange = () => { D.sample[D.page.template] = sampleSelect.value; loadPage(D.page); };
  const right = el("div", { className: "dz-right" });
  const panel = el("div", { className: "dz-panel" });
  const rail = el("div", { className: "dz-rail" });

  const bpButtons = el("div", { className: "dz-bps", attrs: { role: "group", "aria-label": "Breakpoints" } },
    ...["xxl", "xl", "lg", "base", "tablet", "landscape", "portrait"].map((id) => {
      const b = el("button", {
        className: "dz-bp" + (id === "base" ? " base-bp" : ""),
        title: `${bpLabel(id)}${id === "base" ? " — base breakpoint: styles here apply to all" : id === "tablet" || id === "landscape" || id === "portrait" ? " — styles here apply to this size and smaller" : " — styles here apply to this size and larger"}`,
        dataset: { bp: id },
        onclick: () => setBp(id),
      });
      b.innerHTML = BP_ICON[id];
      return b;
    }));

  const previewBtn = el("button", { className: "dz-btn", title: "Preview: hide outlines and click through (P)", onclick: () => togglePreview() }, "◎ Preview");

  const top = el("div", { className: "dz-top" },
    el("button", { className: "dz-btn", title: "Back to the CMS", onclick: () => go({ name: "pages" }) }, "←"),
    pageSelect, sampleSelect,
    el("span", { className: "grow" }),
    bpButtons, widthLabel,
    el("span", { className: "grow" }),
    undoBtn, redoBtn, previewBtn,
    el("button", { className: "dz-btn", title: "Open the published page", onclick: () => window.open(siteUrl(pagePath(D.page)), "_blank", "noopener") }, "↗"),
    status, saveBtn);

  canvas.append(banner);
  const root = el("div", { className: "dz" }, top, rail, panel, canvas, crumbs, right);
  // A click anywhere in the Designer outside the canvas ends text editing (as
  // in Webflow), so the typed text is kept and the panels act on it.
  root.addEventListener("mousedown", (e) => {
    if (D.editingText && !canvas.contains(e.target)) finishTextEdit();
  }, true);

  /* ------------------------------------------------------- canvas -- */

  D.doc = null;
  D.win = null;

  /** The page's own elements, between the markers (navbar/footer are around them). */
  D.bodyNodes = () => {
    if (!D.doc) return [];
    const start = D.doc.getElementById("cms-start");
    const out = [];
    for (let n = start?.nextSibling; n && n.id !== "cms-end"; n = n.nextSibling) out.push(n);
    return out;
  };
  D.componentOf = (n) => n?.closest?.("[data-cms-component]") || null;
  D.boundOf = (n) => n?.closest?.("[data-cms-marker]") || null;
  D.isEditable = (n) => {
    if (!n || n.nodeType !== 1 || n.closest?.("#cms-overlay") || n.hasAttribute("data-cms-component")) return false;
    // The Style Guide is for styling: only its samples can be selected.
    if (D.page?.virtual) return !!n.closest?.("[data-cms-sample]");
    // Collection List items after the first mirror it; edit the first one.
    if (n.closest?.("[data-cms-mirror]")) return false;
    // Content that comes from a collection field isn't edited on the canvas.
    if (D.boundOf(n)) return false;
    const comp = D.componentOf(n);
    if (comp) return D.editingComponent === comp.getAttribute("data-cms-component");
    if (D.editingComponent) return false;
    let top = n;
    while (top.parentNode && top.parentNode !== D.region()) top = top.parentNode;
    return D.bodyNodes().includes(top);
  };
  D.region = () => D.doc?.getElementById("cms-start")?.parentNode || null;

  /* Dynamic content: published items, and the item a template is showing. */
  D.assetUrl = (u) => (/^\//.test(u) ? assetUrl(u) : u);
  D.fieldType = (collection, path) => (store.schemas[collection] ? fieldTypes(store.schemas[collection])(path) : "text");
  D.collectionItems = (name) => {
    const sc = store.schemas[name];
    let items = (store.items[name] || []).filter((x) => !x.draft);
    if (name === "projects") items = withPositions(store.items.projects || []).filter((x) => !x.draft).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return items.map((x) => ({ ...x, __url: name === "projects" ? `/project/${x.slug}/` : sc?.urlPrefix ? itemUrl({ name, ...sc }, x) : "" }));
  };
  D.sampleItem = (name) => {
    const all = name === "projects" ? withPositions(store.items.projects || []) : store.items[name] || [];
    const pick = all.find((x) => x.slug === D.sample[name]) || all.find((x) => !x.draft) || all[0];
    if (!pick) return null;
    D.sample[name] = pick.slug;
    return { ...pick, __url: name === "projects" ? `/project/${pick.slug}/` : store.schemas[name]?.urlPrefix ? itemUrl({ name, ...store.schemas[name] }, pick) : "" };
  };

  const designedCss = () => rebaseCss(applyDesign(applyFallbacks(D.css, D.fonts), D.design));

  function pageShell(page) {
    const utility = page.layout === "utility";
    const styles = (String(page.head || "").concat(store.items.settings?.[0]?.customCode?.head || "", page.customHead || "").match(/<style>[\s\S]*?<\/style>/gi) || []).join("");
    const bodyClass = (page.bodyOpen || "").match(/class="([^"]*)"/)?.[1] || "";
    const pageId = pageIdOf(page.htmlOpen);
    const comp = (name) => {
      if (!name || !store.components[name]) return "";
      const src = D.componentEdits.get(name) ?? store.components[name].html;
      return `<div data-cms-component="${name}" style="display:contents">${toSiteHtml(renderComponent(src, { pageId }))}</div>`;
    };
    let body = toSiteHtml(D.edits.get(page.slug) ?? page.bodyHtml ?? "");
    if (page.template === "projects") {
      const projects = withPositions(store.items.projects || []);
      const sample = projects.find((p) => p.slug === D.sample.projects) || projects.find((p) => !p.draft) || projects[0];
      D.sample.projects = sample?.slug;
      body = toSiteHtml(templateForDesigner({ ...store.template, body: D.edits.get(page.slug) ?? store.template.body }, sample, projects));
    }
    return "<!doctype html><html class='w-mod-js'><head><meta charset='utf-8'>" +
      `<style id="cms-fonts">${rebaseCss(fontsCss(D.fonts))}</style>` +
      `<style id="cms-site">${designedCss()}</style>` + styles +
      `<style>${CANVAS_CSS}${animHiddenCss(D.animHidden)}</style></head><body class="${bodyClass}">` +
      (utility ? `<i id="cms-start" data-cms-ignore></i>${body}<i id="cms-end" data-cms-ignore></i>`
        : (store.partials.globalStyles || "") + (page.wrapperOpen || '<div class="page-wrapper">') +
          comp(page.navbar || "navbar-main") + `<i id="cms-start" data-cms-ignore></i>${body}<i id="cms-end" data-cms-ignore></i>` +
          (page.footer ? comp(page.footer) : page.footerHtml ? toSiteHtml(page.footerHtml) : "") + (page.wrapperClose || "</div>")) +
      '<div id="cms-overlay" data-cms-ignore></div></body></html>';
  }

  function loadPage(page) {
    D.editingComponent = null;
    D.selectedComponent = null;
    banner.hidden = true;
    D.page = page;
    D.selected = null;
    D.hovered = null;
    sessionSet("page", page.slug);
    paintPageSelect();
    let ready = false;
    const init = () => {
      if (ready || !frame.contentDocument?.getElementById("cms-overlay")) return;
      ready = true;
      D.doc = frame.contentDocument;
      D.win = frame.contentWindow;
      wireCanvas();
      D.doc.documentElement.classList.toggle("cms-preview-mode", !!D.preview);
      D.__bindJournal = [];
      displayBindings(D);
      if (D.hi < 0 || D.history[D.hi]?.slug !== page.slug) record(true);
      D.refresh();
      if (page.virtual) { paintStyleGuideMeta(D); D.win.addEventListener("resize", () => paintStyleGuideMeta(D)); }
    };
    frame.addEventListener("load", init, { once: true });
    const poll = setInterval(() => { init(); if (ready) clearInterval(poll); }, 50);
    setTimeout(() => clearInterval(poll), 15000);
    frame.srcdoc = pageShell(page);
  }

  /** Replace the live stylesheet after a style change. */
  let cssTimer = null;
  D.refreshCss = () => {
    clearTimeout(cssTimer);
    cssTimer = setTimeout(() => {
      const tag = D.doc?.getElementById("cms-site");
      if (tag) tag.textContent = designedCss();
      paintOverlay();
      if (D.page?.virtual) paintStyleGuideMeta(D);
    }, 60);
  };

  /* ------------------------------------------------------ overlay -- */

  const overlay = () => D.doc?.getElementById("cms-overlay");
  const label = (n) => {
    const cls = customClasses(n);
    return elementType(n) + (cls.length ? ` · ${cls.join(".")}` : "");
  };

  function box(n, kind) {
    const r = n.getBoundingClientRect();
    const sx = D.win.scrollX, sy = D.win.scrollY;
    const b = D.doc.createElement("div");
    b.className = `box ${kind}`;
    Object.assign(b.style, { left: r.left + sx + "px", top: r.top + sy + "px", width: Math.max(r.width, 1) + "px", height: Math.max(r.height, 1) + "px" });
    const t = D.doc.createElement("div");
    t.className = "tag" + (r.top < 20 ? " below" : "");
    t.textContent = label(n);
    b.appendChild(t);
    return b;
  }

  function paintOverlay() {
    const o = overlay();
    if (!o) return;
    o.replaceChildren();
    if (D.preview) return;
    if (D.hovered && D.hovered !== D.selected && D.hovered.isConnected) {
      if (D.hovered.hasAttribute("data-cms-component")) {
        const b = box(D.hovered.firstElementChild || D.hovered, "comp");
        b.querySelector(".tag").textContent = `${store.components[D.hovered.getAttribute("data-cms-component")]?.label} \u00b7 Component \u00b7 double-click to edit`;
        o.appendChild(b);
      } else if (D.hovered.hasAttribute("data-cms-marker")) {
        const kids = [...D.hovered.children];
        const target = kids.length === 1 ? kids[0] : kids.length ? D.hovered.parentElement : D.hovered.parentElement;
        const b = box(target, "bound");
        b.querySelector(".tag").textContent = `${D.hovered.getAttribute("data-cms-label")} \u00b7 from the CMS \u00b7 edit it in ${store.schemas[D.hovered.getAttribute("data-cms-from") || D.page.template]?.label || "the collection"}`;
        o.appendChild(b);
      } else o.appendChild(box(D.hovered, "hover"));
    }
    if (D.selectedComponent && !D.editingComponent) {
      const w = D.doc.querySelector(`[data-cms-component="${D.selectedComponent}"]`);
      if (w?.firstElementChild) { const b = box(w.firstElementChild, "sel in-comp"); b.querySelector(".tag").textContent = `${store.components[D.selectedComponent]?.label} \u00b7 Component`; o.appendChild(b); }
    }
    if (D.selected?.isConnected) o.appendChild(box(D.selected, "sel" + (D.componentOf(D.selected) ? " in-comp" : "")));
  }
  D.paintOverlay = paintOverlay;

  /* ---------------------------------------------------- selection -- */

  D.select = (n, { scroll = false } = {}) => {
    if (n && !D.isEditable(n)) n = null;
    if (D.editingText && D.editingText !== n) finishTextEdit();
    if (n !== D.selected) D.selectorLevel = null;
    D.selected = n;
    D.styleTarget = null;
    if (n && scroll) n.scrollIntoView({ block: "nearest", behavior: "auto" });
    D.refresh();
  };

  D.refresh = () => {
    paintOverlay();
    paintCrumbs();
    left.refresh();
    paintRight();
    paintHistory();
    paintWidth();
  };

  function paintCrumbs() {
    crumbs.replaceChildren();
    const chain = [];
    for (let n = D.selected; n && D.isEditable(n); n = n.parentElement) chain.unshift(n);
    crumbs.append(el("button", { className: "dz-crumb", onclick: () => D.select(null) }, "Body"));
    for (const [i, n] of chain.entries()) {
      crumbs.append(el("span", { className: "dz-crumb-sep" }, "›"),
        el("button", { className: "dz-crumb" + (i === chain.length - 1 ? " last" : ""), onclick: () => D.select(n, { scroll: true }),
          onmouseenter: () => { D.hovered = n; paintOverlay(); } }, label(n)));
    }
  }

  /* ------------------------------------------------- text editing -- */

  D.editingText = null;
  function startTextEdit(n) {
    finishTextEdit();
    D.editingText = n;
    n.setAttribute("contenteditable", "true");
    n.focus();
    const r = D.doc.createRange();
    r.selectNodeContents(n);
    const s = D.doc.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }
  function finishTextEdit() {
    const n = D.editingText;
    if (!n) return;
    D.editingText = null;
    D.textDirty = false;
    n.removeAttribute("contenteditable");
    // Bold/italic typed with shortcuts become Webflow's tags.
    for (const [from, to] of [["b", "strong"], ["i", "em"]]) {
      for (const x of n.querySelectorAll(from)) { const y = D.doc.createElement(to); while (x.firstChild) y.appendChild(x.firstChild); x.replaceWith(y); }
    }
    for (const sp of n.querySelectorAll("span[style]")) sp.replaceWith(...sp.childNodes);
    D.changed();
  }

  /* ---------------------------------------------------- events -- */

  function wireCanvas() {
    const doc = D.doc;
    doc.addEventListener("mousemove", (e) => {
      if (D.preview) return;
      const t0 = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      const t = mirrorTarget(t0) || t0;
      const hit = D.isEditable(t) ? t : D.boundOf(t) || (!D.editingComponent ? D.componentOf(t) : null);
      if (hit !== D.hovered) { D.hovered = hit; paintOverlay(); }
    });
    doc.addEventListener("mouseleave", () => { D.hovered = null; paintOverlay(); });
    doc.addEventListener("click", (e) => {
      if (D.preview) { e.preventDefault(); return; }
      const t = mirrorTarget(e.target) || e.target;
      if (D.editingText && D.editingText.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      const bound = D.boundOf(t);
      if (bound) {
        const sc = store.schemas[bound.getAttribute("data-cms-from") || D.page.template];
        toast(`${bound.getAttribute("data-cms-label")} comes from each ${sc?.singular?.toLowerCase() || "item"}'s content \u2014 edit it in ${sc?.label || "the collection"}. Style it by selecting the element around it.`);
        return;
      }
      const comp = D.componentOf(t);
      if (comp && !D.isEditable(t)) {
        if (D.editingComponent) { D.exitComponent(); return; }
        D.select(null);
        D.selectedComponent = comp.getAttribute("data-cms-component");
        D.refresh();
        return;
      }
      if (D.editingComponent && !comp) { D.exitComponent(); return; }
      D.selectedComponent = null;
      D.select(D.isEditable(t) ? t : null);
    }, true);
    doc.addEventListener("dblclick", (e) => {
      const t = e.target;
      if (D.page?.virtual) return;
      const comp = D.componentOf(t);
      if (comp && !D.editingComponent) { D.editComponent(comp.getAttribute("data-cms-component"), t); return; }
      if (!D.isEditable(t)) return;
      const textual = t.closest("h1,h2,h3,h4,h5,h6,p,li,a,blockquote,figcaption,span,strong,em,label,.w-richtext,div");
      const boundText = t.closest("[data-cms-text]");
      if (boundText && D.isEditable(boundText)) {
        D.select(boundText);
        toast(`This text comes from the ${boundText.getAttribute("data-cms-text")} field. Edit it in the collection, or unbind it in Settings to type here.`);
        return;
      }
      if (textual && D.isEditable(textual) && /\S/.test(textual.textContent) && !textual.querySelector("img,video,iframe,svg")) {
        D.select(textual);
        startTextEdit(textual);
      }
    });
    doc.addEventListener("keydown", onKey, true);
    // Typing is a change: Save is offered at once (saving finishes the edit).
    doc.addEventListener("input", () => {
      if (!D.editingText) return;
      paintOverlay();
      D.textDirty = true;
      markDirty();
    });
    D.win.addEventListener("scroll", paintOverlay, { passive: true });
    D.win.addEventListener("resize", paintOverlay);
  }

  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const typing = D.editingText || /^(input|textarea|select)$/i.test(e.target?.tagName || "") || e.target?.isContentEditable;
    if (mod && k === "s") { e.preventDefault(); save(); return; }
    if (D.editingText) {
      if (k === "escape") { e.preventDefault(); finishTextEdit(); }
      if (k === "enter" && !e.shiftKey && !D.editingText.closest(".w-richtext")) { e.preventDefault(); finishTextEdit(); }
      return;
    }
    if (typing) return;
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === "y") { e.preventDefault(); redo(); return; }
    if (k === "p" && !mod) { e.preventDefault(); togglePreview(); return; }
    if (!D.selected) { if (k === "escape" && D.editingComponent) { e.preventDefault(); D.exitComponent(); } return; }
    if (k === "backspace" || k === "delete") { e.preventDefault(); D.remove(D.selected); return; }
    if (k === "escape") { e.preventDefault(); const p = D.selected.parentElement; if (D.isEditable(p)) D.select(p); else if (D.editingComponent) D.exitComponent(); else D.select(null); return; }
    if (k === "enter") { e.preventDefault(); startTextEdit(D.selected); return; }
    if (mod && k === "d") { e.preventDefault(); D.duplicate(D.selected); return; }
    if (mod && k === "c") { e.preventDefault(); D.clipboard = serializeNode(D.selected); toast("Copied"); return; }
    if (mod && k === "v" && D.clipboard) { e.preventDefault(); D.insertHtml(D.clipboard); return; }
    if (k === "arrowup" || k === "arrowdown") {
      e.preventDefault();
      const sib = k === "arrowup" ? D.selected.previousElementSibling : D.selected.nextElementSibling;
      if (sib && D.isEditable(sib)) D.select(sib, { scroll: true });
    }
  }

  /* -------------------------------------------- structure editing -- */

  const parseFragment = (html) => {
    const t = D.doc.createElement("template");
    t.innerHTML = toSiteHtml(html);
    return [...t.content.childNodes];
  };

  /** Insert markup the way Webflow does: inside a selected container, else after the selection. */
  D.insertHtml = (html, { inside } = {}) => {
    const nodes = parseFragment(html).filter((n) => n.nodeType === 1 || n.textContent.trim());
    if (!nodes.length) return null;
    const sel = D.selected;
    const canIn = sel && (inside ?? (sel.children.length === 0 || /section|container|w-layout-grid|w-row|w-col|w-inline-block/.test(sel.className))) && D.canContain(sel);
    if (canIn) sel.append(...nodes);
    else if (sel) sel.after(...nodes);
    else D.doc.getElementById("cms-end").before(...nodes);
    const first = nodes.find((n) => n.nodeType === 1);
    D.changed();
    D.select(first, { scroll: true });
    return first;
  };
  D.remove = (n) => {
    const next = n.nextElementSibling || n.previousElementSibling || n.parentElement;
    n.remove();
    D.changed();
    D.select(D.isEditable(next) ? next : null);
  };
  D.duplicate = (n) => {
    const copy = withSource(D, () => { const c = n.cloneNode(true); n.after(c); return c; });
    D.changed();
    D.select(copy);
  };
  D.move = (n, target, where) => {
    if (n === target || n.contains(target)) return;
    if (where === "inside") target.append(n);
    else if (where === "before") target.before(n);
    else target.after(n);
    D.changed();
    D.select(n);
  };

  /** Something in the page changed: remember it for undo and saving. */
  D.changed = () => withSource(D, changedNow);
  function changedNow() {
    if (D.page?.virtual) {
      toast("The Style Guide shows the site's styles \u2014 style its samples here, and add or edit content on a page.");
      loadPage(D.page);
      return;
    }
    if (D.editingComponent) {
      const w = D.doc.querySelector(`[data-cms-component="${D.editingComponent}"]`);
      const html = fromSiteHtml([...w.childNodes].map(serializeNode).join(""));
      D.componentEdits.set(D.editingComponent, unrenderComponent(html, { pageId: pageIdOf(D.page.htmlOpen) }));
    }
    D.edits.set(D.page.slug, currentBody());
    record();
    markDirty();
    setTimeout(() => D.refresh(), 0);
  }

  function currentBody() {
    return fromSiteHtml(D.bodyNodes().map(serializeNode).join(""));
  }

  /** A style changed (design.json): refresh the CSS, remember for undo. */
  let styleRecordTimer = null;
  D.styleChanged = () => {
    D.refreshCss();
    markDirty();
    clearTimeout(styleRecordTimer);
    styleRecordTimer = setTimeout(() => record(), 400);
  };

  /* ------------------------------------------------------ history -- */

  function snapshot() {
    return { slug: D.page.slug, body: D.edits.get(D.page.slug) ?? D.page.bodyHtml, design: JSON.stringify(D.design), comps: JSON.stringify([...D.componentEdits]) };
  }
  function record(force) {
    const s = snapshot();
    const cur = D.history[D.hi];
    if (!force && cur && cur.slug === s.slug && cur.body === s.body && cur.design === s.design && cur.comps === s.comps) return;
    D.history.splice(D.hi + 1);
    D.history.push(s);
    if (D.history.length > 200) D.history.shift();
    D.hi = D.history.length - 1;
    paintHistory();
  }
  function restore(s) {
    D.design = JSON.parse(s.design);
    const compsBefore = JSON.stringify([...D.componentEdits]);
    D.componentEdits = new Map(JSON.parse(s.comps || "[]"));
    if (compsBefore !== (s.comps || "[]")) { D.edits.set(s.slug, s.body); loadPage(D.findPage(s.slug) || D.page); markDirty(); return; }
    if (s.slug !== D.page.slug) {
      D.edits.set(s.slug, s.body);
      loadPage(D.findPage(s.slug) || D.page);
    } else {
      D.edits.set(s.slug, s.body);
      clearBindings(D);
      for (const n of D.bodyNodes()) n.remove();
      D.doc.getElementById("cms-end").before(...parseFragment(s.body));
      displayBindings(D);
      D.selected = null;
      D.refreshCss();
      D.refresh();
    }
    markDirty();
  }
  function undo() { if (D.hi > 0) { D.hi -= 1; restore(D.history[D.hi]); } }
  function redo() { if (D.hi < D.history.length - 1) { D.hi += 1; restore(D.history[D.hi]); } }
  undoBtn.onclick = undo;
  redoBtn.onclick = redo;
  function paintHistory() {
    undoBtn.disabled = D.hi <= 0;
    redoBtn.disabled = D.hi >= D.history.length - 1;
  }

  /* ----------------------------------------------------- components --
   * Webflow's model: a component instance is one block on the page;
   * double-click (or Edit component) to edit it, everything else dims, and
   * the change applies on every page that uses it.
   */
  D.editComponent = (name, target) => {
    if (D.editingText) finishTextEdit();
    D.editingComponent = name;
    D.selectedComponent = null;
    for (const n of D.bodyNodes()) if (n.nodeType === 1) n.setAttribute("data-cms-dim", "");
    for (const w of D.doc.querySelectorAll("[data-cms-component]")) {
      if (w.getAttribute("data-cms-component") !== name) for (const c of w.children) c.setAttribute("data-cms-dim", "");
    }
    banner.hidden = false;
    banner.replaceChildren(
      el("span", {}, "\u25c6 Editing ", el("b", {}, store.components[name]?.label || name), ` component \u2014 changes apply everywhere it's used. ${D.componentUsageText(name)}`),
      el("button", { className: "dz-btn", onclick: () => D.exitComponent() }, "Done"));
    const first = target && D.isEditable(target) ? target : D.doc.querySelector(`[data-cms-component="${name}"]`)?.firstElementChild;
    D.select(first || null);
  };
  D.exitComponent = () => {
    if (D.editingText) finishTextEdit();
    D.editingComponent = null;
    for (const n of D.doc.querySelectorAll("[data-cms-dim]")) n.removeAttribute("data-cms-dim");
    banner.hidden = true;
    D.select(null);
  };

  /* ---------------------------------------------------- breakpoints -- */

  function setBp(id) {
    D.bp = id;
    sessionSet("bp", id);
    for (const b of bpButtons.children) b.classList.toggle("on", b.dataset.bp === id);
    fitCanvas();
    paintRight();
  }
  D.setBp = setBp;

  function fitCanvas() {
    const avail = canvas.clientWidth - 2;
    const want = PREVIEW_WIDTH[D.bp] || Math.max(992, avail);
    const scale = Math.min(1, avail / want);
    frameWrap.style.width = want + "px";
    frameWrap.style.height = Math.round(canvas.clientHeight / scale) + "px";
    frameWrap.style.transform = scale < 1 ? `scale(${scale})` : "";
    frameWrap.style.marginBottom = scale < 1 ? `${-Math.round(canvas.clientHeight / scale * (1 - scale))}px` : "";
    paintWidth();
    setTimeout(paintOverlay, 50);
  }
  function paintWidth() {
    const w = PREVIEW_WIDTH[D.bp] || Math.max(992, canvas.clientWidth - 2);
    widthLabel.textContent = `${w} px · ${bpLabel(D.bp)}`;
  }
  new ResizeObserver(fitCanvas).observe(canvas);

  function togglePreview() {
    D.preview = !D.preview;
    previewBtn.classList.toggle("on", D.preview);
    D.doc?.documentElement.classList.toggle("cms-preview-mode", D.preview);
    if (D.preview) { D.selected = null; D.hovered = null; }
    D.refresh();
  }

  /* ------------------------------------------------------- right -- */

  let rightTab = sessionGet("right") || "style";
  function paintRight() {
    const tabs = el("div", { className: "dz-tabs" },
      ...[["style", "Style"], ["settings", "Settings"]].map(([id, t]) =>
        el("button", { className: rightTab === id ? "on" : "", onclick: () => { rightTab = id; sessionSet("right", id); paintRight(); } }, t)));
    right.replaceChildren(tabs, rightTab === "style" ? stylePanel(D) : settingsPanel(D));
  }
  D.paintRight = paintRight;

  /* ------------------------------------------------------- pages -- */

  const allPages = () => [...D.pages.filter((p) => !D.deletedPages.has(p.slug)), ...D.newPages.values()];

  /** Collection template pages, as Webflow lists them under "CMS Collection pages". */
  function templatePages() {
    const out = [];
    if (store.template) {
      const t = store.template;
      out.push({ slug: "__template-projects", template: "projects", name: "Projects Template", ...t.shell,
        htmlOpen: t.shell.htmlOpen.replace("{{=slug}}", D.sample.projects || "feedback"), bodyHtml: t.body });
    }
    for (const [name, t] of Object.entries(store.templates || {})) {
      if (!t) continue;
      out.push({ slug: `__template-${name}`, template: name, name: `${store.schemas[name]?.label || name} Template`, ...t.shell,
        htmlOpen: t.shell.htmlOpen.replace("{{=slug}}", "item"), bodyHtml: t.body });
    }
    return out;
  }
  D.templatePages = templatePages;
  /** The Style Guide, built fresh from every page, template and component. */
  D.styleGuide = () => {
    const sources = [
      ...allPages().map((p) => D.edits.get(p.slug) ?? p.bodyHtml),
      ...templatePages().map((t) => D.edits.get(t.slug) ?? t.bodyHtml),
      ...Object.keys(store.components).map((c) => D.componentEdits.get(c) ?? store.components[c].html),
    ];
    return styleGuidePage(D, sources, D.pages.find((p) => p.slug === "index"));
  };
  D.schemaOf = (name) => store.schemas[name];
  // Collections that have items to list: Projects and every CMS collection.
  D.collectionNames = () => store.collectionNames.filter((n) => store.schemas[n].kind === "collection" || n === "projects");
  D.componentLabel = (name) => store.components[name]?.label || name;
  /** Where a component appears: page names, and the collection templates using it. */
  D.componentUsage = (name) => {
    const pages = allPages().filter((p) => p.layout !== "utility" && ((p.navbar || "navbar-main") === name || p.footer === name)).map((p) => pageName(p));
    const tpls = templatePages().filter((t) => t.navbar === name || t.footer === name).map((t) => `every ${t.template === "projects" ? "project" : (store.schemas[t.template]?.singular || t.template).toLowerCase()} page`);
    return [...pages, ...tpls];
  };
  D.componentUsageText = (name) => { const u = D.componentUsage(name); return u.length ? `Used on ${u.join(", ")}.` : "Not used on any page."; };
  function originalBody(s) {
    const tp = templatePages().find((t) => t.slug === s);
    if (tp) return tp.bodyHtml;
    return D.pages.find((p) => p.slug === s)?.bodyHtml ?? null;
  }

  function paintPageSelect() {
    pageSelect.replaceChildren(
      el("optgroup", { label: "Static pages" }, ...allPages().map((p) =>
        el("option", { value: p.slug, selected: p.slug === D.page?.slug }, pageName(p) + (D.edits.has(p.slug) ? " \u2022" : "")))),
      el("optgroup", { label: "Collection templates" }, ...templatePages().map((t) =>
        el("option", { value: t.slug, selected: t.slug === D.page?.slug }, t.name + (D.edits.has(t.slug) ? " \u2022" : "")))),
      el("optgroup", { label: "Styles" }, el("option", { value: STYLE_GUIDE, selected: D.page?.slug === STYLE_GUIDE }, "Style Guide")));
    const tpl = D.page?.template;
    sampleSelect.hidden = !tpl;
    if (tpl) {
      const sc = store.schemas[tpl] || {};
      const titleOf = (p) => String(p[sc.titleField || (tpl === "projects" ? "title" : "name")] ?? p.title ?? p.name ?? p.slug).trim();
      D.sampleItem(tpl);
      sampleSelect.replaceChildren(...(store.items[tpl] || []).map((p) =>
        el("option", { value: p.slug, selected: p.slug === D.sample[tpl] }, `Item: ${titleOf(p)}${p.draft ? " (draft)" : ""}`)));
    }
  }
  pageSelect.onchange = () => D.openPage(pageSelect.value);
  D.findPage = (s) => (s === STYLE_GUIDE ? D.styleGuide() : allPages().find((x) => x.slug === s) || templatePages().find((x) => x.slug === s));
  D.openPage = (s) => {
    const p = D.findPage(s);
    if (!p) return;
    if (D.editingText) finishTextEdit();
    loadPage(p);
  };
  D.allPages = allPages;
  D.pageName = pageName;

  /* -------------------------------------------------------- save -- */

  /** A template page's file and stored record. */
  function templateSource(tp) {
    return tp.template === "projects"
      ? { file: store.schemas.projects?.template || "content/_templates/project.json", src: store.template }
      : { file: store.schemas[tp.template].template, src: store.templates[tp.template] };
  }
  const codeChanged = (s, code) => {
    const tp = templatePages().find((t) => t.slug === s);
    const shell = tp ? templateSource(tp).src.shell || {} : {};
    return (code.customHead || "") !== (shell.customHead || "") || (code.customBodyEnd || "") !== (shell.customBodyEnd || "");
  };
  D.templateShell = (s) => {
    const tp = templatePages().find((t) => t.slug === s);
    const shell = tp ? templateSource(tp).src.shell || {} : {};
    return D.templateCode.get(s) || { customHead: shell.customHead || "", customBodyEnd: shell.customBodyEnd || "" };
  };

  // A static page's own custom code (Webflow's page settings > Custom code).
  const pageRecord = (s) => D.newPages.get(s) || D.pages.find((p) => p.slug === s);
  const pageCodeChanged = (s, code) => {
    const rec = pageRecord(s) || {};
    return (code.customHead || "") !== (rec.customHead || "") || (code.customBodyEnd || "") !== (rec.customBodyEnd || "");
  };
  D.pageShell = (s) => {
    const rec = pageRecord(s) || {};
    return D.pageCode.get(s) || { customHead: rec.customHead || "", customBodyEnd: rec.customBodyEnd || "" };
  };

  function markDirty() {
    const designChanged = JSON.stringify(D.design) !== D.savedDesign || [...D.templateCode].some(([s, c]) => codeChanged(s, c))
      || [...D.pageCode].some(([s, c]) => pageCodeChanged(s, c));
    const pagesChanged = [...D.edits.entries()].some(([s, html]) => html !== originalBody(s));
    const compsChanged = [...D.componentEdits.entries()].some(([n, html]) => html !== store.components[n]?.html);
    D.dirty = designChanged || pagesChanged || compsChanged || D.newPages.size > 0 || D.deletedPages.size > 0 || !!(D.editingText && D.textDirty);
    designerState.dirty = D.dirty;
    saveBtn.disabled = !D.dirty;
    status.textContent = D.dirty ? "Unsaved changes" : "";
    status.className = "dz-status" + (D.dirty ? " warn" : "");
    paintPageSelect();
  }
  D.markDirty = markDirty;

  async function save() {
    if (D.editingText) finishTextEdit();
    if (!D.dirty) return;
    const changes = [];
    const updated = [];
    const templatesSaved = [];
    // Template pages: their layout (body) and their custom code (shell).
    for (const tp of templatePages()) {
      const html = D.edits.get(tp.slug);
      const code = D.templateCode.get(tp.slug);
      const bodyChanged = html != null && html !== originalBody(tp.slug);
      const shellChanged = code && codeChanged(tp.slug, code);
      if (!bodyChanged && !shellChanged) continue;
      const { file, src } = templateSource(tp);
      const next = { ...src, ...(bodyChanged ? { body: html } : {}), ...(shellChanged ? { shell: { ...src.shell, ...code } } : {}) };
      changes.push({ path: file, content: JSON.stringify(next, null, 2) + "\n" });
      templatesSaved.push([src, next, tp]);
    }
    const staticSlugs = new Set([...D.edits.keys(), ...D.pageCode.keys()]);
    for (const s of staticSlugs) {
      if (templatePages().some((t) => t.slug === s)) continue;
      const rec = pageRecord(s);
      if (!rec || D.deletedPages.has(s)) continue;
      const html = D.edits.has(s) ? D.edits.get(s) : rec.bodyHtml;
      const code = D.pageCode.get(s);
      const codeDiff = code && pageCodeChanged(s, code);
      if (!D.newPages.has(s) && html === rec.bodyHtml && !codeDiff) continue;
      const next = { ...rec, bodyHtml: html, ...(codeDiff ? code : {}) };
      changes.push({ path: `content/pages/${s}.json`, content: serializeRecord("pages", next) });
      updated.push([rec, next]);
    }
    for (const [s, rec] of D.newPages) {
      if (staticSlugs.has(s)) continue;
      changes.push({ path: `content/pages/${s}.json`, content: serializeRecord("pages", rec) });
      updated.push([rec, rec]);
    }
    for (const s of D.deletedPages) {
      const rec = D.pages.find((p) => p.slug === s);
      if (rec?.__path) changes.push({ path: rec.__path, content: null });
    }
    const compsSaved = [];
    for (const [name, html] of D.componentEdits) {
      const c = store.components[name];
      if (!c || html === c.html) continue;
      const next = { ...Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith("__"))), html };
      changes.push({ path: c.__path || `content/components/${name}.json`, content: JSON.stringify(next, null, 2) + "\n" });
      compsSaved.push([c, html]);
    }
    const designJson = JSON.stringify(D.design);
    if (designJson !== D.savedDesign) changes.push({ path: "content/settings/design.json", content: JSON.stringify(D.design, null, 2) + "\n" });
    if (!changes.length) { markDirty(); return; }

    saveBtn.disabled = true;
    status.textContent = "Saving…";
    status.className = "dz-status";
    try {
      const what = [...new Set(updated.map(([r]) => r.slug)), ...compsSaved.map(([c]) => `${c.label} component`), ...templatesSaved.map(([, , t]) => t.name)];
      await commit(changes, `CMS Designer: ${what.join(", ") || "styles"}${designJson !== D.savedDesign ? " + styles" : ""}`, { view: pagePath(D.page) });
      for (const [rec, next] of updated) {
        Object.assign(rec, next);
        rec.__path = `content/pages/${rec.slug}.json`;
        if (D.newPages.has(rec.slug)) { D.pages.push(rec); D.newPages.delete(rec.slug); }
      }
      for (const s of D.deletedPages) {
        const i = D.pages.findIndex((p) => p.slug === s);
        if (i >= 0) D.pages.splice(i, 1);
      }
      D.deletedPages.clear();
      D.edits.clear();
      for (const [c, html] of compsSaved) c.html = html;
      for (const [src, next] of templatesSaved) Object.assign(src, next);
      D.templateCode.clear();
      D.pageCode.clear();
      D.componentEdits.clear();
      D.savedDesign = designJson;
      markDirty();
      status.textContent = "Saved";
      status.className = "dz-status ok";
    } catch (err) {
      toast(err.message, "error");
      markDirty();
    }
  }
  saveBtn.onclick = save;
  designerState.save = save;

  /* ------------------------------------------------------- start -- */

  const left = leftPanels(D, { rail, panel });
  // Webflow never nests blocks inside text (headings, paragraphs, links of text).
  D.canContain = (n) => !!n && canContainEl(n) && !n.classList.contains("w-dyn-list") && !/^a$/i.test(n.tagName) || (!!n && n.classList.contains("w-inline-block"));

  const startSlug = slug || sessionGet("page") || "index";
  setTimeout(() => {
    setBp(D.bp);
    loadPage(D.findPage(startSlug) || allPages()[0]);
  }, 0);

  return root;
}

function pageName(p) {
  return p.template ? p.name : pageLabel(p);
}
function pagePath(p) {
  if (!p) return "/";
  if (p.template === "projects") return "/work/";
  return p.slug === "index" ? "/" : p.slug === "404" ? "/404.html" : `/${p.slug}/`;
}
/** CSS url(/assets/...) on a sub-path deploy. */
function rebaseCss(css) {
  const base = assetUrl("/").replace(/\/$/, "");
  return base ? String(css).replace(/url\((['"]?)\/(?!\/)/g, `url($1${base}/`) : css;
}
function sessionGet(k) { try { return sessionStorage.getItem("cms:dz:" + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem("cms:dz:" + k, v); } catch { /* private mode */ } }

export { BREAKPOINTS, clone, confirmDialog };
