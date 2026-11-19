/**
 * alexiux.com CMS - entry point.
 *
 * Two ways to run:
 *   local    `npm run cms`, edits the working tree, rebuilds on save, no sign-in
 *   GitHub   /admin on the deployed site, edits the repo through the GitHub API;
 *            every save is a commit, and the Pages workflow publishes it
 *
 * Layout:
 *   store.js              loaded content and saving
 *   views/collection.js   lists (Projects, Pages)
 *   views/editor.js       editing one record, with live preview
 *   views/media.js        uploads, the image picker
 *   fields/               field controls, the rich-text editor, the page canvas
 *   lib/                  shared with the build: project-model.js, contact-form.js
 *   backends/             GitHub and local file access, same interface
 */

import { CONFIG } from "./config.js?v=6600ab59";
import { GitHub } from "./backends/github.js?v=6600ab59";
import { Local } from "./backends/local.js?v=6600ab59";
import { el, $, toast, confirmDialog } from "./lib/dom.js?v=6600ab59";
import { store, loadAll, siteUrl } from "./store.js?v=6600ab59";
import { collectionView, listState } from "./views/collection.js?v=6600ab59";
import { editorView, editorState } from "./views/editor.js?v=6600ab59";
import { mediaView } from "./views/media.js?v=6600ab59";
import { variablesView } from "./views/variables.js?v=6600ab59";
import { backupsView } from "./views/backups.js?v=6600ab59";
import { designerView, designerState } from "./designer/designer.js?v=6600ab59";
import { collectionsView } from "./views/collections.js?v=6600ab59";

/* ------------------------------------------------------------------ auth -- */

const TOKEN_KEY = "alexiux_cms_token";
const loadToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const saveToken = (t) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } };
const clearToken = () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

/** OAuth via the Worker; the popup posts the token back, the secret never reaches the browser. */
function signInWithGitHub() {
  const w = window.open(`${CONFIG.authWorker}/auth`, "github-oauth", "width=720,height=760");
  if (!w) return toast("Popup blocked. Allow popups for this site and try again.", "error");
  const onMessage = async (event) => {
    // Only the popup we opened, served from the Worker's origin, may hand over a token.
    if (event.source !== w || new URL(CONFIG.authWorker).origin !== event.origin || !event.data?.token) return;
    window.removeEventListener("message", onMessage);
    saveToken(event.data.token);
    await start();
  };
  window.addEventListener("message", onMessage);
}

function renderLogin(error) {
  document.body.className = "login-body";
  const pat = el("input", { type: "password", id: "pat", placeholder: "github_pat_…", autocomplete: "off" });
  const go = async () => { if (pat.value.trim()) { saveToken(pat.value.trim()); await start(); } };
  pat.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  document.body.replaceChildren(
    el("main", { className: "login" },
      el("h1", {}, "alexiux.com"),
      el("p", { className: "sub" }, "Content management"),
      error ? el("p", { className: "error" }, error) : null,
      CONFIG.authWorker
        ? el("button", { className: "btn primary wide", onclick: signInWithGitHub }, "Sign in with GitHub")
        : el("p", { className: "hint" }, "GitHub sign-in isn't set up yet. Use an access token below, or run the CMS locally with npm run cms."),
      el("details", { className: "token-fallback", open: !CONFIG.authWorker },
        el("summary", {}, "Use a personal access token"),
        el("p", { className: "hint" },
          "A fine-grained token with Contents: read and write on this repository (add Actions: read to see publish status). It stays in this tab and is cleared when the tab closes."),
        pat,
        el("button", { className: "btn", onclick: go }, "Continue"))));
  pat.focus();
}

/* -------------------------------------------------------------- security --
 * GitHub Pages can't send X-Frame-Options or frame-ancestors, so the CMS
 * refuses to run inside another page itself: a framed CMS could be overlaid
 * and clicked through (clickjacking).
 */
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();

/** Signed-in sessions end after this long without any activity. */
const IDLE_LIMIT = 2 * 60 * 60 * 1000;
let lastActive = Date.now();
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true });
setInterval(() => {
  if (store.backend?.mode !== "github" || Date.now() - lastActive < IDLE_LIMIT) return;
  if (unsaved()) return;   // never throw away work; the next save re-checks the token anyway
  clearToken();
  renderLogin("Signed out after two hours without activity.");
}, 60 * 1000);

async function start() {
  if (framed) {
    document.body.textContent = "For security, the CMS can't be shown inside another page. Open it directly.";
    return;
  }
  document.body.className = "loading-body";
  document.body.replaceChildren(el("p", { className: "loading" }, "Loading content…"));

  const local = await Local.detect();
  if (local) {
    store.backend = local;
  } else {
    const token = loadToken();
    if (!token) return renderLogin();
    store.backend = new GitHub({ ...CONFIG, token });
  }

  try {
    store.user = await store.backend.user();
    // Defense in depth: GitHub's write permission is the real gate, but a
    // configured allowlist turns away any other account that has one.
    const allowed = (CONFIG.allowedUsers || []).map((u) => u.toLowerCase());
    if (store.backend.mode === "github" && allowed.length && !allowed.includes(String(store.user.login).toLowerCase())) {
      throw new Error(`${store.user.login} isn't allowed to edit this site.`);
    }
    await store.backend.checkAccess();
    await loadAll();
  } catch (err) {
    if (store.backend.mode === "github") clearToken();
    return renderLogin(err.message);
  }
  window.addEventListener("hashchange", onHashChange);
  route();
}

/* --------------------------------------------------------------- routing --
 * #/projects, #/projects/feedback, #/pages/index, #/settings, #/media
 */

let current = null;

function parseHash() {
  const [name, slug] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const first = store.collectionNames[0];
  if (!name) return { name: first };
  if (name === "media" || name === "variables" || name === "backups") return { name };
  if (name === "designer") return { name, slug };
  if (name === "collections") return { name };
  if (!store.schemas[name]) return { name: first };
  return slug ? { name, slug } : { name };
}

const hashFor = (v) => "#/" + [v.name, v.slug].filter(Boolean).map(encodeURIComponent).join("/");

const unsaved = () => editorState.dirty || listState.dirty || designerState.dirty;

/** Navigate. Asks before throwing away unsaved edits. */
export async function go(view, { replace = false } = {}) {
  if (!replace && unsaved() && !(await confirmDialog("Discard changes?", "You have unsaved changes on this screen.", { ok: "Discard", danger: true }))) return;
  editorState.dirty = false;
  listState.dirty = false;
  designerState.dirty = false;
  const hash = hashFor(view);
  if (location.hash !== hash) {
    // Assigning location.hash fires hashchange; replaceState does not.
    if (replace) history.replaceState(null, "", hash);
    else { ignoreHash = true; location.hash = hash; }
  }
  route();
}

let ignoreHash = false;
async function onHashChange() {
  if (ignoreHash) { ignoreHash = false; return; }
  // Back/forward: same guard as clicking.
  if (unsaved() && !(await confirmDialog("Discard changes?", "You have unsaved changes on this screen.", { ok: "Discard", danger: true }))) {
    history.pushState(null, "", hashFor(current));   // no hashchange fired
    return;
  }
  editorState.dirty = false;
  listState.dirty = false;
  route();
}

async function route() {
  current = parseHash();
  // The Designer takes the whole window, like Webflow's.
  if (current.name === "designer") {
    document.body.className = "designer-mode";
    editorState.save = null;
    document.body.replaceChildren(el("p", { className: "loading" }, "Opening the Designer\u2026"));
    try {
      const view = await designerView(current.slug, { go });
      document.body.replaceChildren(view);
      document.title = "Designer — alexiux.com CMS";
    } catch (err) {
      console.error(err);
      await go({ name: "pages" }, { replace: true });
      // After the redraw, or the message would be wiped with the old screen.
      toast(`The Designer couldn't open: ${err.message}`, "error");
    }
    return;
  }
  if (!$(".sidebar")) document.body.replaceChildren();
  renderShell();
  const main = $("#main");
  const { name, slug } = current;
  const schema = store.schemas[name];
  editorState.save = null;
  let view;
  if (name === "media") view = mediaView();
  else if (name === "variables") view = variablesView();
  else if (name === "backups") view = backupsView();
  else if (name === "collections") view = collectionsView({ go });
  else if (schema.kind === "singleton") view = editorView(name, null, { go });
  else if (slug) view = editorView(name, slug, { go });
  else view = collectionView(name, { go });
  main.replaceChildren(view);
  main.scrollTop = 0;
  document.title = `${name === "media" ? "Media" : name === "variables" ? "Variables" : name === "backups" ? "Backups" : name === "collections" ? "Collections" : schema.label}${slug ? " · " + slug : ""} — alexiux.com CMS`;
}

/* ----------------------------------------------------------------- shell -- */

function renderShell() {
  if ($(".sidebar")) {
    for (const b of document.querySelectorAll(".nav-item")) b.classList.toggle("active", b.dataset.view === current.name);
    return;
  }
  document.body.className = "";
  const local = store.backend.mode === "local";
  const nav = (name, label) => el("a", {
    className: "nav-item", href: hashFor({ name }), dataset: { view: name },
    onclick: (e) => { e.preventDefault(); go({ name }); },
  }, label);

  document.body.replaceChildren(
    el("aside", { className: "sidebar" },
      el("div", { className: "brand" }, "alexiux.com",
        el("span", { className: "mode " + store.backend.mode, title: local ? "Editing files on this computer; nothing is published until you commit and push." : "Every save commits to GitHub and publishes." },
          local ? "Local" : "Live")),
      el("nav", {},
        el("a", { className: "nav-item designer-link", href: "#/designer", onclick: (e) => { e.preventDefault(); go({ name: "designer" }); } }, "\u25e7 Designer"),
        el("div", { className: "nav-label" }, "Collections"),
        nav("collections", "\u2699 All collections"),
        ...store.collectionNames.filter((n) => store.schemas[n].kind !== "singleton").map((n) => nav(n, store.schemas[n].label)),
        el("div", { className: "nav-label" }, "Site"),
        nav("media", "Media"),
        nav("variables", "Variables"),
        nav("backups", "Backups"),
        ...store.collectionNames.filter((n) => store.schemas[n].kind === "singleton").map((n) => nav(n, store.schemas[n].label))),
      el("div", { className: "spacer" }),
      el("a", { className: "nav-item subtle", href: siteUrl("/"), target: "_blank", rel: "noreferrer" }, "View site ↗"),
      el("div", { className: "user" },
        store.user.avatar_url ? el("img", { src: store.user.avatar_url, alt: "", width: 24, height: 24 }) : null,
        el("span", {}, local ? "Local files" : store.user.login),
        local ? null : el("button", { className: "link", onclick: () => { clearToken(); location.reload(); } }, "Sign out"))),
    el("main", { className: "main", id: "main" }));
  renderShell();
}

/* --------------------------------------------------------------- global -- */

window.addEventListener("beforeunload", (e) => { if (unsaved()) e.preventDefault(); });

const saveShortcut = () => (designerState.save && document.querySelector(".dz") ? designerState.save() : editorState.save?.());
window.addEventListener("cms:save", saveShortcut);
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveShortcut();
  }
});

start();
