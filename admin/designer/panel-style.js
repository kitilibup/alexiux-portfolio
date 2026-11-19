/**
 * Style panel: style the selected element's class (or a class picked in the
 * Style selectors) at the current breakpoint and state.
 *
 * Every property shows where its value comes from, like Webflow:
 *   blue label     set at this breakpoint (× clears it)
 *   orange label   inherited from a larger/smaller breakpoint
 *   placeholder    the computed value the element has right now
 * Edits are design overrides (content/settings/design.json), never changes
 * to Webflow's CSS.
 */

import { el, toast } from "../lib/dom.js?v=6600ab59";

/** A value the browser accepts for the property ("!important" allowed). */
export function validCss(prop, value) {
  const v = String(value || "").replace(/\s*!important\s*$/i, "").trim();
  if (!v || prop.startsWith("--")) return true;
  try { return CSS.supports(prop, v); } catch { return true; }
}
import { typeOf } from "../lib/variables.js?v=6600ab59";
import { STYLE_SECTIONS, authoredValue, selectorFor, customClasses, bpLabel, contextsFor, tagSelectorFor, selectorLabel, TAG_SELECTORS } from "./model.js?v=6600ab59";
import { BREAKPOINTS } from "../lib/css-model.js?v=6600ab59";

const STATES = [["", "None"], [":hover", "Hover"], [":active", "Pressed"], [":focus", "Focused"]];
const GENERIC_FONTS = ["system-ui", "Arial", "Helvetica", "Georgia", "Times New Roman", "monospace"];

export function stylePanel(D) {
  const n = D.selected;
  if (!n && !D.styleTarget && D.selectedComponent) {
    return el("div", { className: "dz-empty" }, `${D.componentLabel(D.selectedComponent)} is a component. Double-click it (or Edit component in Settings) to select and style what's inside. ${D.componentUsageText(D.selectedComponent)}`);
  }
  if (!n && !D.styleTarget) {
    return el("div", { className: "dz-empty" }, "Select an element on the canvas or in the Navigator to style it.", el("br"), el("br"),
      "Or pick a class in the Style selectors panel (G) or a sample in the Style Guide to edit it everywhere it's used.");
  }

  // Webflow: click a class chip to choose what you style - the first class
  // alone (everywhere it's used) or the combination up to that chip.
  const chain = n ? customClasses(n) : [];
  const level = Math.min(D.selectorLevel ?? chain.length - 1, chain.length - 1);
  // No class: Webflow styles the tag ("All H1 Headings") on every page.
  const base = D.styleTarget || (chain.length ? chain.slice(0, level + 1).map((c) => "." + c).join("") : selectorFor(n) || tagSelectorFor(n));
  const isTag = base in TAG_SELECTORS;
  const state = D.state || "";
  const sel = base ? base + state : "";
  const wrap = el("div");

  /* ------------------------------------------------------ selector -- */
  const selectorBox = el("div", { className: "dz-sec" });
  {
    const input = el("input", { type: "text", placeholder: base ? "+ class" : "Add or create a class to style this element", attrs: { list: "dz-classes" } });
    const datalist = el("datalist", { id: "dz-classes" }, ...[...D.classes.keys()].filter((c) => !/^w-/.test(c)).sort().map((c) => el("option", { value: c })));
    const tagChip = () => [el("span", { className: "dz-chip tag", title: `Styles every <${base}> without a class, on every page` }, selectorLabel(base))];
    const chips = n && !chain.length && isTag ? tagChip() : n ? chain.map((c, i) => el("span", {
        className: "dz-chip" + (i > 0 ? " combo" : "") + (i > level ? " level-off" : ""),
        title: i === 0 ? `Style .${c} everywhere it's used` : `Style the combination ${chain.slice(0, i + 1).map((x) => "." + x).join("")} only`,
        style: { cursor: "pointer" },
        onclick: (e) => { if (e.target.tagName === "BUTTON") return; D.selectorLevel = i; D.paintRight(); },
      },
      c, el("button", { title: `Remove ${c}`, onclick: () => { n.classList.remove(c); if (!n.getAttribute("class")) n.removeAttribute("class"); D.selectorLevel = null; D.changed(); } }, "\u00d7")))
      : isTag ? tagChip() : [el("span", { className: "dz-chip" }, base.replace(/^\./, ""))];
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = input.value.trim().replace(/^\./, "").replace(/\s+/g, "-").replace(/[^\w-]/g, "").toLowerCase();
      if (!name || !n) return;
      n.classList.add(name);
      D.changed();
    });
    input.addEventListener("change", () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
    selectorBox.append(
      el("div", { className: "dz-sec-title" }, "Selector", n ? el("span", { className: "dz-status" }, n.tagName.toLowerCase()) : null),
      el("div", { className: "dz-selector" }, ...chips, n ? input : null, datalist),
      el("div", { className: "dz-meta" },
        el("span", {}, "State"),
        el("select", { onchange: (e) => { D.state = e.target.value; D.paintRight(); } },
          ...STATES.map(([v, t]) => el("option", { value: v, selected: v === state }, t)))),
      el("div", { className: "dz-bpnote" }, ...bpNote(D.bp)),
      n && (D.animHidden || []).some((x) => { try { return n.matches(x); } catch { return false; } })
        ? el("div", { className: "dz-bpnote" }, "Hidden when the page loads \u2014 an animation reveals it. Faded here so it doesn't cover the page; Preview shows it as on the site.") : null,
      base ? el("div", { className: "dz-bpnote" }, usageNote(D, base)) : null);
  }
  wrap.append(selectorBox);

  if (!sel) {
    wrap.append(el("div", { className: "dz-empty" }, "This element has no class yet. Add one above — styles are saved on classes, so every element with that class looks the same."));
    return wrap;
  }

  /* ---------------------------------------------------- properties -- */
  const computed = n && !state ? D.win.getComputedStyle(n) : null;
  const displayNow = authoredValue(D.index, D.design, sel, "display", D.bp).value || computed?.display || "";

  // Returns false (and changes nothing) for a value the browser wouldn't accept.
  const setValue = (prop, value) => {
    if (value && !validCss(prop, value)) return false;
    const styles = D.design.styles || (D.design.styles = {});
    const atBp = styles[D.bp] || (styles[D.bp] = {});
    const props = atBp[sel] || (atBp[sel] = {});
    if (value) props[prop] = value; else delete props[prop];
    if (!Object.keys(props).length) delete atBp[sel];
    if (!Object.keys(atBp).length) delete styles[D.bp];
    D.styleChanged();
    return true;
  };

  const rowState = (row, prop) => {
    const a = authoredValue(D.index, D.design, sel, prop, D.bp);
    row.classList.toggle("here", a.here && a.override);
    row.classList.toggle("inherited", !!a.value && !a.here);
    row.title = a.value ? (a.here ? `${prop}: ${a.value} — set at ${bpLabel(D.bp)}${a.override ? "" : " (site stylesheet)"}` : `${prop}: ${a.value} — inherited from ${bpLabel(a.from)}`) : prop;
    return a;
  };

  const control = (spec, row) => {
    const prop = spec.p;
    const a = rowState(row, prop);
    const live = computed ? computed.getPropertyValue(prop) : "";
    const ov = D.design.styles?.[D.bp]?.[sel]?.[prop];
    const current = ov ?? (a.here ? a.value : "");
    const placeholder = (a.value && !a.here ? a.value : "") || live || "";
    const commitV = (v) => {
      const ok = setValue(prop, v.trim());
      row.classList.toggle("invalid", !ok);
      if (!ok) toast(`"${v.trim()}" isn't a valid ${spec.label || prop} \u2014 nothing was changed.`, "error");
      rowState(row, prop);
    };

    if (spec.kind === "select") {
      const s = el("select", {}, ...spec.options.map((o) => el("option", { value: o, selected: o === current }, o || (placeholder ? `— ${placeholder}` : "—"))));
      s.onchange = () => commitV(s.value);
      return s;
    }
    if (spec.kind === "color") {
      const text = el("input", { type: "text", value: current, placeholder });
      const toHex = (v) => { const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? "#" + m.slice(1, 4).map((x) => (+x).toString(16).padStart(2, "0")).join("") : /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"; };
      const pick = el("input", { type: "color", value: toHex(current || live) });
      const vars = el("select", { title: "Use a variable" }, el("option", { value: "" }, "var"),
        ...allVariables(D).filter((v) => /^#|rgb|hsl|var\(/i.test(v.value)).map((v) => el("option", { value: `var(${v.name})`, selected: current === `var(${v.name})` }, v.name.replace(/^--/, ""))));
      text.oninput = () => commitV(text.value);
      pick.oninput = () => { text.value = pick.value; commitV(pick.value); };
      vars.onchange = () => { if (vars.value) { text.value = vars.value; commitV(vars.value); } };
      return el("div", { className: "dz-color" }, pick, text, vars);
    }
    if (spec.kind === "font") {
      const fams = (D.fonts.families || []).filter((f) => f.faces?.length);
      const stackFor = (name) => {
        const f = fams.find((x) => x.name === name);
        return f ? `'${name}', ${f.fallback || "sans-serif"}` : GENERIC_FONTS.includes(name) ? `${name}${/serif|mono|system/.test(name) ? "" : ", sans-serif"}` : name;
      };
      const firstOf = (v) => String(v || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
      const s = el("select", {},
        el("option", { value: "" }, placeholder ? `— ${firstOf(placeholder)}` : "—"),
        el("optgroup", { label: "Site fonts" }, ...fams.map((f) => el("option", { value: f.name, selected: firstOf(current) === f.name }, f.name))),
        el("optgroup", { label: "System" }, ...GENERIC_FONTS.map((g) => el("option", { value: g, selected: firstOf(current) === g }, g))));
      s.onchange = () => commitV(s.value ? stackFor(s.value) : "");
      return s;
    }
    const input = el("input", { type: "text", value: current, placeholder });
    input.oninput = () => commitV(input.value);
    if (spec.kind !== "length" && spec.kind !== "number") return input;
    input.addEventListener("keydown", (e) => nudge(e, input, () => commitV(input.value), spec.p === "opacity" ? 0.1 : spec.kind === "number" ? 1 : 0));
    // Variables that fit: sizes (and percentages, numbers for line-height) for
    // lengths; numbers and percentages for opacity, z-index.
    const fitting = numericVariables(D, spec.kind === "number" ? ["number", "percentage"] : ["size", "percentage", "number"]);
    if (!fitting.length) return input;
    const vars = el("select", { title: "Use a variable", className: current.startsWith("var(") ? "on" : "" }, el("option", { value: "" }, "var"),
      ...fitting.map((v) => el("option", { value: `var(${v.name})`, selected: current === `var(${v.name})` }, `${v.name.replace(/^--/, "")} \u00b7 ${v.value}`)));
    vars.onchange = () => { if (vars.value) { input.value = vars.value; commitV(vars.value); } };
    return el("div", { className: "dz-color" }, input, vars);
  };

  for (const sec of STYLE_SECTIONS) {
    const body = el("div", { className: "dz-sec" }, el("div", { className: "dz-sec-title" }, sec.title));
    if (sec.box) {
      body.append(spacingBox(sec.props, (prop) => {
        const a = authoredValue(D.index, D.design, sel, prop, D.bp);
        const ov = D.design.styles?.[D.bp]?.[sel]?.[prop];
        return { value: ov ?? (a.here ? a.value : ""), placeholder: (a.value && !a.here ? a.value : "") || (computed ? computed.getPropertyValue(prop) : ""), here: a.here && a.override, inherited: !!a.value && !a.here };
      }, (prop, v) => setValue(prop, v)));
    } else {
      for (const spec of sec.props) {
        if (spec.when && !new RegExp(`^(${spec.when})$`).test(displayNow)) continue;
        const row = el("div", { className: "dz-prop" });
        const clear = el("button", { className: "clear", title: "Clear this breakpoint's value", onclick: () => { setValue(spec.p, ""); D.paintRight(); } }, "×");
        row.append(el("label", {}, labelFor(spec.p)), control(spec, row), clear);
        body.append(row);
      }
    }
    wrap.append(body);
  }
  return wrap;
}

/** How many elements a style change reaches, on this page. */
function usageNote(D, selector) {
  let n = 0;
  try { n = D.doc.querySelectorAll(selector).length; } catch { /* odd selector */ }
  if (selector in TAG_SELECTORS) return `${selectorLabel(selector)} \u2014 every <${selector}> without its own class style, on every page (${n} on this one). Add a class to style one on its own.`;
  return `${selector} \u2014 ${n} element${n === 1 ? "" : "s"} on this page${n > 1 ? " change together" : ""}. Styles apply on every page that uses it.`;
}

function bpNote(bp) {
  const chain = contextsFor(bp).map(bpLabel);
  if (bp === "base") return ["Editing ", el("b", {}, "Desktop"), ": the base. Styles here apply to every breakpoint unless one sets its own."];
  return ["Editing ", el("b", {}, bpLabel(bp)), `: overrides ${chain.slice(0, -1).join(" › ")}. Orange values are inherited.`];
}

function labelFor(p) {
  return { "grid-template-columns": "Columns", "grid-column-gap": "Col gap", "grid-row-gap": "Row gap", "justify-content": "Justify", "align-items": "Align",
    "flex-direction": "Direction", "flex-wrap": "Wrap", "font-family": "Font", "font-weight": "Weight", "font-size": "Size", "line-height": "Height",
    "letter-spacing": "Spacing", "text-align": "Align", "text-transform": "Case", "font-style": "Style", "text-decoration": "Decoration", "white-space": "Breaking",
    "background-color": "Color", "background-image": "Image", "background-size": "Size", "background-position": "Position", "border-radius": "Radius",
    "border-width": "Width", "border-style": "Style", "border-color": "Color", "box-shadow": "Shadow", "min-width": "Min W", "max-width": "Max W",
    "min-height": "Min H", "max-height": "Max H", "object-fit": "Fit", "z-index": "z-index" }[p] || p.charAt(0).toUpperCase() + p.slice(1);
}

/** Arrow keys change numbers, like Webflow (Shift: by 10). */
function nudge(e, input, done, unitless = 0) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  const m = (input.value || input.placeholder).match(/^(-?\d*\.?\d+)(px|rem|em|%|vw|vh)?$/);
  if (!m) return;
  e.preventDefault();
  // unitless: the step for a plain number (opacity 0.1, z-index 1).
  const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1) * (/rem|em/.test(m[2] || "") ? 0.1 : !m[2] && unitless ? unitless : 1);
  input.value = `${Math.round((parseFloat(m[1]) + step) * 100) / 100}${m[2] || (unitless ? "" : "px")}`;
  done();
}

/** Webflow's margin/padding box. */
function spacingBox(props, info, set) {
  const input = (prop, cls) => {
    const i = info(prop);
    const x = el("input", { type: "text", className: cls + (i.here ? " here" : i.inherited ? " inherited" : ""), value: i.value, placeholder: shortLen(i.placeholder), title: prop });
    // Applied as you type once the value is valid; an unfinished one waits.
    x.oninput = () => x.classList.toggle("invalid", set(prop, x.value.trim()) === false);
    x.addEventListener("keydown", (e) => nudge(e, x, () => set(prop, x.value.trim())));
    return x;
  };
  const [mt, mr, mb, ml, pt, pr, pb, pl] = props.map((p) => p.p);
  const inner = el("div", { className: "dz-box inner" }, el("span", { className: "lbl" }, "Padding"),
    input(pt, "t"), input(pr, "r"), input(pb, "b"), input(pl, "l"), el("span", { className: "core" }));
  return el("div", { className: "dz-box" }, el("span", { className: "lbl" }, "Margin"),
    input(mt, "t"), input(mr, "r"), input(mb, "b"), input(ml, "l"), inner);
}

const shortLen = (v) => String(v || "").replace(/(\.\d)\d+px/, "$1px");

export { BREAKPOINTS };

/** Webflow's variables plus the ones created in the Designer. */
/** Variables holding these kinds of value (admin/lib/variables.js typeOf), with their current values. */
export function numericVariables(D, kinds) {
  return allVariables(D).map((v) => ({ name: v.name, value: D.design.variables?.[v.name] ?? v.value })).filter((v) => kinds.includes(typeOf(v.value)));
}

export function allVariables(D) {
  const own = Object.entries(D.design.variables || {}).filter(([k]) => !D.parsed.variables.some((v) => v.name === k)).map(([name, value]) => ({ name, value }));
  return [...D.parsed.variables, ...own];
}
