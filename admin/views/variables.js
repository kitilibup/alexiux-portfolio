/**
 * Variables: the site's design variables on a page of their own, like
 * Webflow's Variables panel - colours, sizes and fonts, what each one is now,
 * what it was, and which styles use it.
 *
 * The site's stylesheet defines the original variables (:root in site.css);
 * changes and new variables are kept in content/settings/design.json
 * ("variables"), the same place the Designer saves them, and the build
 * writes them over the originals. So a change here shows in the Designer and
 * the other way round.
 */
import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, modal, confirmDialog, plural } from "../lib/dom.js?v=6600ab59";
import { store, commit } from "../store.js?v=6600ab59";
import { parseCss, safeValue } from "../lib/css-model.js?v=6600ab59";
import { editorState } from "./editor.js?v=6600ab59";
import { TYPES, typeOf, fits, numericCandidates, suggestName, useVariable, placesUsing, detachVariable } from "../lib/variables.js?v=6600ab59";
import { BREAKPOINTS } from "../lib/css-model.js?v=6600ab59";

const DESIGN = "content/settings/design.json";
const GROUPS = [...TYPES.map((t) => [t.group, t.id]), ["Other", "other"]];
const groupOf = (v) => (GROUPS.find(([, id]) => id === typeOf(v)) || GROUPS.at(-1))[0];
const GLYPH = { size: "\u2194", number: "#", percentage: "%", font: "Aa", other: "\u2026" };
const bpLabel = (id) => BREAKPOINTS.find((b) => b.id === id)?.label || id;
const isHex = (x) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(x).trim());
const hex6 = (x) => (x.length === 4 ? "#" + [...x.slice(1)].map((c) => c + c).join("") : x);
const cleanName = (s) => "--" + String(s).trim().toLowerCase().replace(/^--/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

/** Which selectors use each variable: the stylesheet and the Designer's styles. */
function usage(rules, design) {
  const used = new Map();
  const add = (name, sel) => { if (!used.has(name)) used.set(name, new Set()); used.get(name).add(sel); };
  for (const r of rules) for (const d of r.decls) for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) add(m[1], r.selector);
  for (const bp of Object.values(design.styles || {})) for (const [sel, props] of Object.entries(bp)) for (const v of Object.values(props)) for (const m of String(v).matchAll(/var\(\s*(--[\w-]+)/g)) add(m[1], sel);
  for (const [k, v] of Object.entries(design.variables || {})) for (const m of String(v).matchAll(/var\(\s*(--[\w-]+)/g)) add(m[1], `variable ${k}`);
  return used;
}

/** Rename var(--old) to var(--new) everywhere in the Designer's styles and variables. */
function renameRefs(design, from, to) {
  const re = new RegExp(`var\\(\\s*${from.replace(/[-]/g, "\\-")}(?![\\w-])`, "g");
  for (const bp of Object.values(design.styles || {})) for (const props of Object.values(bp)) for (const k of Object.keys(props)) props[k] = String(props[k]).replace(re, `var(${to}`);
  for (const k of Object.keys(design.variables || {})) design.variables[k] = String(design.variables[k]).replace(re, `var(${to}`);
}

export function variablesView() {
  let original = [], rules = [], design = { variables: {}, styles: {} }, saved = "";
  let query = "";
  const body = el("div", { className: "vars" }, el("p", { className: "hint" }, "Loading variables…"));
  const saveBtn = el("button", { className: "btn primary", disabled: true }, "Save");
  const discardBtn = el("button", { className: "btn", disabled: true }, "Discard changes");
  const summary = el("p", { className: "hint" });

  const value = (name) => design.variables?.[name] ?? original.find((v) => v.name === name)?.value ?? "";
  const all = () => {
    const own = Object.keys(design.variables || {}).filter((k) => !original.some((v) => v.name === k));
    return [...original.map((v) => ({ name: v.name, base: v.value, original: true })), ...own.map((name) => ({ name, base: null, original: false }))];
  };
  const dirty = () => JSON.stringify(design) !== saved;
  const changed = () => {
    const d = dirty();
    editorState.dirty = d;
    saveBtn.disabled = !d;
    discardBtn.disabled = !d;
  };
  const set = (name, val, base) => {
    design.variables = design.variables || {};
    if (base != null && (!val || val === base)) delete design.variables[name];
    else design.variables[name] = val;
    changed();
  };

  function row(v, used) {
    const cur = value(v.name);
    const users = [...(used.get(v.name) || [])];
    const kind = typeOf(cur);
    const color = kind === "color";
    const swatch = el("span", { className: "var-swatch" + (color ? "" : " glyph"), style: color ? { background: cur } : {}, title: (TYPES.find((t) => t.id === kind) || { label: "Other" }).label },
      color ? "" : GLYPH[kind] || GLYPH.other);
    if (kind === "font") swatch.style.fontFamily = cur;
    const text = el("input", { type: "text", value: cur, className: "var-value", "aria-label": `${v.name} value` });
    const pick = color && (isHex(cur) || isHex(v.base || "")) ? el("input", { type: "color", value: hex6(isHex(cur) ? cur : v.base), "aria-label": `Pick ${v.name}` }) : null;
    text.onchange = () => {
      const val = text.value.trim();
      if (val && !safeValue(val)) { toast(`"${val}" isn't a value a variable can hold.`, "error"); text.value = value(v.name); return; }
      if (!val && !v.original) { toast("A variable needs a value — delete it instead.", "error"); text.value = value(v.name); return; }
      set(v.name, val, v.base);
      paint();
    };
    text.oninput = () => { if (color) swatch.style.background = text.value; };
    if (pick) pick.oninput = () => { text.value = pick.value; swatch.style.background = pick.value; set(v.name, pick.value, v.base); };
    if (pick) pick.onchange = () => paint();

    const isChanged = v.original && v.name in (design.variables || {});
    const actions = [el("button", { className: "link", title: `Copy var(${v.name})`, onclick: () => { navigator.clipboard?.writeText(`var(${v.name})`); toast(`Copied var(${v.name})`); } }, "Copy")];
    if (isChanged) actions.push(el("button", { className: "link", title: `Back to ${v.base}`, onclick: () => { delete design.variables[v.name]; changed(); paint(); } }, "Reset"));
    if (!v.original) {
      actions.push(el("button", { className: "link", onclick: () => rename(v) }, "Rename"));
      actions.push(el("button", {
        className: "link danger",
        title: users.length ? `Used by ${users.join(", ")}` : "",
        onclick: async () => {
          const n = placesUsing(design, v.name).length;
          const ok = await confirmDialog(`Delete ${v.name}?`,
            n ? `${plural(n, "style uses", "styles use")} it. They keep its value (${cur}), just no longer linked. It's removed when you save.` : "Nothing uses it. It's removed when you save.",
            { ok: "Delete", danger: true });
          if (!ok) return;
          detachVariable(design, v.name); changed(); paint();
        },
      }, "Delete"));
    }
    return el("div", { className: "var-row" + (isChanged ? " changed" : ""), dataset: { var: v.name } },
      swatch,
      el("div", { className: "var-name" },
        el("strong", {}, v.name.replace(/^--/, "")),
        el("span", { className: "muted small" }, v.original ? (isChanged ? `was ${v.base}` : "from the site's stylesheet") : "added in the CMS")),
      el("div", { className: "var-edit" }, pick, text),
      el("span", { className: "muted small var-uses", title: users.join("\n") },
        users.length ? `Used by ${plural(users.length, "style")}` : "Not used"),
      el("div", { className: "var-actions" }, ...actions));
  }

  async function rename(v) {
    const input = el("input", { type: "text", value: v.name.replace(/^--/, "") });
    const ok = await modal({
      title: `Rename ${v.name}`,
      body: el("div", { className: "fields" }, el("div", { className: "field" }, el("label", { className: "field-label" }, "New name"), input),
        el("p", { className: "hint" }, "Every style that uses it is updated to the new name.")),
      onOpen: () => input.select(),
      actions: [{ label: "Cancel", value: null }, { label: "Rename", primary: true, value: true }],
    });
    if (!ok) return;
    const to = cleanName(input.value);
    if (to === "--" || to === v.name) return;
    if (all().some((x) => x.name === to)) return toast(`${to} already exists.`, "error");
    design.variables[to] = design.variables[v.name];
    delete design.variables[v.name];
    renameRefs(design, v.name, to);
    changed();
    paint();
  }

  function paint() {
    const used = usage(rules, design);
    const list = all().filter((v) => !query || `${v.name} ${value(v.name)}`.toLowerCase().includes(query));
    const groups = GROUPS.map(([g]) => [g, list.filter((v) => groupOf(value(v.name)) === g)]).filter(([, l]) => l.length);
    body.replaceChildren(...(groups.length ? groups.map(([g, l]) => el("section", { className: "var-group" },
      el("h2", {}, g, el("span", { className: "muted" }, ` ${l.length}`)),
      ...l.map((v) => row(v, used)))) : [el("p", { className: "hint" }, "No variable matches.")]));
    const n = all().length, ch = all().filter((v) => v.original && v.name in (design.variables || {})).length;
    summary.textContent = `${plural(n, "variable")}${ch ? ` \u00b7 ${ch} changed from the stylesheet` : ""}. Changing one changes every style that uses it, on every page.`;
    paintFound();
  }

  /* ------------------------------------------- numbers found on the site --
   * Values the stylesheet repeats (spacing, font sizes, radii...): make one a
   * variable and, optionally, switch the places that use it over.
   */
  let family = "", showAll = false;
  const found = el("section", { className: "var-found" });
  function paintFound() {
    const cands = numericCandidates(rules, design);
    if (!cands.length) { found.replaceChildren(); return; }
    const fams = [...new Map(cands.map((c) => [c.family, c.label])).entries()];
    const list = cands.filter((c) => !family || c.family === family);
    const shown = showAll ? list : list.slice(0, 12);
    found.replaceChildren(
      el("h2", {}, "Numbers used across the site", el("span", { className: "muted" }, ` ${cands.length}`)),
      el("p", { className: "hint" }, "Values the site repeats. Make one a variable to change it everywhere at once \u2014 font sizes, spacing, radii, line heights and more."),
      el("div", { className: "chips media-filters" },
        el("button", { type: "button", className: "chip" + (!family ? " active" : ""), onclick: () => { family = ""; showAll = false; paintFound(); } }, "All"),
        ...fams.map(([id, label]) => el("button", { type: "button", className: "chip" + (family === id ? " active" : ""), onclick: () => { family = id; showAll = false; paintFound(); } }, label))),
      ...shown.map((c) => el("div", { className: "var-row found", dataset: { found: `${c.family}:${c.value}` } },
        el("span", { className: "var-swatch glyph" }, GLYPH[typeOf(c.value)] || "#"),
        el("div", { className: "var-name" }, el("strong", {}, c.value), el("span", { className: "muted small" }, c.label)),
        el("span", { className: "muted small", title: c.places.map((p) => `${p.selector} \u2014 ${p.prop} (${bpLabel(p.bp)})`).join("\n") }, `${c.places.length} places`),
        el("span", {}),
        el("div", { className: "var-actions" }, el("button", { className: "link", onclick: () => makeFrom(c) }, "Make a variable")))),
      list.length > shown.length ? el("button", { className: "link", onclick: () => { showAll = true; paintFound(); } }, `Show all ${list.length}`) : null);
  }

  async function makeFrom(c) {
    const nameIn = el("input", { type: "text", value: suggestName(c.family, c.value) });
    const useIt = el("input", { type: "checkbox", checked: true });
    const where = c.places.slice(0, 8).map((p) => el("li", {}, el("code", {}, p.selector), ` ${p.prop}`, p.bp !== "base" ? el("span", { className: "muted" }, ` \u00b7 ${bpLabel(p.bp)}`) : null));
    const ok = await modal({
      title: `Make ${c.value} a variable`,
      body: el("div", { className: "fields" },
        el("div", { className: "field" }, el("label", { className: "field-label" }, "Name"), nameIn),
        el("label", { className: "check" }, useIt, ` Use it in the ${c.places.length} places with ${c.value} (${c.label.toLowerCase()})`),
        el("ul", { className: "var-places" }, ...where, c.places.length > 8 ? el("li", { className: "muted" }, `and ${c.places.length - 8} more`) : null),
        el("p", { className: "hint" }, "They look exactly the same; afterwards, changing the variable changes all of them. Nothing is saved until you press Save.")),
      onOpen: () => nameIn.select(),
      actions: [{ label: "Cancel", value: null }, { label: "Make variable", primary: true, value: true }],
    });
    if (!ok) return;
    const n = cleanName(nameIn.value);
    if (n === "--") return toast("Name the variable.", "error");
    if (all().some((v) => v.name === n)) return toast(`${n} already exists.`, "error");
    useVariable(design, n, c.value, useIt.checked ? c.places : []);
    changed();
    paint();
    toast(useIt.checked ? `${n} made, used in ${plural(c.places.length, "place")}. Save to publish.` : `${n} made. Save to publish.`);
    document.querySelector(`[data-var="${n}"]`)?.scrollIntoView({ block: "center" });
  }

  async function load() {
    const cssFile = (CONFIG.siteCss || []).map((h) => h.replace(/^(\.\.\/)+/, "")).find((h) => !/fonts\.css$/.test(h));
    const [css, d] = await Promise.all([store.backend.readFile(cssFile), store.backend.readJson(DESIGN).catch(() => ({}))]);
    ({ rules, variables: original } = parseCss(css));
    design = { variables: {}, styles: {}, ...d };
    saved = JSON.stringify(design);
    changed();
    paint();
  }

  async function save() {
    if (!dirty()) return;
    saveBtn.disabled = true;
    try {
      await commit([{ path: DESIGN, content: JSON.stringify(design, null, 2) + "\n" }], "CMS: variables", { view: "/" });
      saved = JSON.stringify(design);
      changed();
      paint();
      toast("Variables saved.");
    } catch (err) {
      toast(err.message, "error");
      changed();
    }
  }
  saveBtn.onclick = save;
  editorState.save = save;
  discardBtn.onclick = async () => {
    if (!(await confirmDialog("Discard changes?", "Your unsaved variable changes are thrown away.", { ok: "Discard", danger: true }))) return;
    design = JSON.parse(saved);
    changed();
    paint();
  };

  // New variable, Webflow-style: name, type, value.
  const name = el("input", { type: "text", placeholder: "Name, e.g. accent", "aria-label": "New variable name" });
  const type = el("select", { "aria-label": "Type" }, ...TYPES.map((t) => el("option", { value: t.id }, t.label)));
  const val = el("input", { type: "text", placeholder: "#146ef5", "aria-label": "Value" });
  const swatchPick = el("input", { type: "color", value: "#146ef5", "aria-label": "Pick colour" });
  swatchPick.oninput = () => { val.value = swatchPick.value; };
  type.onchange = () => {
    val.placeholder = TYPES.find((t) => t.id === type.value).example;
    swatchPick.hidden = type.value !== "color";
  };
  const add = () => {
    const n = cleanName(name.value);
    if (n === "--") return toast("Name the variable.", "error");
    if (all().some((v) => v.name === n)) return toast(`${n} already exists.`, "error");
    const v = val.value.trim();
    if (!v || !safeValue(v)) return toast("Give it a value.", "error");
    if (!fits(type.value, v)) {
      const t = TYPES.find((x) => x.id === type.value);
      return toast(`"${v}" isn't a ${t.label.toLowerCase()} (e.g. ${t.example}).`, "error");
    }
    design.variables = design.variables || {};
    design.variables[n] = v;
    name.value = ""; val.value = "";
    changed();
    paint();
    document.querySelector(`[data-var="${n}"]`)?.scrollIntoView({ block: "center" });
  };
  val.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") val.focus(); });

  const search = el("input", { type: "search", className: "search", placeholder: "Search variables", oninput: (e) => { query = e.target.value.toLowerCase(); paint(); } });
  load().catch((err) => { body.replaceChildren(el("p", { className: "hint" }, `Couldn't load the variables: ${err.message}`)); });

  return el("div", { className: "page" },
    el("header", { className: "page-head" },
      el("div", {}, el("h1", {}, "Variables"), el("p", { className: "muted" }, "The site's colours, sizes, numbers, percentages and fonts. Styles use them in the Designer as var(…).")),
      el("div", { className: "actions" }, discardBtn, saveBtn)),
    el("div", { className: "var-new" }, el("strong", {}, "New variable"), name, type, swatchPick, val, el("button", { className: "btn", onclick: add }, "Add")),
    el("div", { className: "picker-bar" }, search), summary, body, found);
}
