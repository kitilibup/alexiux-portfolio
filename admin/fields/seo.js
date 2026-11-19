/**
 * SEO field types: the site audit, the sitemap preview and the share preview.
 *
 * All three compute with admin/lib/seo.js - the code the build uses - so what
 * they show is what will be published.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, assetUrl, plural } from "../lib/dom.js?v=6600ab59";
import {
  siteBase, effectiveSeo, auditRecord, altCoverage, sitemapEntries, renderSitemap, renderRobots, LIMITS, recordPath, redirectList,
} from "../lib/seo.js?v=6600ab59";
import { store, siteUrl, commit, serializeRecord } from "../store.js?v=6600ab59";
import { toast } from "../lib/dom.js?v=6600ab59";

/** Site-wide SEO settings: the draft while editing them, else what's saved. */
const siteSettings = (ctx) => (ctx.collection === "seo" ? ctx.draft : store.items.seo?.[0] || {});
const baseFor = (site) => siteBase(site, CONFIG.siteUrl);
const context = () => ({ projects: store.items.projects || [] });

function openRecord(collection, slug) {
  try { sessionStorage.setItem(`cms:tab:${collection}`, "SEO"); } catch { /* private mode */ }
  location.hash = `#/${collection}/${encodeURIComponent(slug)}`;
}

const lenBadge = (n, limit) =>
  el("span", { className: "len " + (n === 0 ? "bad" : n > limit ? "warn" : "good"), title: `${n} characters; about ${limit} show in search results` }, String(n));

export const seoTypes = {
  /** Every published page and project, its SEO at a glance, problems first. */
  seoAudit(field, ctx) {
    const wrap = el("div", { className: "audit" });
    const paint = () => {
      const site = siteSettings(ctx);
      const rows = [
        ...(store.items.pages || []).map((r) => ({ kind: "page", collection: "pages", r })),
        ...(store.items.projects || []).filter((r) => !r.draft).map((r) => ({ kind: "project", collection: "projects", r })),
      ].map((x) => ({ ...x, eff: effectiveSeo(x.kind, x.r, site, context()), issues: auditRecord(x.kind, x.r, site, context()), alt: altCoverage(x.r) }));
      // The same description on several pages tells search engines nothing about each.
      const byDesc = new Map();
      for (const x of rows) if (x.eff.description && !x.eff.noindex) byDesc.set(x.eff.description, [...(byDesc.get(x.eff.description) || []), x]);
      for (const group of byDesc.values()) {
        if (group.length < 2) continue;
        for (const x of group) x.issues.push({ level: "warn", text: `Same description as ${group.length - 1} other page${group.length > 2 ? "s" : ""}` });
      }

      const warnCount = rows.reduce((n, x) => n + x.issues.filter((i) => i.level === "warn").length, 0);
      const alts = rows.reduce((a, x) => ({ total: a.total + x.alt.total, missing: a.missing + x.alt.missing }), { total: 0, missing: 0 });
      const indexed = rows.filter((x) => !x.eff.noindex).length;

      const gaps = rows.filter((x) => (x.eff.descriptionSource === "content" && !x.r.seo?.description) || (x.eff.shareImageSource === "content" && !x.r.seo?.ogImage));
      wrap.replaceChildren(...[
        gaps.length ? el("div", { className: "callout" },
          el("p", {}, `${gaps.length === 1 ? "1 page uses" : `${gaps.length} pages use`} a description or share image taken automatically from its content (marked auto). They're live as they are; write them into the pages' own fields to edit them.`),
          el("button", { type: "button", className: "btn small", onclick: () => fillGaps(gaps) }, "Write them into the fields")) : null,
        el("div", { className: "stat-row" },
          stat(String(indexed), `of ${rows.length} pages open to search engines`, indexed === rows.length ? "good" : "warn"),
          stat(String(warnCount), warnCount === 1 ? "thing to fix" : "things to fix", warnCount ? "warn" : "good"),
          stat(`${alts.total - alts.missing}/${alts.total}`, "images with alt text", alts.missing ? "warn" : "good")),
        site.allowIndexing === false
          ? el("p", { className: "hint warn" }, "Search engines are told to stay away from the whole site (Search engines tab). Nothing will be indexed.")
          : null,
        el("table", { className: "table audit-table" },
          el("thead", {}, el("tr", {},
            el("th", {}, "Page"), el("th", {}, "Title in search results"), el("th", {}, "Description"),
            el("th", { className: "center" }, "Share image"), el("th", { className: "center" }, "Alt text"), el("th", {}, "To check"))),
          el("tbody", {}, ...rows.map((x) => el("tr", {
            className: "clickable",
            title: "Open this page's SEO settings",
            onclick: () => openRecord(x.collection, x.r.slug),
          },
            el("td", {}, el("div", { className: "strong" }, String(x.r.title || x.r.seo?.title || x.r.slug).trim()),
              el("div", { className: "muted small" }, recordPath(x.kind, x.r))),
            el("td", {}, el("div", { className: "clip" }, x.eff.title), lenBadge(x.eff.title.length, LIMITS.title)),
            el("td", {}, x.eff.description ? el("div", { className: "clip" }, x.eff.description) : el("span", { className: "muted" }, "—"),
              lenBadge(x.eff.description.length, LIMITS.description),
              x.eff.descriptionSource === "content" ? el("span", { className: "len auto", title: "Written from the page's content - open the page to edit it" }, "auto") : null),
            el("td", { className: "center" }, x.eff.shareImage
              ? el("img", { className: "mini", src: assetUrl(x.eff.shareImage), alt: "", title: x.eff.shareImageSource === "screenshot" ? "Screenshot of the page, made when the site is published" : "", onerror: (e) => { e.target.replaceWith(el("span", { className: "len shot", title: "A screenshot of the page, made when the site is published" }, "shot")); } }) : el("span", { className: "muted" }, "—")),
            el("td", { className: "center" }, x.alt.total
              ? el("span", { className: x.alt.missing ? "len warn" : "len good" }, `${x.alt.total - x.alt.missing}/${x.alt.total}`) : el("span", { className: "muted" }, "—")),
            el("td", {}, x.issues.length
              ? el("ul", { className: "issues" }, ...x.issues.map((i) => el("li", { className: i.level }, i.text)))
              : el("span", { className: "len good" }, "Looks good"))))))].filter(Boolean));
    };
    ctx.subscribe(paint);
    paint();
    return wrap;
  },

  /** What sitemap.xml and robots.txt will contain. */
  sitemapPreview(field, ctx) {
    const wrap = el("div", {});
    const paint = () => {
      const site = siteSettings(ctx);
      const base = baseFor(site);
      const entries = sitemapEntries({
        pages: store.items.pages || [], projects: (store.items.projects || []).filter((p) => !p.draft), site, base,
      });
      const imageCount = entries.reduce((n, e) => n + e.images.length, 0);
      wrap.replaceChildren(
        el("p", {}, entries.length
          ? `${plural(entries.length, "page")} and ${plural(imageCount, "image")} are listed for search engines. Drafts and hidden pages are left out.`
          : "The sitemap is empty: search engines are kept away from the whole site."),
        el("div", { className: "inline" },
          el("a", { className: "btn small", href: siteUrl("/sitemap.xml"), target: "_blank", rel: "noreferrer" }, "Open sitemap.xml ↗"),
          el("a", { className: "btn small", href: siteUrl("/robots.txt"), target: "_blank", rel: "noreferrer" }, "Open robots.txt ↗")),
        el("table", { className: "table compact" },
          el("thead", {}, el("tr", {}, el("th", {}, "Address"), el("th", {}, "Last changed"), el("th", { className: "center" }, "Images"), el("th", { className: "center" }, "Priority"))),
          el("tbody", {}, ...entries.map((e) => el("tr", {},
            el("td", {}, el("code", {}, e.loc.replace(base, "") || "/")),
            el("td", { className: "muted" }, e.lastmod || "date of its last commit"),
            el("td", { className: "center" }, String(e.images.length)),
            el("td", { className: "center muted" }, e.priority))))),
        el("details", { className: "code-details" }, el("summary", {}, "sitemap.xml"),
          el("pre", { className: "code" }, renderSitemap(entries.map((e) => ({ ...e, lastmod: e.lastmod || "…" }))))),
        el("details", { className: "code-details" }, el("summary", {}, "robots.txt"),
          el("pre", { className: "code" }, renderRobots(site, base))),
        el("p", { className: "hint" },
          "To have Google read it: add the site in Google Search Console, verify it with the code from the Search engines tab, then submit ",
          el("code", {}, `${base}/sitemap.xml`), " under Sitemaps."));
    };
    ctx.subscribe(paint);
    paint();
    return wrap;
  },

  /** Webflow-style 301 table: custom redirects, plus the automatic ones from renamed projects. */
  redirectTable(field, ctx) {
    const wrap = el("div", { className: "redirects" });
    const rows = () => ctx.get(field.name) || [];
    const livePaths = () => new Set([
      ...(store.items.pages || []).map((p) => recordPath("page", p)),
      ...(store.items.projects || []).filter((p) => !p.draft).map((p) => recordPath("project", p)),
    ]);
    const norm = (p) => { let x = "/" + String(p || "").trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, ""); if (!/\.html?$/.test(x) && !x.endsWith("/")) x += "/"; return x; };

    const paint = () => {
      const live = livePaths();
      const auto = redirectList({ projects: store.items.projects || [], pages: store.items.pages || [], site: {} });
      const list = rows();
      wrap.replaceChildren(...[
        el("table", { className: "table compact redirect-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Old address"), el("th", {}), el("th", {}, "Goes to"), el("th", {}))),
          el("tbody", {},
            ...auto.map((r) => el("tr", { className: "auto-row" },
              el("td", {}, el("code", {}, r.from)), el("td", { className: "muted" }, "\u2192"), el("td", {}, el("code", {}, r.to)),
              el("td", { className: "muted small" }, `automatic · ${r.source}`))),
            ...list.map((r, i) => {
              const fromIn = el("input", { type: "text", value: r.from || "", placeholder: "/old-page/" });
              const toIn = el("input", { type: "text", value: r.to || "", placeholder: "/work/ or https://…" });
              const note = el("div", { className: "hint warn" });
              const check = () => {
                const f = norm(fromIn.value), t = toIn.value.trim();
                note.textContent = !fromIn.value.trim() ? "" : live.has(f) ? "A page exists at this address, so this redirect is ignored."
                  : t && !/^https?:\/\//.test(t) && !live.has(norm(t)) ? "Nothing is published at the target address." : "";
              };
              const save = () => {
                const next = rows().map((x, j) => (j === i ? { from: fromIn.value.trim(), to: toIn.value.trim() } : x));
                ctx.set(field.name, next);
                check();
              };
              fromIn.oninput = save;
              toIn.oninput = save;
              check();
              return el("tr", {},
                el("td", {}, fromIn, note), el("td", { className: "muted" }, "\u2192"), el("td", {}, toIn),
                el("td", {}, el("button", { type: "button", className: "link danger", onclick: () => { ctx.set(field.name, rows().filter((_, j) => j !== i)); paint(); } }, "Remove")));
            }))),
        el("button", { type: "button", className: "btn small", onclick: () => { ctx.set(field.name, [...rows(), { from: "", to: "" }]); paint(); } }, "+ Add redirect"),
      ]);
    };
    paint();
    return wrap;
  },

  /** Roughly how a link to this page looks when shared (LinkedIn, Slack, WhatsApp). */
  sharePreview(field, ctx) {
    const node = el("div", { className: "share-card" });
    const kind = ctx.collection === "projects" ? "project" : "page";
    const paint = () => {
      const site = store.items.seo?.[0] || {};
      const eff = effectiveSeo(kind, ctx.draft, site, context());
      const host = (baseFor(site).match(/^https?:\/\/([^/]+)/) || [])[1] || "alexiux.com";
      node.replaceChildren(
        eff.shareImageSource === "screenshot" ? shotPreview(eff.shareImage)
          : eff.shareImage ? el("img", { src: assetUrl(eff.shareImage), alt: "" }) : el("div", { className: "share-noimg" }, "No image — the link shows as text only"),
        el("div", { className: "share-text" },
          el("div", { className: "share-host" }, host.toUpperCase()),
          el("div", { className: "share-title" }, eff.shareTitle || eff.title),
          eff.description ? el("div", { className: "share-desc" }, eff.description) : null));
    };
    ctx.subscribe(paint);
    paint();
    return node;
  },
};

/** Copy the automatic values into each record's own SEO fields, one commit. */
async function fillGaps(gaps) {
  const changes = [];
  const updated = [];
  for (const x of gaps) {
    const next = JSON.parse(JSON.stringify(x.r));
    next.seo = { ...(next.seo || {}) };
    if (x.eff.descriptionSource === "content" && !next.seo.description) next.seo.description = x.eff.description;
    if (x.eff.shareImageSource === "content" && !next.seo.ogImage) next.seo.ogImage = x.eff.shareImage;
    changes.push({ path: x.r.__path, content: serializeRecord(x.collection, next) });
    updated.push([x.r, next]);
  }
  try {
    await commit(changes, `CMS: fill in SEO for ${changes.length} page${changes.length === 1 ? "" : "s"} from their content`);
    for (const [r, next] of updated) Object.assign(r, next);
    toast(`Written into ${changes.length} page${changes.length === 1 ? "" : "s"}. Edit them on each page's SEO tab.`);
    location.reload();
  } catch (err) {
    toast(err.message, "error");
  }
}

function stat(value, label, tone) {
  return el("div", { className: `stat ${tone}` }, el("div", { className: "stat-value" }, value), el("div", { className: "stat-label" }, label));
}

/**
 * A page's screenshot share image: the published one when there is one yet,
 * else a note that it's made when the site is published.
 */
function shotPreview(path) {
  const note = el("div", { className: "share-noimg" }, "A screenshot of this page \u2014 made when the site is published");
  const img = el("img", { src: assetUrl(path) + "?v=" + Date.now().toString(36).slice(0, -3), alt: "", title: "Screenshot of the page, made when the site is published" });
  img.onerror = () => img.replaceWith(note);
  return img;
}
