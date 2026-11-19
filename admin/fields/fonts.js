/**
 * Settings > Fonts.
 *
 * Every family the site loads, with a live specimen, its weights, and the
 * fallback stack shown while it loads (or if it can't). Families the
 * stylesheet uses but never loads are flagged, because visitors silently get
 * a generic font instead.
 *
 * Adding a Google font downloads its files into assets/fonts/ - the site
 * serves them itself, so visitors' browsers never contact Google. Files are
 * committed together with the settings when you save.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, modal, confirmDialog, assetUrl, clone, slugify, plural } from "../lib/dom.js?v=6600ab59";
import { familiesUsed, parseFontFaces, GENERIC } from "../lib/fonts.js?v=6600ab59";
import { store } from "../store.js?v=6600ab59";
import { bytesToBase64 } from "../backends/github.js?v=6600ab59";

const FALLBACKS = [
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  'Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  "Helvetica Neue, Helvetica, Arial, sans-serif",
  'Georgia, "Times New Roman", serif',
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
];
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const WEIGHT_NAMES = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };

let cssCache = null;
async function siteCss() {
  if (cssCache) return cssCache;
  const file = (CONFIG.siteCss || []).map((h) => h.replace(/^(\.\.\/)+/, "")).find((h) => !/fonts\.css$/.test(h));
  cssCache = file ? await store.backend.readFile(file).catch(() => "") : "";
  return cssCache;
}

/** Load a family's faces into this document so the specimen shows the real font. */
const loaded = new Set();
async function loadPreview(name, faces, blobs) {
  for (const f of faces) {
    const url = blobs.get(f.src) || assetUrl(f.src);
    const key = `${name}|${f.weight}|${f.style}|${url}`;
    if (loaded.has(key)) continue;
    loaded.add(key);
    try {
      const face = new FontFace(`cms-preview-${name}`, `url(${url})`, { weight: String(f.weight), style: f.style || "normal", unicodeRange: f.unicodeRange || "U+0-10FFFF" });
      document.fonts.add(await face.load());
    } catch { /* a missing file shows up as the fallback in the specimen */ }
  }
}

function sniffFont(bytes) {
  const sig = String.fromCharCode(...bytes.slice(0, 4));
  if (sig === "wOF2") return "woff2";
  if (sig === "wOFF") return "woff";
  if (sig === "OTTO") return "otf";
  if (sig === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return "ttf";
  return null;
}

const guessWeight = (name) => {
  const n = name.toLowerCase();
  for (const [w, label] of Object.entries({ 100: "thin", 200: "extralight", 300: "light", 500: "medium", 600: "semibold", 800: "extrabold", 900: "black", 700: "bold" })) {
    if (n.replace(/[\s_-]/g, "").includes(label)) return Number(w);
  }
  return 400;
};

export const fontTypes = {
  fontManager(field, ctx) {
    const wrap = el("div", { className: "fonts" });
    const blobs = new Map();   // pending font files: path -> blob URL, for previews before saving
    const fonts = () => ctx.get(field.name) || { display: "swap", families: [] };
    const update = (fn) => { const next = clone(fonts()); fn(next); ctx.set(field.name, next); paint(); };

    let used = new Map();
    siteCss().then((css) => { used = familiesUsed(css); paint(); });

    /* ------------------------------------------------- add from Google -- */
    async function addGoogle(prefill = "") {
      const name = el("input", { type: "text", placeholder: "e.g. DM Sans", value: prefill, autofocus: true });
      const checks = WEIGHTS.map((w) => el("label", { className: "inline-check" },
        el("input", { type: "checkbox", value: w, checked: w === 400 || w === 700 }), `${w} ${WEIGHT_NAMES[w]}`));
      const italic = el("input", { type: "checkbox" });
      const status = el("p", { className: "hint" });
      const result = await modal({
        title: "Add a Google font",
        body: el("div", { className: "fields" },
          el("div", { className: "field" }, el("label", { className: "field-label" }, "Family name, as on fonts.google.com"), name),
          el("div", { className: "field" }, el("label", { className: "field-label" }, "Weights"), el("div", { className: "weight-grid" }, ...checks),
            el("label", { className: "inline-check" }, italic, "Italics too")),
          el("p", { className: "hint" }, "The files are downloaded once and served by your site, so visitors never connect to Google."),
          status),
        actions: [{ label: "Cancel", value: null }, { label: "Download", primary: true, onClick: async () => {
          const fam = name.value.trim();
          const ws = checks.map((c) => c.firstChild).filter((c) => c.checked).map((c) => Number(c.value));
          if (!fam || !ws.length) { status.textContent = "Enter a family and pick at least one weight."; return undefined; }
          const axes = [...ws.map((w) => `0,${w}`), ...(italic.checked ? ws.map((w) => `1,${w}`) : [])].join(";");
          const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:ital,wght@${axes}&display=swap`;
          status.textContent = "Fetching from Google Fonts…";
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(res.status === 400 ? `Google Fonts has no "${fam}" with those weights.` : `Google Fonts answered ${res.status}.`);
            const faces = parseFontFaces(await res.text());
            if (!faces.length) throw new Error("No font files in Google's answer.");
            const out = [];
            for (const [i, f] of faces.entries()) {
              status.textContent = `Downloading ${i + 1} of ${faces.length}…`;
              const bytes = new Uint8Array(await (await fetch(f.src)).arrayBuffer());
              if (!sniffFont(bytes)) throw new Error("A downloaded file wasn't a font.");
              const path = `assets/fonts/${slugify(fam)}-${f.weight}${f.style === "italic" ? "i" : ""}-${f.subset || i}.woff2`;
              ctx.addFile(path, bytesToBase64(bytes));
              blobs.set("/" + path, URL.createObjectURL(new Blob([bytes], { type: "font/woff2" })));
              out.push({ weight: f.weight, style: f.style, src: "/" + path, ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}), ...(f.subset ? { subset: f.subset } : {}) });
            }
            return { name: faces[0].family || fam, faces: out };
          } catch (err) {
            status.textContent = err.message;
            status.className = "hint warn";
            return undefined;
          }
        } }],
      });
      if (!result) return;
      update((f) => {
        const existing = f.families.find((x) => x.name.toLowerCase() === result.name.toLowerCase());
        if (existing) { existing.faces = result.faces; existing.source = "google"; }
        else f.families.push({ name: result.name, source: "google", fallback: FALLBACKS[0], faces: result.faces });
      });
      toast(`${result.name}: ${plural(result.faces.length, "file")} ready — save to publish.`);
    }

    /* --------------------------------------------------------- upload -- */
    async function addUpload(prefill = "") {
      const name = el("input", { type: "text", placeholder: "Family name, e.g. Inter Display", value: prefill, autofocus: true });
      const input = el("input", { type: "file", accept: ".woff2,.woff,.ttf,.otf", multiple: true });
      const rows = el("div", { className: "upload-rows" });
      let picked = [];
      input.onchange = async () => {
        picked = [];
        rows.replaceChildren();
        for (const file of input.files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const kind = sniffFont(bytes);
          if (!kind) { toast(`${file.name} isn't a font file.`, "error"); continue; }
          const weight = el("select", {}, ...WEIGHTS.map((w) => el("option", { value: w, selected: w === guessWeight(file.name) }, `${w} ${WEIGHT_NAMES[w]}`)));
          const style = el("select", {}, el("option", { value: "normal" }, "Normal"), el("option", { value: "italic", selected: /italic/i.test(file.name) }, "Italic"));
          picked.push({ file, bytes, kind, weight, style });
          rows.append(el("div", { className: "inline" }, el("code", {}, file.name), weight, style));
        }
      };
      const result = await modal({
        title: "Upload font files",
        body: el("div", { className: "fields" },
          el("div", { className: "field" }, el("label", { className: "field-label" }, "Family"), name),
          el("div", { className: "field" }, el("label", { className: "field-label" }, "Files (WOFF2 is smallest)"), input, rows),
          el("p", { className: "hint" }, "Only upload fonts your licence allows you to self-host on a website.")),
        actions: [{ label: "Cancel", value: null }, { label: "Add", primary: true, onClick: () => {
          const fam = name.value.trim();
          if (!fam || !picked.length) { toast("Name the family and choose its files.", "error"); return undefined; }
          return { name: fam, faces: picked.map((p) => {
            const path = `assets/fonts/${slugify(fam)}-${p.weight.value}${p.style.value === "italic" ? "i" : ""}.${p.kind}`;
            ctx.addFile(path, bytesToBase64(p.bytes));
            blobs.set("/" + path, URL.createObjectURL(new Blob([p.bytes])));
            return { weight: Number(p.weight.value), style: p.style.value, src: "/" + path };
          }) };
        } }],
      });
      if (!result) return;
      update((f) => {
        const existing = f.families.find((x) => x.name.toLowerCase() === result.name.toLowerCase());
        if (existing) { existing.faces.push(...result.faces); existing.source = "upload"; }
        else f.families.push({ name: result.name, source: "upload", fallback: FALLBACKS[0], faces: result.faces });
      });
    }

    /* ---------------------------------------------------------- paint -- */
    function paint() {
      const f = fonts();
      const loadedNames = new Set(f.families.filter((x) => x.faces?.length).map((x) => x.name.toLowerCase()));
      const missing = [...used.entries()].filter(([n]) => !loadedNames.has(n.toLowerCase()));

      const display = el("select", { onchange: (e) => update((x) => { x.display = e.target.value; }) },
        ...[["swap", "Swap — show text at once in the fallback, then switch (recommended)"], ["optional", "Optional — use the font only if it's already fast"], ["fallback", "Fallback — brief invisible text, then fallback"], ["block", "Block — hide text until the font loads"], ["auto", "Browser default"]]
          .map(([v, t]) => el("option", { value: v, selected: (f.display || "swap") === v }, t)));

      wrap.replaceChildren(
        el("div", { className: "inline space" },
          el("div", {}, el("strong", {}, plural(f.families.filter((x) => x.faces?.length).length, "font family", "font families")), el("span", { className: "muted" }, " served by the site")),
          el("div", { className: "inline" },
            el("button", { type: "button", className: "btn small", onclick: () => addGoogle() }, "+ Google font"),
            el("button", { type: "button", className: "btn small", onclick: () => addUpload() }, "+ Upload files"))),
        ...missing.map(([n, count]) => {
          const fam = f.families.find((x) => x.name.toLowerCase() === n.toLowerCase());
          return el("div", { className: "callout warn" },
            el("p", {}, el("strong", {}, n), ` is used by ${plural(count, "style rule")} but never loaded, so visitors see `,
              fam?.fallback ? `the fallback (${fam.fallback.split(",")[0]})` : "their browser's default sans-serif", " instead."),
            el("div", { className: "inline" },
              el("button", { type: "button", className: "btn small", onclick: () => addUpload(n) }, "Upload its files"),
              el("button", { type: "button", className: "btn small", onclick: () => addGoogle(n.replace(/\s+Display$/, "")) }, "Get from Google Fonts"),
              fam ? null : el("button", { type: "button", className: "btn small", onclick: () => update((x) => { x.families.push({ name: n, source: "system", fallback: FALLBACKS[1], faces: [] }); }) }, "Choose a fallback")));
        }),
        ...f.families.map((fam, i) => familyCard(fam, i)),
        el("div", { className: "field" }, el("label", { className: "field-label" }, "Loading behaviour"), display),
        el("datalist", { id: "font-fallbacks" }, ...FALLBACKS.map((v) => el("option", { value: v }))));
    }

    function familyCard(fam, i) {
      const count = [...used.entries()].find(([n]) => n.toLowerCase() === fam.name.toLowerCase())?.[1] || 0;
      const weights = [...new Set((fam.faces || []).map((x) => `${x.weight}${x.style === "italic" ? "i" : ""}`))].sort();
      if (fam.faces?.length) loadPreview(fam.name, fam.faces, blobs);
      const specimen = el("div", { className: "specimen", style: { fontFamily: `"cms-preview-${fam.name}", ${fam.fallback || "sans-serif"}` } },
        "Design that works for people — 0123456789");
      const fallback = el("input", { type: "text", value: fam.fallback || "", placeholder: "e.g. system-ui, Arial, sans-serif", attrs: { list: "font-fallbacks" } });
      fallback.oninput = () => {
        const v = fallback.value;
        const next = clone(fonts()); next.families[i].fallback = v; ctx.set(field.name, next);
        specimen.style.fontFamily = `"cms-preview-${fam.name}", ${v || "sans-serif"}`;
      };
      return el("div", { className: "font-card" },
        el("div", { className: "font-head" },
          el("div", {}, el("strong", { className: "font-name" }, fam.name),
            el("span", { className: "badge" }, { google: "Google font, self-hosted", upload: "Uploaded", system: "Not loaded — fallback only" }[fam.source] || fam.source),
            count ? el("span", { className: "muted small" }, ` · used by ${plural(count, "style rule")}`) : el("span", { className: "muted small" }, " · not used by the stylesheet")),
          el("button", { type: "button", className: "link danger", onclick: async () => {
            if (count && !(await confirmDialog(`Remove ${fam.name}?`, `It's used by ${plural(count, "style rule")}; those will show the fallback font.`, { ok: "Remove", danger: true }))) return;
            update((x) => { x.families.splice(i, 1); });
          } }, "Remove")),
        fam.faces?.length ? specimen : null,
        weights.length ? el("div", { className: "chips small" }, ...weights.map((w) => el("span", { className: "chip" }, `${parseInt(w)} ${WEIGHT_NAMES[parseInt(w)] || ""}${w.endsWith("i") ? " italic" : ""}`))) : null,
        el("label", { className: "field-label small-label" }, "Fallback fonts"),
        fallback,
        el("p", { className: "hint" }, "Shown while the font loads, and on any character it doesn't have. Leave empty to keep the stylesheet's own."));
    }

    paint();
    return wrap;
  },
};

export { GENERIC };
