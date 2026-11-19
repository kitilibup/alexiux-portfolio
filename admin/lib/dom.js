/** Small DOM and value helpers shared by every part of the CMS. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * el("button", { className: "btn", onclick }, "Save")
 * Props are assigned as properties; `attrs` sets attributes, `dataset` data-*.
 */
export function el(tag, props = {}, ...kids) {
  const { attrs, dataset, style, ...rest } = props || {};
  const node = Object.assign(document.createElement(tag), rest);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) node.setAttribute(k, v === true ? "" : v);
  if (dataset) Object.assign(node.dataset, dataset);
  if (style) Object.assign(node.style, style);
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    node.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return node;
}

/* ----------------------------------------------------------------- values -- */

export const getField = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function setField(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export const slugify = (s) =>
  String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A record as written to disk: no editor bookkeeping. */
export function stripInternal(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) if (!k.startsWith("__")) out[k] = v;
  return out;
}

export const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ------------------------------------------------------------------ paths --
 * Content stores root-absolute paths (/assets/img/...). On a project-pages
 * deploy the site lives under /<repo>/, so inside the CMS those would resolve
 * to the domain root and 404. They're rebased for display only - what is
 * stored never changes.
 */
export const SITE_BASE = location.pathname.replace(/\/admin(?:\/.*)?$/, "");

/*
 * Files uploaded in this session. On GitHub an upload reaches the live site
 * only when the deploy after it finishes (about a minute), so until then the
 * CMS shows the browser's own copy instead of a missing image.
 */
const localCopies = new Map(); // "/assets/uploads/x.avif" -> blob: URL
export function rememberLocalCopy(path, blob) {
  const key = "/" + String(path).replace(/^\/+/, "");
  if (localCopies.has(key)) URL.revokeObjectURL(localCopies.get(key));
  localCopies.set(key, URL.createObjectURL(blob));
}

export const assetUrl = (p) => {
  if (!p) return "";
  if (/^((https?:)?\/\/|blob:|data:)/.test(p)) return p;
  const key = "/" + String(p).replace(/^\/+/, "");
  return localCopies.get(key) || SITE_BASE + key;
};

/**
 * Editors that save their own DOM (rich text, the Designer): an <img> whose
 * file was uploaded in this session shows the browser's copy, and keeps its
 * real address in data-cms-local-src, which is what gets saved.
 */
export function showLocalCopies(root) {
  for (const img of root.querySelectorAll("img[src]:not([data-cms-local-src])")) {
    const real = img.getAttribute("src");
    const key = SITE_BASE && real.startsWith(SITE_BASE + "/") ? real.slice(SITE_BASE.length) : real;
    const url = localCopies.get(key);
    if (!url) continue;
    img.setAttribute("data-cms-local-src", real);
    img.setAttribute("src", url);
  }
}

/** Markup with this session's uploads pointing at the browser's copies (see above). */
export function withLocalCopies(html) {
  let s = String(html);
  for (const [p, url] of localCopies) {
    const esc = (SITE_BASE + p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plain = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`(?:${esc}|${plain})(?![\\w./-])`, "g"), url);
  }
  return s;
}

export const toSiteHtml = (html) =>
  SITE_BASE ? String(html).replace(/(src|href)="\/(?!\/)/g, `$1="${SITE_BASE}/`) : String(html);

export const fromSiteHtml = (html) =>
  SITE_BASE ? String(html).replace(new RegExp(`(src|href)="${SITE_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, "g"), '$1="/') : String(html);

/* --------------------------------------------------------------- feedback -- */

export function toast(message, kind = "ok") {
  let stack = $("#toasts");
  if (!stack) document.body.append((stack = el("div", { id: "toasts", attrs: { role: "status", "aria-live": "polite" } })));
  const node = el("div", { className: `toast ${kind}` }, message);
  stack.append(node);
  setTimeout(() => node.remove(), kind === "error" ? 8000 : 4000);
}

/**
 * A modal dialog. Resolves with whatever `close(value)` is called with;
 * Escape and the backdrop resolve with null.
 */
export function modal({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value = null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(null); } };
    const box = el("div", { className: "modal" + (wide ? " wide" : ""), attrs: { role: "dialog", "aria-modal": "true", "aria-label": title } },
      el("header", {},
        el("h2", {}, title),
        el("button", { className: "icon-btn", title: "Close", attrs: { "aria-label": "Close" }, onclick: () => close(null) }, "\u00d7")),
      el("div", { className: "modal-body" }, typeof body === "function" ? body(close) : body),
      actions.length ? el("footer", { className: "modal-actions" }, ...actions.map((a) =>
        el("button", {
          className: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : ""),
          onclick: async () => { const v = a.onClick ? await a.onClick(close) : a.value; if (v !== undefined) close(v); },
        }, a.label))) : null
    );
    const overlay = el("div", { className: "overlay", onmousedown: (e) => { if (e.target === overlay) close(null); } }, box);
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    onOpen?.(box, close);
    (box.querySelector("[autofocus]") || box.querySelector("input,select,textarea,button.primary"))?.focus();
  });
}

export const confirmDialog = (title, message, { ok = "OK", danger = false } = {}) =>
  modal({
    title,
    body: el("p", {}, message),
    actions: [{ label: "Cancel", value: false }, { label: ok, value: true, primary: !danger, danger }],
  }).then((v) => v === true);

/** Format a count: 1 image, 3 images. */
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
