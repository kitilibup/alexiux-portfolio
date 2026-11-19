/**
 * Field controls, chosen by the `type` in a collection's schema.
 *
 * Every control gets a context:
 *   ctx.get(name)            current value in the draft
 *   ctx.set(name, value)     update the draft (marks it dirty, refreshes previews)
 *   ctx.subscribe(fn)        called after any field changes
 *   ctx.draft / ctx.original / ctx.collection / ctx.isNew
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, slugify, assetUrl, getField, plural, withLocalCopies } from "../lib/dom.js?v=6600ab59";
import { embedForUrl, fillCard, findEl, MAX_TAGS, withPositions } from "../lib/project-model.js?v=6600ab59";
import { formTarget } from "../lib/contact-form.js?v=6600ab59";
import { store } from "../store.js?v=6600ab59";
import { pickImage } from "../views/media.js?v=6600ab59";
import { richTextField } from "./richtext.js?v=6600ab59";
import { canvasField } from "./canvas.js?v=6600ab59";
import { seoTypes } from "./seo.js?v=6600ab59";
import { fontTypes } from "./fonts.js?v=6600ab59";
import { effectiveSeo, siteBase } from "../lib/seo.js?v=6600ab59";

/** Recommended lengths before search engines truncate. */
const LIMITS = { "seo.title": 60, "seo.description": 160, cardDescription: 90 };

export function fieldControl(field, ctx) {
  const id = "f_" + field.name.replace(/\W/g, "_");
  const control = (TYPES[field.type] || seoTypes[field.type] || fontTypes[field.type] || TYPES.text)(field, ctx, id);

  const limit = field.limit || LIMITS[field.name];
  const counter = limit ? el("span", { className: "counter" }) : null;
  const paintCounter = () => {
    if (!counter) return;
    const n = String(ctx.get(field.name) ?? "").length;
    counter.textContent = `${n}/${limit}`;
    counter.className = "counter" + (n > limit ? " over" : n === 0 ? " empty" : "");
  };
  paintCounter();

  const wrapper = el("div", {
    className: `field type-${field.type}` + (field.width === "half" ? " half" : "") + (field.wide ? " wide" : ""),
    dataset: { field: field.name },
  },
    field.label && !field.hideLabel
      ? el("label", { htmlFor: id, className: "field-label" },
          field.label, field.required ? el("span", { className: "req", title: "Required" }, " *") : null, counter)
      : null,
    control,
    field.help ? el("p", { className: "hint" }, field.help) : null);

  ctx.subscribe(() => {
    paintCounter();
    if (field.showIf) wrapper.hidden = !visible(field.showIf, ctx);
  });
  if (field.showIf) wrapper.hidden = !visible(field.showIf, ctx);
  return wrapper;
}

function visible(rule, ctx) {
  const v = ctx.get(rule.field);
  if (rule.in) return rule.in.includes(v);
  if ("equals" in rule) return v === rule.equals;
  return !!v;
}

/* -------------------------------------------------------------- simple -- */

const input = (type) => (field, ctx, id) => {
  const node = el("input", {
    type, id, value: ctx.get(field.name) ?? "",
    placeholder: field.placeholder || "",
    autocomplete: "off",
    spellcheck: type === "text",
  });
  node.oninput = () => ctx.set(field.name, field.omitEmpty && node.value === "" ? undefined : node.value);
  if (type === "url") node.onblur = () => {
    const v = node.value.trim();
    if (v && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) { node.value = "https://" + v; ctx.set(field.name, node.value); }
  };
  return node;
};

const TYPES = {
  text: input("text"),
  url: input("url"),
  email: input("email"),
  password: (field, ctx, id) => {
    const node = input("password")(field, ctx, id);
    const show = el("button", { type: "button", className: "link", onclick: () => {
      node.type = node.type === "password" ? "text" : "password";
      show.textContent = node.type === "password" ? "Show" : "Hide";
    } }, "Show");
    return el("div", { className: "inline" }, node, show);
  },

  textarea(field, ctx, id) {
    const node = el("textarea", { id, rows: field.rows || 3, value: ctx.get(field.name) ?? "", placeholder: field.placeholder || "" });
    node.oninput = () => ctx.set(field.name, field.omitEmpty && node.value === "" ? undefined : node.value);
    return node;
  },

  number(field, ctx, id) {
    const node = el("input", { type: "number", id, value: ctx.get(field.name) ?? "", min: field.min, step: 1 });
    node.oninput = () => ctx.set(field.name, node.value === "" ? 0 : Number(node.value));
    return node;
  },

  toggle(field, ctx, id) {
    const node = el("input", { type: "checkbox", id, checked: !!ctx.get(field.name), className: "switch" });
    node.onchange = () => ctx.set(field.name, node.checked);
    return el("label", { className: "toggle", htmlFor: id }, node, el("span", {}, field.toggleLabel || ""));
  },

  select(field, ctx, id) {
    const node = el("select", { id },
      ...field.options.map((o) => el("option", { value: o.value, selected: ctx.get(field.name) === o.value }, o.label)));
    node.onchange = () => ctx.set(field.name, node.value);
    return node;
  },

  /** The URL. Follows the name while a record is new; edited by hand after that. */
  slug(field, ctx, id) {
    const node = el("input", { type: "text", id, value: ctx.get(field.name) ?? "", spellcheck: false, autocomplete: "off" });
    const note = el("p", { className: "hint warn", hidden: true },
      "Changing the URL breaks links to the old one — including any you've shared. References from other projects are updated for you.");
    // Only an unpublished record's URL follows its name. A published URL is
    // what people have bookmarked and shared; it changes only when edited here.
    let follow = (ctx.isNew || !!ctx.original.draft) && ctx.get(field.name) === slugify(ctx.get(field.sourceField));
    node.oninput = () => {
      follow = false;
      ctx.set(field.name, slugify(node.value));
    };
    node.onblur = () => { node.value = slugify(node.value); ctx.set(field.name, node.value); };
    ctx.subscribe((changed) => {
      if (follow && changed === field.sourceField) {
        node.value = slugify(ctx.get(field.sourceField));
        ctx.set(field.name, node.value);
      }
      note.hidden = ctx.isNew || ctx.get(field.name) === ctx.original.slug || !!ctx.original.draft;
    });
    return el("div", {},
      el("div", { className: "slug-field" }, el("span", { className: "slug-prefix" }, field.prefix || "/"), node),
      note);
  },

  /* --------------------------------------------------------------- media -- */

  image(field, ctx, id) {
    const preview = el("div", { className: "image-preview" });
    const pathLabel = el("code", { className: "path" });
    const alt = field.altField ? el("input", {
      type: "text", placeholder: "Alt text — describe the image for screen readers",
      value: ctx.get(field.altField) ?? "", className: "alt",
      oninput: (e) => { ctx.set(field.altField, e.target.value); e.target.classList.toggle("needs-alt", !e.target.value); },
    }) : null;
    if (alt) alt.classList.toggle("needs-alt", !alt.value);

    const paint = () => {
      const v = ctx.get(field.name);
      preview.replaceChildren(v
        ? el("img", { src: assetUrl(v), alt: "", onclick: choose })
        : el("button", { type: "button", className: "empty-image", onclick: choose }, "Choose image"));
      pathLabel.textContent = v ? v.split("/").pop() : "";
      remove.hidden = !v || field.required;
    };
    const choose = async () => {
      const picked = await pickImage({ title: field.label });
      if (!picked) return;
      ctx.set(field.name, picked);
      // Responsive variants Webflow generated belong to the old image.
      for (const f of field.clearOnChange || []) ctx.set(f, "");
      paint();
    };
    const remove = el("button", { type: "button", className: "link danger", onclick: () => { ctx.set(field.name, ""); paint(); } }, "Remove");
    // A field that follows another (Card image <- Hero image) takes its new
    // picture while it was empty or the same as the old one; once a different
    // picture is chosen here, it stays.
    if (field.follows && ctx.subscribe) ctx.subscribe((name, prev) => {
      if (name !== field.follows) return;
      const mine = ctx.get(field.name);
      if (mine && mine !== prev) return;
      ctx.set(field.name, ctx.get(field.follows) || "");
      paint();
    });
    const node = el("div", { className: "image-field", id },
      preview,
      el("div", { className: "image-meta" },
        pathLabel,
        el("div", { className: "inline" }, el("button", { type: "button", className: "btn small", onclick: choose }, "Choose…"), remove),
        alt));
    paint();
    return node;
  },

  /** Ordered list of images, each with alt text. */
  gallery(field, ctx, id) {
    const grid = el("div", { className: "gallery", id });
    const summary = el("span", { className: "muted" });
    let dragFrom = null;

    const items = () => ctx.get(field.name) || [];
    const save = (list) => { ctx.set(field.name, list); paint(); };

    const paint = () => {
      const list = items();
      summary.textContent = list.length ? plural(list.length, "image") : "No images";
      grid.replaceChildren(...list.map((img, i) => {
        const card = el("div", { className: "gallery-item", draggable: true },
          el("img", { src: assetUrl(img.src), alt: "", loading: "lazy" }),
          el("div", { className: "gallery-tools" },
            el("span", { className: "handle", title: "Drag to reorder" }, "☰"),
            el("span", { className: "gallery-n" }, String(i + 1)),
            el("button", { type: "button", className: "icon-btn", title: "Remove from gallery", attrs: { "aria-label": "Remove" },
              onclick: () => save(list.filter((_, j) => j !== i)) }, "×")),
          el("input", {
            type: "text", value: img.alt || "", placeholder: "Alt text",
            className: img.alt ? "" : "needs-alt",
            oninput: (e) => {
              const next = items().map((x, j) => (j === i ? { ...x, alt: e.target.value } : x));
              ctx.set(field.name, next);
              e.target.className = e.target.value ? "" : "needs-alt";
            },
          }));
        card.addEventListener("dragstart", (e) => { dragFrom = i; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("drop-target"); });
        card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
        card.addEventListener("drop", (e) => {
          e.preventDefault();
          card.classList.remove("drop-target");
          if (dragFrom == null || dragFrom === i) return;
          const next = [...items()];
          const [moved] = next.splice(dragFrom, 1);
          next.splice(i, 0, moved);
          dragFrom = null;
          save(next);
        });
        return card;
      }));
    };

    const add = el("button", { type: "button", className: "btn small", onclick: async () => {
      const picked = await pickImage({ multiple: true, title: "Add to gallery" });
      if (picked?.length) save([...items(), ...picked.map((src) => ({ src, alt: "" }))]);
    } }, "Add images…");

    paint();
    return el("div", {}, el("div", { className: "inline space" }, summary, add), grid);
  },

  /** A video URL. Webflow's original embeds are kept until the URL is changed. */
  video(field, ctx, id) {
    const v = ctx.get(field.name);
    const node = el("input", { type: "url", id, value: v?.url || "", placeholder: "https://www.youtube.com/watch?v=… — or Vimeo, Wistia, Loom" });
    const status = el("p", { className: "hint" });
    const paint = () => {
      const cur = ctx.get(field.name);
      if (!cur?.url) { status.textContent = "No video. The section is hidden on the page."; status.className = "hint"; return; }
      if (cur.embed) { status.textContent = "Using the embed already on the page. Change the link to replace it."; status.className = "hint"; return; }
      const e = embedForUrl(cur.url);
      status.textContent = e ? `✓ ${e.title.replace(" video", "")} video — embedded with the provider's own player.` : "Not a YouTube, Vimeo, Wistia or Loom link — it won't be shown.";
      status.className = e ? "hint ok" : "hint warn";
    };
    node.oninput = () => {
      const url = node.value.trim();
      const cur = ctx.get(field.name);
      // Same URL as the original embed: keep the original markup untouched.
      if (cur?.embed && url === ctx.original[field.name]?.url) ctx.set(field.name, ctx.original[field.name]);
      else ctx.set(field.name, url ? { url } : null);
      paint();
    };
    paint();
    return el("div", {}, node, status);
  },

  /* ---------------------------------------------------------------- lists -- */

  /** Short strings as removable, reorderable chips, with suggestions from the collection. */
  list(field, ctx, id) {
    const max = field.max || MAX_TAGS;
    const chips = el("div", { className: "chips" });
    const listId = id + "_suggest";
    const entry = el("input", { type: "text", id, placeholder: field.placeholder || "Add and press Enter", attrs: { list: listId }, autocomplete: "off" });
    const datalist = el("datalist", { id: listId });
    let dragFrom = null;

    const values = () => ctx.get(field.name) || [];
    const paint = () => {
      const list = values();
      chips.replaceChildren(...list.map((t, i) => {
        const chip = el("span", { className: "chip", draggable: true },
          t, el("button", { type: "button", className: "chip-x", title: `Remove ${t}`, attrs: { "aria-label": `Remove ${t}` },
            onclick: () => { ctx.set(field.name, list.filter((_, j) => j !== i)); paint(); } }, "×"));
        chip.addEventListener("dragstart", () => { dragFrom = i; });
        chip.addEventListener("dragover", (e) => e.preventDefault());
        chip.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragFrom == null || dragFrom === i) return;
          const next = [...values()];
          const [m] = next.splice(dragFrom, 1);
          next.splice(i, 0, m);
          dragFrom = null;
          ctx.set(field.name, next);
          paint();
        });
        return chip;
      }));
      entry.disabled = list.length >= max;
      entry.placeholder = list.length >= max ? `${max} is the most the layout fits` : (field.placeholder || "Add and press Enter");
      // Suggest what other entries use, so the same tag is spelled the same way.
      const used = new Set(list.map((x) => x.toLowerCase()));
      const all = new Map();
      for (const r of store.items[ctx.collection] || []) for (const t of r[field.name] || []) all.set(t.toLowerCase(), t);
      datalist.replaceChildren(...[...all.values()].filter((t) => !used.has(t.toLowerCase())).sort().map((t) => el("option", { value: t })));
    };
    const add = () => {
      const t = entry.value.trim().replace(/\s+/g, " ");
      if (!t) return;
      const list = values();
      if (list.some((x) => x.toLowerCase() === t.toLowerCase())) { entry.value = ""; return; }
      if (list.length >= max) return toast(`${field.label}: at most ${max}.`, "error");
      ctx.set(field.name, [...list, t]);
      entry.value = "";
      paint();
    };
    entry.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
      if (e.key === "Backspace" && !entry.value && values().length) {
        ctx.set(field.name, values().slice(0, -1)); paint();
      }
    });
    entry.addEventListener("change", add);   // picking a suggestion
    paint();
    return el("div", { className: "chips-field" }, chips, entry, datalist);
  },

  /** Another record in a collection, e.g. the project shown as Next case. */
  reference(field, ctx, id) {
    const target = field.collection || ctx.collection;
    const node = el("select", { id });
    const paint = () => {
      const current = ctx.get(field.name) || "";
      const options = (store.items[target] || []).filter((r) => r.slug !== ctx.get("slug"));
      node.replaceChildren(
        el("option", { value: "" }, field.emptyLabel || "None"),
        ...options.map((r) => el("option", { value: r.slug, selected: r.slug === current },
          (r.title || r.slug).trim() + (r.draft ? " (draft — won't show)" : ""))));
      if (current && !options.some((r) => r.slug === current)) {
        node.append(el("option", { value: current, selected: true }, `${current} (missing)`));
      }
    };
    node.onchange = () => ctx.set(field.name, node.value);
    paint();
    return node;
  },

  date(field, ctx, id) {
    const node = el("input", { type: "date", id, value: ctx.get(field.name) || "" });
    node.onchange = () => ctx.set(field.name, node.value);
    return node;
  },

  color(field, ctx, id) {
    const text = el("input", { type: "text", id, value: ctx.get(field.name) || "", placeholder: "#000000", className: "color-text" });
    const pick = el("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(ctx.get(field.name) || "") ? ctx.get(field.name) : "#000000" });
    text.oninput = () => { ctx.set(field.name, text.value.trim()); if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) pick.value = text.value.trim(); };
    pick.oninput = () => { text.value = pick.value; ctx.set(field.name, pick.value); };
    return el("div", { className: "inline" }, pick, text);
  },

  /** Several items of another collection, in order (Webflow's multi-reference). */
  multiReference(field, ctx, id) {
    const target = field.collection;
    const wrap = el("div", { className: "chips-field" });
    const chips = el("div", { className: "chips" });
    const add = el("select", { id });
    const values = () => ctx.get(field.name) || [];
    const itemsOf = () => store.items[target] || [];
    const titleOf = (r) => String(r[store.schemas[target]?.titleField] || r.title || r.slug).trim();
    let dragFrom = null;
    const paint = () => {
      const list = values();
      chips.replaceChildren(...list.map((slug, i) => {
        const r = itemsOf().find((x) => x.slug === slug);
        const chip = el("span", { className: "chip" + (r ? "" : " missing"), draggable: true, title: r ? "" : "This item no longer exists" },
          r ? titleOf(r) + (r.draft ? " (draft)" : "") : `${slug} (missing)`,
          el("button", { type: "button", className: "chip-x", attrs: { "aria-label": "Remove" },
            onclick: () => { ctx.set(field.name, list.filter((_, j) => j !== i)); paint(); } }, "\u00d7"));
        chip.addEventListener("dragstart", () => { dragFrom = i; });
        chip.addEventListener("dragover", (e) => e.preventDefault());
        chip.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragFrom == null || dragFrom === i) return;
          const next = [...values()]; const [m] = next.splice(dragFrom, 1); next.splice(i, 0, m);
          dragFrom = null; ctx.set(field.name, next); paint();
        });
        return chip;
      }));
      add.replaceChildren(el("option", { value: "" }, `+ Add ${store.schemas[target]?.singular?.toLowerCase() || "item"}…`),
        ...itemsOf().filter((r) => !list.includes(r.slug) && r.slug !== ctx.get("slug")).map((r) => el("option", { value: r.slug }, titleOf(r) + (r.draft ? " (draft — won't show)" : ""))));
    };
    add.onchange = () => { if (add.value) { ctx.set(field.name, [...values(), add.value]); paint(); } };
    paint();
    wrap.append(chips, add);
    return wrap;
  },

  /* ------------------------------------------------------------- editors -- */

  richtext(field, ctx) {
    return richTextField({
      value: ctx.get(field.name) || "",
      variant: field.variant || "body",
      label: field.label,
      // The page's own custom CSS too, so a project shows in the editor as it does on the site.
      pageStyles: pageStyles(store.template?.shell?.head, (store.template?.shell?.customHead || "") + (ctx.get("customHead") || "")),
      onChange: (v) => ctx.set(field.name, v),
    });
  },

  canvas(field, ctx) {
    return canvasField({
      value: ctx.get(field.name) || "",
      head: String(ctx.get("head") || "") + (store.items.settings?.[0]?.customCode?.head || "") + (ctx.get("customHead") || ""),
      label: field.label,
      onChange: (v) => ctx.set(field.name, v),
    });
  },

  html(field, ctx, id) {
    const node = el("textarea", { id, rows: field.rows || 16, value: ctx.get(field.name) ?? "", className: "code", spellcheck: false });
    node.oninput = () => ctx.set(field.name, node.value);
    return node;
  },

  note(field) {
    return el("div", { className: "note" }, ...(field.paragraphs || [field.text]).map((t) => el("p", {}, t)));
  },

  /* ------------------------------------------------------------ previews -- */

  /** The Work-page card for this project, as it will look. */
  cardPreview(field, ctx) {
    const frame = el("iframe", { className: "card-frame", title: "Card preview", attrs: { sandbox: "allow-same-origin" } });
    const work = (store.items.pages || []).find((p) => p.slug === "work");
    const grid = work && findEl(work.bodyHtml, '<div\\b[^>]*class="[^"]*w-dyn-items[^"]*"[^>]*>');
    const inner = grid ? work.bodyHtml.slice(grid.innerStart, grid.innerEnd) : "";
    const first = findEl(inner, '<div\\b[^>]*class="collection-item w-dyn-item"[^>]*>');
    if (!first) return el("p", { className: "hint" }, "No card template found on the Work page.");
    const template = inner.slice(first.start, first.end);
    const styles = pageStyles(work.head, work.customHead);
    const css = (CONFIG.siteCss || []).map((h) => `<link rel="stylesheet" href="${h}">`).join("");

    let t = null;
    const paint = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const all = withPositions((store.items.projects || []).map((r) => (r.slug === ctx.original.slug ? ctx.draft : r)));
        const card = fillCard(template, all.find((x) => x.slug === ctx.draft.slug) || ctx.draft);
        frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${css}${styles}<style>html,body{margin:0;background:#fff;height:auto!important;min-height:0!important}.wrap{padding:24px}</style></head><body class="body-mod"><div class="wrap"><div class="projects-collection w-dyn-list"><div role="list" class="projects-grid w-dyn-items">${toSite(card)}</div></div></div></body></html>`;
      }, 150);
    };
    frame.addEventListener("load", () => {
      const h = frame.contentDocument?.documentElement.scrollHeight;
      if (h) frame.style.height = h + "px";
    });
    ctx.subscribe(paint);
    paint();
    return frame;
  },

  /** Roughly how the page shows in a search result. */
  seoPreview(field, ctx) {
    const node = el("div", { className: "seo-preview" });
    const paint = () => {
      // The same fallbacks the build applies (admin/lib/seo.js).
      const site = store.items.seo?.[0] || {};
      const eff = effectiveSeo(ctx.collection === "projects" ? "project" : "page", ctx.draft, site, { projects: store.items.projects || [] });
      const title = eff.title;
      const desc = eff.description;
      const slug = ctx.get("slug") === "index" ? "" : ctx.get("slug");
      const host = (siteBase(site, CONFIG.siteUrl).match(/^https?:\/\/([^/]+)/) || [])[1] || "alexiux.com";
      node.replaceChildren(
        el("div", { className: "seo-url" }, host + (slug ? ` › ${ctx.collection === "projects" ? "project › " : ""}${slug}` : "")),
        el("div", { className: "seo-title" }, String(title).slice(0, 60) + (String(title).length > 60 ? "…" : "")),
        el("div", { className: "seo-desc" }, desc ? desc.slice(0, 160) + (desc.length > 160 ? "…" : "") : "No description — search engines will pick some text from the page."),
        eff.descriptionSource === "content" ? el("p", { className: "hint" }, "The description is taken from the page's content because the field above is empty. ",
          el("button", { type: "button", className: "link", onclick: () => {
            ctx.set("seo.description", eff.description);
            const box = document.querySelector('[data-field="seo.description"] textarea');
            if (box) box.value = eff.description;
          } }, "Copy it into the field to edit it")) : null);
    };
    ctx.subscribe(paint);
    paint();
    return node;
  },

  /** Send a real test submission through the configured form service. */
  formTest(field, ctx) {
    const out = el("p", { className: "hint" });
    const button = el("button", { type: "button", className: "btn small" }, "Send a test message");
    button.onclick = async () => {
      const cfg = ctx.get("contactForm") || {};
      const endpoint = formTarget(cfg);
      if (!endpoint) { out.textContent = "Fill in the service details above first."; out.className = "hint warn"; return; }
      button.disabled = true;
      out.textContent = "Sending…";
      out.className = "hint";
      const data = new FormData();
      if (cfg.service === "web3forms") data.append("access_key", cfg.accessKey);
      data.append("Name", "CMS test");
      data.append("Email", "test@example.com");
      data.append("Message", "Test message sent from the alexiux.com CMS settings page.");
      data.append(cfg.service === "web3forms" ? "subject" : "_subject", (cfg.subject || "Contact form") + " (test)");
      try {
        const res = await fetch(endpoint, { method: "POST", body: data, headers: { Accept: "application/json" } });
        let body = null;
        try { body = await res.json(); } catch { /* not JSON */ }
        const ok = res.ok && body?.success !== false;
        out.textContent = ok
          ? "✓ Sent. Check the inbox the service delivers to (and its spam folder)."
          : `The service refused it: ${body?.message || body?.error || res.status}. ` +
            (cfg.captcha && cfg.captcha !== "none"
              ? "With a captcha switched on in the service's dashboard, messages without one are refused — send a test from the contact form on the live site instead."
              : "Check the details above.");
        out.className = ok ? "hint ok" : "hint warn";
      } catch (err) {
        out.textContent = `Couldn't reach the service: ${err.message}`;
        out.className = "hint warn";
      } finally {
        button.disabled = false;
      }
    };
    return el("div", {}, button, out);
  },
};

export const pageStylesOf = (head) => (String(head || "").match(/<style>[\s\S]*?<\/style>/gi) || []).join("");
/** The <style> a page gets: its head, Site settings > Custom code, then its own custom code. */
export const pageStyles = (head, own = "") => pageStylesOf(String(head || "") + (store.items.settings?.[0]?.customCode?.head || "") + (own || ""));

const toSite = (html) => withLocalCopies(html).replace(/(src|href)="\/(?!\/)/g, (m, a) => `${a}="${assetUrl("/")}`);
