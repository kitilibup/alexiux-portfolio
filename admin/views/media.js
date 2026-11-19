/**
 * Media: every asset of the site in one library, the image picker, uploading.
 *
 * The library lists every file of the site: uploads (assets/uploads/, images
 * and videos), the site's images (assets/img/, share images included), icons
 * and fonts. Remote video links (Wistia, YouTube...) are not library items -
 * they live where they are pasted. Each file shows its size and where it's
 * used - content, components, templates, settings and the stylesheet. The
 * automatic WebP copies (assets/responsive/) are counted, not listed.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, modal, confirmDialog, assetUrl, plural, rememberLocalCopy } from "../lib/dom.js?v=6600ab59";
import { store, commit, pageLabel } from "../store.js?v=6600ab59";
import { bytesToBase64 } from "../backends/github.js?v=6600ab59";

const IMAGE_RE = /\.(avif|webp|png|jpe?g|gif|svg)$/i;
// What may be uploaded. Not SVG: an SVG is a document that can carry script,
// and opened from the site's own domain it would run with the site's origin.
const UPLOAD_RE = /\.(avif|webp|png|jpe?g|gif|mp4|webm|mov|m4v)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const BIG = 4 * 1024 * 1024;
const MAX = 20 * 1024 * 1024;
// Videos are committed to the site's repository like images; GitHub takes
// files up to ~50 MB this way. Longer videos belong on Wistia/YouTube.
const BIG_VIDEO = 15 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;

/**
 * The brands of an ISO media file (MP4, MOV, AVIF, HEIC): the major brand and
 * the compatible ones. Many encoders write "mif1" as the major brand of an
 * AVIF and list "avif" among the compatible ones.
 */
function ftypBrands(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length < 12 || ascii(4, 8) !== "ftyp") return [];
  const size = Math.min(bytes.length, 256, ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
  const brands = [ascii(8, 12)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(i, i + 4));
  return brands;
}
const isAvif = (brands) => brands.some((b) => b === "avif" || b === "avis");
const isStillImage = (brands) => brands.some((b) => /^(avif|avis|mif1|msf1|heic|heix|heim|heis|hevc|hevx)$/.test(b));

/** The file's real format from its first bytes - a renamed file can't pass as an image. */
function sniffImage(bytes) {
  const b = (i) => bytes[i];
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (b(0) === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpeg";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (isAvif(ftypBrands(bytes))) return "avif";
  return null;
}
/** The same for videos: MP4/MOV (an "ftyp" box) and WebM (EBML header). */
function sniffVideo(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  const brands = ftypBrands(bytes);
  if (brands.length && !isStillImage(brands)) return "mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  return null;
}

export async function loadMedia(force = false) {
  const { files } = await loadAssets(force);
  return files.filter((f) => f.upload && (f.kind === "image" || f.kind === "icon"));
}

/* ------------------------------------------------------------- assets -- */

const KIND = [
  [/\.svg$/i, "icon"], [/\.(avif|webp|png|jpe?g|gif|ico)$/i, "image"], [/\.(woff2?|ttf|otf)$/i, "font"],
  [/\.(mp4|webm|mov|m4v)$/i, "video"], [/\.pdf$/i, "document"],
];
const kindOf = (name) => (KIND.find(([re]) => re.test(name)) || [, null])[1];
const ROOTS = () => [CONFIG.uploadPath, "assets/img", "assets/fonts", "assets/video", "assets/docs"];

async function listTree(dir) {
  const out = [];
  for (const f of await store.backend.listDir(dir).catch(() => [])) {
    if (f.type === "dir") out.push(...(await listTree(f.path)));
    else out.push(f);
  }
  return out;
}

/** Every piece of content an asset can be used in, with a name people know. */
function contentSources() {
  const out = [];
  for (const [name, records] of Object.entries(store.items)) {
    const sc = store.schemas[name] || {};
    for (const r of records) {
      const label = name === "pages" ? `${pageLabel(r)} page` : sc.kind === "singleton" ? sc.label : r.title || r.name || r.slug || sc.label;
      out.push({ label, text: JSON.stringify(r) });
    }
  }
  for (const c of Object.values(store.components || {})) out.push({ label: `${c.label || "Component"} component`, text: JSON.stringify(c) });
  if (store.template) out.push({ label: "Projects template", text: JSON.stringify(store.template) });
  for (const [n, t] of Object.entries(store.templates || {})) if (t) out.push({ label: `${store.schemas[n]?.label || n} template`, text: JSON.stringify(t) });
  if (store.siteCssText) out.push({ label: "Stylesheet", text: store.siteCssText });
  return out;
}

/** Where a path or URL is used, for "used in" and safe deletion. */
export function usageOf(path) {
  return [...new Set(contentSources().filter((s) => s.text.includes(path)).map((s) => s.label))];
}

/** Every asset: the files of the site (remote video links are not library items). */
export async function loadAssets(force = false) {
  if (store.assets && !force) return store.assets;
  const cssFile = (CONFIG.siteCss || []).map((h) => h.replace(/^(\.\.\/)+/, "")).find((h) => !/fonts\.css$/.test(h));
  const [lists, css, copies] = await Promise.all([
    Promise.all(ROOTS().map(listTree)),
    cssFile ? store.backend.readFile(cssFile).catch(() => "") : "",
    store.backend.listDir("assets/responsive").catch(() => []),
  ]);
  store.siteCssText = css;
  const files = lists.flat().filter((f) => kindOf(f.name)).map((f) => ({
    name: f.name, path: "/" + f.path, size: f.size || 0, kind: kindOf(f.name),
    upload: f.path.startsWith(CONFIG.uploadPath + "/"), share: /\/share\//.test(f.path),
  }));
  files.sort((a, b) => (b.upload - a.upload) || (b.upload ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));
  for (const f of files) f.used = usageOf(f.path);
  store.assets = { files, copies: copies.filter((f) => /\.webp$/i.test(f.name)).length };
  return store.assets;
}

const prettyName = (name) => name.replace(/^\d{10,}-/, "").replace(/^[0-9a-f]{24}_/, "");

export async function uploadFile(file, { imagesOnly = false } = {}) {
  if (imagesOnly && VIDEO_RE.test(file.name)) {
    toast(`${file.name} is a video \u2014 upload it in Media, then use its path where a video goes.`, "error");
    return null;
  }
  if (!UPLOAD_RE.test(file.name)) {
    toast(`${file.name}: upload an image (AVIF, WebP, PNG, JPEG, GIF) or a video (MP4, WebM, MOV).${/\.svg$/i.test(file.name) ? " SVG files can contain code, so they can't be uploaded here — export a PNG instead." : ""}`, "error");
    return null;
  }
  const video = VIDEO_RE.test(file.name);
  const mb = (n) => (n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1);
  if (file.size > (video ? MAX_VIDEO : MAX)) {
    toast(`${file.name} is ${mb(file.size)} MB; the limit is ${video ? "50 MB for a video \u2014 put longer videos on Wistia or YouTube and paste the link" : "20 MB"}.`, "error");
    return null;
  }
  if (file.size > (video ? BIG_VIDEO : BIG)) {
    const ok = await confirmDialog(video ? "Large video" : "Large image",
      `${file.name} is ${mb(file.size)} MB. Large ${video ? "videos" : "images"} slow the page down - consider exporting a smaller version. Upload anyway?`,
      { ok: "Upload anyway" });
    if (!ok) return null;
  }
  const base = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
  const path = `${CONFIG.uploadPath}/${Date.now()}-${base}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!(video ? sniffVideo(buf) : sniffImage(buf))) {
    toast(`${file.name} isn't really ${video ? "a video" : "an image"} (its contents don't match its name).`, "error");
    return null;
  }
  try {
    await commit([{ path, content: bytesToBase64(buf), base64: true }], `CMS: upload ${base}`);
    // Shown from this copy until the deploy has put it on the site.
    if (store.backend?.mode !== "local") rememberLocalCopy(path, file);
    store.media = null;
    store.assets = null;
    return "/" + path;
  } catch (err) {
    toast(`Upload failed: ${err.message}`, "error");
    return null;
  }
}

function tile(f, { selected, onClick, extra } = {}) {
  const img = el("img", { src: assetUrl(f.path), alt: "", loading: "lazy", decoding: "async" });
  img.onerror = () => img.classList.add("missing");
  return el("button", {
    type: "button",
    className: "media-tile" + (selected ? " selected" : ""),
    title: f.name,
    onclick: onClick,
  }, el("span", { className: "media-thumb" }, img),
     el("span", { className: "media-name" }, prettyName(f.name)),
     extra || null);
}

/**
 * Choose image(s). Resolves with a path, an array of paths (multiple), or
 * null. Uploading from inside the picker selects what was uploaded.
 */
export function pickImage({ multiple = false, title } = {}) {
  let files = [];
  let filter = "";
  let source = "all";
  const chosen = new Set();

  const grid = el("div", { className: "media-grid picker" }, el("p", { className: "hint" }, "Loading…"));
  const count = el("span", { className: "muted" });

  const paint = () => {
    const q = filter.toLowerCase();
    const shown = files.filter((f) =>
      (source === "all" || (source === "uploads") === f.upload) && (!q || f.name.toLowerCase().includes(q)));
    grid.replaceChildren(...(shown.length
      ? shown.map((f) => tile(f, {
          selected: chosen.has(f.path),
          onClick: () => {
            if (!multiple) return closer?.(f.path);
            chosen.has(f.path) ? chosen.delete(f.path) : chosen.add(f.path);
            paint();
          },
        }))
      : [el("p", { className: "hint" }, files.length ? "No images match." : "No images yet — upload one.")]));
    count.textContent = multiple ? (chosen.size ? `${chosen.size} selected` : "") : "";
  };

  const fileInput = el("input", { type: "file", accept: ".avif,.webp,.png,.jpg,.jpeg,.gif", multiple, hidden: true });
  const uploadBtn = el("button", { type: "button", className: "btn", onclick: () => fileInput.click() }, "Upload…");
  let closer = null;

  fileInput.onchange = async () => {
    const list = [...fileInput.files];
    fileInput.value = "";
    if (!list.length) return;
    uploadBtn.disabled = true;
    const done = [];
    for (const [i, f] of list.entries()) {
      uploadBtn.textContent = `Uploading ${i + 1}/${list.length}…`;
      const p = await uploadFile(f, { imagesOnly: true });
      if (p) done.push(p);
    }
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload…";
    if (!done.length) return;
    if (!multiple) return closer(done[0]);
    done.forEach((p) => chosen.add(p));
    files = (await loadAssets(true)).files.filter((f) => f.kind === "image" || f.kind === "icon");
    paint();
  };

  const search = el("input", { type: "search", placeholder: "Search images", className: "search",
    oninput: (e) => { filter = e.target.value; paint(); } });
  const sourceSel = el("select", { onchange: (e) => { source = e.target.value; paint(); } },
    el("option", { value: "all" }, "All images"),
    el("option", { value: "uploads" }, "Uploads"),
    el("option", { value: "site" }, "Site images"));

  return modal({
    title: title || (multiple ? "Choose images" : "Choose an image"),
    wide: true,
    body: (close) => {
      closer = close;
      return el("div", { className: "picker-body" },
        el("div", { className: "picker-bar" }, search, sourceSel, uploadBtn, fileInput),
        grid);
    },
    actions: multiple ? [
      { label: "Cancel", value: null },
      { label: "Add selected", primary: true, onClick: () => (chosen.size ? [...chosen] : undefined) },
    ] : [],
    onOpen: async () => {
      try {
        const { files: all } = await loadAssets();
        files = all.filter((f) => f.kind === "image" || f.kind === "icon");
      } catch (err) {
        toast(err.message, "error");
      }
      paint();
    },
  });
}

/* ------------------------------------------------------------- library -- */

const FILTERS = [
  ["all", "All", () => true],
  ["images", "Images", (f) => f.kind === "image" && !f.share],
  ["uploads", "Uploads", (f) => f.upload],
  ["share", "Share images", (f) => f.share],
  ["icons", "Icons", (f) => f.kind === "icon"],
  ["videos", "Videos", (f) => f.kind === "video"],
  ["fonts", "Fonts", (f) => f.kind === "font"],
  ["unused", "Not used", (f) => !f.used.length],
];
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function assetCard(f, refresh) {
  const thumb = el("span", { className: "media-thumb" });
  const meta = el("span", { className: "muted small" });
  const parts = [f.kind === "font" ? "Font" : f.kind === "icon" ? "SVG icon" : (f.name.split(".").pop() || "").toUpperCase()];
  if (f.size) parts.push(kb(f.size));
  meta.textContent = parts.join(" \u00b7 ");
  if (f.kind === "image" || f.kind === "icon") {
    const img = el("img", { src: assetUrl(f.path), alt: "", loading: "lazy", decoding: "async" });
    img.onload = () => { if (img.naturalWidth) meta.textContent = [...parts, `${img.naturalWidth}\u00d7${img.naturalHeight}`].join(" \u00b7 "); };
    img.onerror = () => img.classList.add("missing");
    thumb.append(img);
  } else if (f.kind === "video") {
    // A video file of the site: its first frame, and its size once known.
    const v = el("video", { src: assetUrl(f.path) + "#t=0.1", muted: true, preload: "metadata", playsInline: true });
    v.onloadedmetadata = () => { if (v.videoWidth) meta.textContent = [...parts, `${v.videoWidth}\u00d7${v.videoHeight}`, `${Math.round(v.duration)} s`].join(" \u00b7 "); };
    thumb.append(v);
  } else {
    thumb.classList.add("media-glyph");
    thumb.append(el("span", {}, f.kind === "font" ? "Aa" : f.kind === "document" ? "PDF" : "\u25b6"));
  }
  const usedText = f.used.length ? `Used in ${f.used.slice(0, 2).join(", ")}${f.used.length > 2 ? ` +${f.used.length - 2}` : ""}` : "Not used";
  const actions = [
    el("button", { className: "link", onclick: () => { navigator.clipboard?.writeText(f.path); toast("Path copied"); } }, "Copy path"),
    el("a", { className: "link", href: assetUrl(f.path), target: "_blank", rel: "noopener" }, "Open"),
  ];
  if (f.kind === "font") actions.push(el("a", { className: "link", href: "#/settings" }, "Fonts settings"));
  else {
    // Any file can be deleted, as in Webflow. One that's still used says
    // where first, so nothing breaks without you knowing.
    actions.push(el("button", {
      className: "link danger",
      title: f.used.length ? `Used in ${f.used.join(", ")}` : "",
      onclick: async () => {
        const where = usageOf(f.path);
        const ok = await confirmDialog(`Delete ${prettyName(f.name)}?`,
          where.length
            ? `It's still used in ${where.join(", ")}. Deleting it leaves a missing ${f.kind === "video" ? "video" : "image"} there until you choose another one. Delete anyway?`
            : "It isn't used anywhere. It stays in the site's history on GitHub, but not in the library.",
          { ok: where.length ? "Delete anyway" : "Delete", danger: true });
        if (!ok) return;
        try {
          await commit([{ path: f.path.slice(1), content: null }], `CMS: delete ${f.name}`);
          toast(where.length ? `Deleted. Choose another image in ${where.join(", ")}.` : "Deleted.");
          refresh();
        } catch (err) { toast(`Couldn't delete ${prettyName(f.name)}: ${err.message}`, "error"); }
      },
    }, "Delete"));
  }
  return el("figure", { className: "media-card" + (f.used.length ? "" : " is-unused") },
    thumb,
    el("figcaption", {},
      el("span", { className: "media-name", title: f.path }, prettyName(f.name)),
      meta,
      el("span", { className: f.used.length ? "muted small" : "muted small unused", title: f.used.join(", ") }, usedText)),
    el("div", { className: "media-actions" }, ...actions));
}

export function mediaView() {
  let assets = { files: [], copies: 0 };
  let filter = "all", query = "";
  const grid = el("div", { className: "media-grid" }, el("p", { className: "hint" }, "Loading all assets\u2026"));
  const summary = el("p", { className: "hint" });
  const chips = el("div", { className: "chips media-filters", role: "tablist" });
  const search = el("input", { type: "search", placeholder: "Search assets", className: "search", oninput: (e) => { query = e.target.value.toLowerCase(); paint(); } });
  const paint = () => {
    chips.replaceChildren(...FILTERS.map(([key, label, test]) => {
      const n = assets.files.filter(test).length;
      return n || key === "all" ? el("button", { type: "button", className: "chip" + (filter === key ? " active" : ""), role: "tab", "aria-selected": String(filter === key), onclick: () => { filter = key; paint(); } }, `${label} `, el("span", { className: "muted" }, String(n))) : null;
    }).filter(Boolean));
    const test = FILTERS.find(([k]) => k === filter)[2];
    const shown = assets.files.filter((f) => test(f) && (!query || `${f.name} ${f.used.join(" ")}`.toLowerCase().includes(query)));
    grid.replaceChildren(...(shown.length ? shown.map((f) => assetCard(f, refresh)) : [el("p", { className: "hint" }, assets.files.length ? "Nothing matches." : "No assets yet \u2014 upload some.")]));
  };
  const refresh = async () => {
    assets = await loadAssets(true);
    const local = assets.files;
    const bytes = local.reduce((n, f) => n + (f.size || 0), 0);
    const unused = assets.files.filter((f) => !f.used.length).length;
    summary.textContent = `${plural(local.length, "file")} (${kb(bytes)})` +
      `${unused ? ` \u00b7 ${unused} not used` : ""}.` +
      (assets.copies ? ` Smaller WebP copies of large images (${assets.copies}) are made automatically and aren't listed.` : "");
    paint();
  };
  refresh().catch((err) => toast(err.message, "error"));
  const fileInput = el("input", { type: "file", accept: ".avif,.webp,.png,.jpg,.jpeg,.gif,.mp4,.webm,.mov,.m4v", multiple: true, hidden: true });
  fileInput.onchange = async () => {
    for (const file of fileInput.files) await uploadFile(file);
    fileInput.value = "";
    await refresh();
  };
  const page = el("div", { className: "page" },
    el("header", { className: "page-head" },
      el("div", {}, el("h1", {}, "Media"), el("p", { className: "muted" }, "Every image, video, icon and font on the site, and where each is used.")),
      el("div", { className: "actions" },
        el("button", { className: "btn primary", onclick: () => fileInput.click() }, "Upload images or videos"))),
    el("div", { className: "picker-bar" }, chips, search), summary, fileInput, grid);
  // Drop files anywhere on the page to upload them.
  page.addEventListener("dragover", (e) => { e.preventDefault(); page.classList.add("dropping"); });
  page.addEventListener("dragleave", () => page.classList.remove("dropping"));
  page.addEventListener("drop", async (e) => {
    e.preventDefault();
    page.classList.remove("dropping");
    for (const file of e.dataTransfer.files) await uploadFile(file);
    await refresh();
  });
  return page;
}
