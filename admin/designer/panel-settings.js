/**
 * Settings panel: what an element is and does - tag, ID, link, image, video,
 * embed code, visibility per breakpoint, custom attributes.
 */

import { el, toast } from "../lib/dom.js?v=6600ab59";
import { pickImage } from "../views/media.js?v=6600ab59";
import { embedForUrl } from "../lib/project-model.js?v=6600ab59";
import { toSiteHtml, fromSiteHtml, showLocalCopies } from "../lib/dom.js?v=6600ab59";
import { store } from "../store.js?v=6600ab59";
import { elementType, selectorFor, bpLabel } from "./model.js?v=6600ab59";
import { bindContext, clearBindings } from "./bindings.js?v=6600ab59";
import { valueAt } from "../lib/binder.js?v=6600ab59";

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
const BLOCKS = ["div", "section", "header", "footer", "nav", "main", "article", "aside", "address", "figure"];
const TEXTS = ["p", "div", "span", "blockquote", "label"];
const MANAGED = new Set(["class", "id", "style", "href", "target", "rel", "src", "srcset", "sizes", "alt", "loading", "contenteditable", "data-w-id"]);

export function settingsPanel(D) {
  const n = D.selected;
  if (!n && D.selectedComponent) {
    const name = D.selectedComponent;
    return el("div", {},
      el("div", { className: "dz-sec" }, el("div", { className: "dz-sec-title" }, `${D.componentLabel(name)} \u00b7 Component`),
        el("p", { style: { color: "#9b9b9b", lineHeight: "1.5" } }, "Used on every page that has it. Edit it once and every page changes."),
        el("button", { className: "dz-btn primary", onclick: () => D.editComponent(name) }, "Edit component")));
  }
  if (!n) return el("div", { className: "dz-empty" }, "Select an element to see its settings.");
  const tag = n.tagName.toLowerCase();
  const type = elementType(n);
  const out = el("div");
  const sec = (title, ...kids) => el("div", { className: "dz-sec" }, el("div", { className: "dz-sec-title" }, title), ...kids);
  const field = (label, control, hint) => el("div", { className: "dz-field" }, el("label", {}, label), control, hint ? el("small", { style: { color: "#9b9b9b" } }, hint) : null);

  /* ------------------------------------------------- element & tag -- */
  const group = HEADINGS.includes(tag) ? HEADINGS : BLOCKS.includes(tag) && n.children.length ? BLOCKS : TEXTS.includes(tag) && !n.children.length ? TEXTS : null;
  const idInput = el("input", { type: "text", value: n.id || "", placeholder: "e.g. contact" });
  idInput.onchange = () => {
    const v = idInput.value.trim().replace(/\s+/g, "-");
    if (v && D.doc.getElementById(v) && D.doc.getElementById(v) !== n) { toast(`#${v} is already used on this page.`, "error"); return; }
    v ? n.setAttribute("id", v) : n.removeAttribute("id");
    D.changed();
  };
  out.append(sec(`${type} settings`,
    group ? field("Tag", el("select", { onchange: (e) => retag(D, n, e.target.value) }, ...group.map((t) => el("option", { value: t, selected: t === tag }, t.toUpperCase())))) : null,
    field("ID", idInput, "For links to this spot (/page#id) and scripts. The w-node ids place elements in the layout grid — leave those as they are."),
    n.getAttribute("data-w-id") ? field("Interaction", el("input", { type: "text", value: n.getAttribute("data-w-id"), readOnly: true }), "This element is animated (assets/js/interactions.js); the id links it to its animations. Keep it when editing the element.") : null));

  /* ----------------------------------------------------- CMS binding --
   * Webflow's dynamic content: on a collection template page, or inside a
   * Collection List on any page, an element can take its text, image,
   * background, link or visibility from a field of the item. Each binding
   * has its own unbind; unbinding keeps what the element is showing.
   */
  const ctx = bindContext(D, n);
  const listHere = n.hasAttribute("data-cms-collection") ? n : n.querySelector(":scope > [data-cms-collection]");
  if (listHere) out.append(collectionListSection(D, listHere));
  const coll = ctx && D.schemaOf(ctx.collection);
  if (coll) {
    const usable = coll.fields.filter((f) => !f.name.startsWith("__") && !f.name.includes(".") && !["slug", "draft", "order"].includes(f.name));
    const TEXT = ["text", "textarea", "richtext", "number", "date", "select", "email", "url", "phone", "color", "list"];
    const hasPages = !!coll.urlPrefix || ctx.collection === "projects";
    const item = ctx.template ? D.sampleItem(ctx.collection) : D.collectionItems(ctx.collection)[0];
    const labelOf = (name) => (name === "__url" ? `Current ${coll.singular.toLowerCase()} page` : usable.find((f) => f.name === name)?.label || name);

    // One binding row: a field picker that reads "Get … from", plus unbind.
    const bindRow = (label, attr, options, { onBind, onUnbind } = {}) => {
      const cur = n.getAttribute(attr) || "";
      const pick = el("select", { className: cur ? "dz-bound" : "" },
        el("option", { value: "" }, "\u2014 not bound"),
        ...options.map(([v, t]) => el("option", { value: v, selected: v === cur }, t)));
      pick.onchange = () => {
        if (!pick.value) return unbind();
        onBind?.(pick.value);
        n.setAttribute(attr, pick.value);
        D.changed();
        D.paintRight();
      };
      const unbind = () => {
        // Keep what's on show as the element's own static content.
        const keep = onUnbind?.();
        clearBindings(D);
        n.removeAttribute(attr);
        keep?.();
        D.changed();
        D.paintRight();
      };
      return el("div", { className: "dz-field" + (cur ? " bound" : "") }, el("label", {}, label),
        el("div", { className: "dz-bindrow" }, pick,
          cur ? el("button", { className: "dz-unbind", title: `Unbind ${labelOf(cur)}`, onclick: unbind }, "\u00d7") : null));
    };
    const fieldsOf = (types) => usable.filter((f) => types.includes(f.type)).map((f) => [f.name, f.label]);

    const rows = [];
    const textual = !["img", "iframe", "svg", "video", "input", "textarea", "select"].includes(tag) && !n.querySelector("img,div,section,h1,h2,h3,h4,h5,h6,p,ul,ol,figure");
    if (textual) rows.push(bindRow("Text", "data-cms-text", fieldsOf(TEXT), {
      onUnbind: () => { const shown = n.innerHTML; return () => { n.innerHTML = shown; }; },
    }));
    if (tag === "img") {
      rows.push(bindRow("Image", "data-cms-src", fieldsOf(["image"]), {
        onBind: (v) => {
          const f = usable.find((x) => x.name === v);
          if (f?.altField && !n.hasAttribute("data-cms-alt")) n.setAttribute("data-cms-alt", f.altField);
          n.removeAttribute("srcset"); n.removeAttribute("sizes");
        },
        onUnbind: () => { const v = item && valueAt(item, n.getAttribute("data-cms-src")); return () => { if (v) n.setAttribute("src", v); }; },
      }));
      rows.push(bindRow("Alt text", "data-cms-alt", fieldsOf(["text", "textarea"]), {
        onUnbind: () => { const v = n.getAttribute("alt") || ""; return () => n.setAttribute("alt", v); },
      }));
    } else {
      rows.push(bindRow("Background image", "data-cms-bg", fieldsOf(["image"]), {
        onUnbind: () => () => { n.style.removeProperty("background-image"); if (!n.getAttribute("style")) n.removeAttribute("style"); },
      }));
    }
    if (tag === "a") rows.push(bindRow("Link", "data-cms-href", [...(hasPages ? [["__url", labelOf("__url")]] : []), ...fieldsOf(["url", "email", "phone"])], {
      onUnbind: () => { const v = item && valueAt(item, n.getAttribute("data-cms-href")); return () => { if (v) n.setAttribute("href", String(v)); }; },
    }));

    // Conditional visibility: show when a field is set, or when it's empty.
    {
      const showIf = n.getAttribute("data-cms-if"), hideIf = n.getAttribute("data-cms-if-not");
      const mode = el("select", {}, el("option", { value: "" }, "Always visible"),
        el("option", { value: "if", selected: !!showIf }, "Show when field is set"),
        el("option", { value: "if-not", selected: !!hideIf }, "Show when field is empty"));
      const field = el("select", { hidden: !showIf && !hideIf },
        ...usable.map((f) => el("option", { value: f.name, selected: f.name === (showIf || hideIf) }, f.label)));
      const apply = () => {
        clearBindings(D);
        n.removeAttribute("data-cms-if"); n.removeAttribute("data-cms-if-not");
        n.classList.remove("w-condition-invisible");
        if (!n.getAttribute("class")) n.removeAttribute("class");
        if (mode.value) n.setAttribute(`data-cms-${mode.value}`, field.value || usable[0]?.name);
        D.changed();
        D.paintRight();
      };
      mode.onchange = apply;
      field.onchange = apply;
      rows.push(el("div", { className: "dz-field" + (showIf || hideIf ? " bound" : "") }, el("label", {}, "Visibility"), el("div", { className: "dz-bindrow" }, mode, field)));
    }

    // The Webflow template's own bindings (Projects): shown, and unbindable.
    const markers = [...n.querySelectorAll("cms-bind[data-cms-marker]")].filter((m) => m.parentElement === n || m.parentElement?.closest("*") === n);
    for (const m of markers) {
      rows.push(el("div", { className: "dz-field bound" }, el("label", {}, "Text"),
        el("div", { className: "dz-bindrow" }, el("span", { className: "dz-boundname" }, m.getAttribute("data-cms-label")),
          el("button", { className: "dz-unbind", title: "Unbind: keep this text on every item", onclick: () => {
            m.replaceWith(...m.childNodes);
            D.changed();
            D.paintRight();
          } }, "\u00d7"))));
    }

    const where = ctx.template ? `${coll.label} template \u00b7 showing ${item ? String(item[coll.titleField || "title"] ?? item.title ?? item.name ?? item.slug).trim() : "no item"}`
      : `Collection List \u00b7 ${coll.label}`;
    out.append(sec("Collection fields", el("div", { className: "dz-bindctx" }, where), ...rows,
      el("small", { style: { color: "#9b9b9b" } }, ctx.template
        ? "Bound parts show each item's own content. Pick the item to preview at the top."
        : "Each item in the list fills these from its own fields; edit the first item, the others follow.")));
  }

  /* --------------------------------------------------------- link -- */
  if (tag === "a") {
    const href = el("input", { type: "text", value: n.getAttribute("href") || "", placeholder: "https://… or /page" });
    const pages = el("select", {}, el("option", { value: "" }, "Link to a page…"),
      el("optgroup", { label: "Pages" }, ...D.allPages().map((p) => el("option", { value: p.slug === "index" ? "/" : `/${p.slug}` }, D.pageName(p)))),
      el("optgroup", { label: "Projects" }, ...(store.items.projects || []).filter((p) => !p.draft).map((p) => el("option", { value: `/project/${p.slug}` }, String(p.title).trim()))),
      ...(store.items.services ? [el("optgroup", { label: "Services" }, ...store.items.services.filter((p) => !p.draft).map((p) => el("option", { value: `/service/${p.slug}` }, p.name)))] : []),
      el("optgroup", { label: "On this page" }, ...[...D.doc.querySelectorAll("[id]")].filter((x) => !/^w-node|^cms-/.test(x.id)).map((x) => el("option", { value: `#${x.id}` }, `#${x.id}`))));
    const blank = el("input", { type: "checkbox", checked: n.getAttribute("target") === "_blank" });
    const apply = () => {
      let v = href.value.trim();
      if (/^\s*(javascript|vbscript|data):/i.test(v)) { toast("That isn't a link address.", "error"); return; }
      if (/^www\./i.test(v)) v = "https://" + v;
      n.setAttribute("href", toSiteHtml(`href="${v || "#"}"`).slice(6, -1));
      if (blank.checked) n.setAttribute("target", "_blank"); else n.removeAttribute("target");
      D.changed();
    };
    href.onchange = apply;
    pages.onchange = () => { if (pages.value) { href.value = pages.value; apply(); } };
    blank.onchange = apply;
    out.append(sec("Link", field("URL", href), field("", pages), el("label", { className: "dz-check" }, blank, "Open in a new tab")));
  }

  /* -------------------------------------------------------- image -- */
  if (tag === "img") {
    const alt = el("input", { type: "text", value: n.getAttribute("alt") || "", placeholder: "Describe the image" });
    alt.onchange = () => { n.setAttribute("alt", alt.value); D.changed(); };
    const loading = el("select", {}, ...["lazy", "eager"].map((v) => el("option", { value: v, selected: (n.getAttribute("loading") || "lazy") === v }, v === "lazy" ? "Lazy: load when scrolled to" : "Eager: load at once (images at the top)")));
    loading.onchange = () => { n.setAttribute("loading", loading.value); D.changed(); };
    out.append(sec("Image",
      el("img", { className: "dz-img", src: n.getAttribute("src"), alt: "" }),
      el("button", { className: "dz-btn", style: { background: "#383838" }, onclick: async () => {
        const src = await pickImage({ title: "Replace image" });
        if (!src) return;
        // A <picture>'s other versions belong to the old image.
        if (n.parentElement?.tagName === "PICTURE") for (const s of [...n.parentElement.querySelectorAll("source")]) s.remove();
        n.setAttribute("src", toSiteHtml(`src="${src}"`).slice(5, -1));
        n.removeAttribute("data-cms-local-src");
        n.removeAttribute("srcset");
        n.removeAttribute("sizes");
        showLocalCopies(n.parentNode);
        D.changed();
      } }, "Replace image…"),
      field("Alt text", alt, n.getAttribute("alt") ? null : "Missing: screen readers and search engines can't tell what this shows."),
      field("Loading", loading)));
  }

  /* ---------------------------------------------- video and embed -- */
  if (n.classList.contains("w-video") || (n.classList.contains("w-embed") && n.querySelector("iframe"))) {
    const iframe = n.querySelector("iframe");
    const url = el("input", { type: "text", value: iframe?.getAttribute("src") || "", placeholder: "YouTube, Vimeo, Wistia or Loom link" });
    url.onchange = () => {
      const e = embedForUrl(url.value);
      if (!e) { toast("That isn't a video link the site can embed.", "error"); return; }
      n.innerHTML = `<iframe src="${e.src}" width="960" height="540" scrolling="no" title="${e.title}" frameborder="0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture;" allowfullscreen="true"></iframe>`;
      D.changed();
    };
    out.append(sec("Video", field("Video link", url)));
  } else if (n.classList.contains("w-embed")) {
    const code = el("textarea", { rows: 8, value: fromSiteHtml(n.innerHTML), spellcheck: false, style: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "11px" } });
    code.onchange = () => { n.innerHTML = toSiteHtml(code.value); D.changed(); };
    out.append(sec("Embed code", code, el("small", { style: { color: "#9b9b9b" } }, "Runs on the published site, not in the Designer. Only paste code you trust.")));
  }

  /* ----------------------------------------------------- visibility -- */
  const selector = selectorFor(n);
  if (selector) {
    const hidden = (D.design.styles?.[D.bp]?.[selector]?.display) === "none";
    const toggle = el("input", { type: "checkbox", checked: hidden });
    toggle.onchange = () => {
      const styles = D.design.styles || (D.design.styles = {});
      const atBp = styles[D.bp] || (styles[D.bp] = {});
      const props = atBp[selector] || (atBp[selector] = {});
      if (toggle.checked) props.display = "none"; else delete props.display;
      if (!Object.keys(props).length) delete atBp[selector];
      D.styleChanged();
      D.paintRight();
    };
    out.append(sec("Visibility", el("label", { className: "dz-check" }, toggle, `Hide on ${bpLabel(D.bp)}${D.bp === "base" ? " (and every breakpoint)" : /tablet|landscape|portrait/.test(D.bp) ? " and smaller" : " and larger"}`),
      el("small", { style: { color: "#9b9b9b" } }, `Applies to every element with ${selector}.`)));
  }

  /* ---------------------------------------------- custom attributes -- */
  const attrs = [...n.attributes].filter((a) => !MANAGED.has(a.name) && !a.name.startsWith("data-cms"));
  const rows = el("div");
  const paintAttrs = () => {
    rows.replaceChildren(...[...n.attributes].filter((a) => !MANAGED.has(a.name) && !a.name.startsWith("data-cms")).map((a) => {
      const v = el("input", { type: "text", value: a.value });
      v.onchange = () => { n.setAttribute(a.name, v.value); D.changed(); };
      return el("div", { className: "dz-prop" }, el("label", { title: a.name }, a.name), v,
        el("button", { className: "clear", style: { visibility: "visible" }, title: "Remove", onclick: () => { n.removeAttribute(a.name); D.changed(); } }, "×"));
    }));
  };
  paintAttrs();
  const newName = el("input", { type: "text", placeholder: "name" });
  const newVal = el("input", { type: "text", placeholder: "value" });
  const add = () => {
    const name = newName.value.trim().toLowerCase();
    if (!/^[a-z][\w:-]*$/.test(name) || /^on/.test(name) || MANAGED.has(name)) { toast("Use a plain attribute name (not an event handler).", "error"); return; }
    n.setAttribute(name, newVal.value);
    D.changed();
  };
  newVal.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  out.append(sec("Custom attributes", rows, el("div", { className: "dz-color" }, newName, newVal, el("button", { className: "dz-btn", onclick: add }, "+"))));
  void attrs;

  /* -------------------------------------------------------- actions -- */
  out.append(sec("Element",
    el("div", { className: "dz-color" },
      el("button", { className: "dz-btn", style: { background: "#383838" }, onclick: () => { const p = n.parentElement; D.select(D.isEditable(p) ? p : null); } }, "Select parent"),
      el("button", { className: "dz-btn", style: { background: "#383838" }, onclick: () => D.duplicate(n) }, "Duplicate"),
      el("button", { className: "dz-btn", style: { background: "#5a2a2a" }, onclick: () => D.remove(n) }, "Delete"))));
  return out;
}

/** Change an element's tag, keeping attributes and children. */
function retag(D, n, tag) {
  if (n.tagName.toLowerCase() === tag) return;
  const m = D.doc.createElement(tag);
  for (const a of n.attributes) m.setAttribute(a.name, a.value);
  while (n.firstChild) m.appendChild(n.firstChild);
  n.replaceWith(m);
  D.changed();
  D.select(m);
}

/** A Collection List: which collection, how many items. */
function collectionListSection(D, list) {
  const name = list.getAttribute("data-cms-collection");
  const names = D.collectionNames().filter((c) => c !== "pages");
  const pick = el("select", {}, ...names.map((c) => el("option", { value: c, selected: c === name }, D.schemaOf(c)?.label || c)));
  const limit = el("input", { type: "number", min: 0, placeholder: "all", value: list.getAttribute("data-cms-limit") || "" });
  pick.onchange = () => {
    clearBindings(D);
    list.setAttribute("data-cms-collection", pick.value);
    const empty = list.parentElement?.querySelector(":scope > [data-cms-empty-collection]");
    if (empty) empty.setAttribute("data-cms-empty-collection", pick.value);
    D.changed();
    D.paintRight();
  };
  limit.onchange = () => {
    clearBindings(D);
    const v = Math.max(0, Math.floor(Number(limit.value) || 0));
    if (v) list.setAttribute("data-cms-limit", String(v)); else list.removeAttribute("data-cms-limit");
    D.changed();
  };
  const count = D.collectionItems(name).length;
  return el("section", { className: "dz-sec" },
    el("div", { className: "dz-sec-title" }, "Collection List"),
    el("div", { className: "dz-field bound" }, el("label", {}, "Source"), pick),
    el("div", { className: "dz-field" }, el("label", {}, "Show at most"), limit),
    el("small", { style: { color: "#9b9b9b" } }, `${count} published item${count === 1 ? "" : "s"}. Select an element inside the first item to bind it to a field.`));
}
