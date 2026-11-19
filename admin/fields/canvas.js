/**
 * Page canvas: edit a fixed page (home, about, work, collaborate) in place.
 *
 * Those pages are bespoke Webflow layouts rather than a collection, so they
 * are edited the way Webflow's Editor works: the page is shown with the site's
 * styles, text is typed straight into it, images are clicked to replace them,
 * and the layout itself can't be changed. Project grids on these pages are
 * generated from the Projects collection at build time, so they're shown but
 * locked here.
 *
 * Saving goes through the Webflow serializer, so an edit changes only the
 * bytes it touched rather than re-serializing the whole page.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toSiteHtml, fromSiteHtml, showLocalCopies } from "../lib/dom.js?v=6600ab59";
import { serializeChildren } from "../lib/webflow-html.js?v=6600ab59";
import { pickImage } from "../views/media.js?v=6600ab59";

const CANVAS_CSS = `
html,body{margin:0;background:#fff}
#cms-root{outline:none}
#cms-root img{cursor:pointer}
#cms-root img:hover{outline:2px solid rgba(43,43,255,.5);outline-offset:2px}
#cms-root img.cms-selected{outline:2px solid #2b2bff;outline-offset:2px}
#cms-root .cms-locked{position:relative;cursor:not-allowed}
#cms-root .cms-locked::after{content:"Generated from Projects \\2014 edit it there";position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:flex-end;padding:12px;font:600 12px/1.2 system-ui,sans-serif;color:#2b2bff;background:rgba(255,255,255,.55);pointer-events:none;opacity:0;transition:opacity .15s}
#cms-root .cms-locked:hover::after{opacity:1}
#cms-root [contenteditable="false"] img{cursor:not-allowed}
`;

export function canvasField({ value = "", onChange, head = "", label = "Page content" }) {
  // No scripts ever run in here: content is edited, never executed.
  const frame = el("iframe", { className: "canvas-frame", title: label, attrs: { sandbox: "allow-same-origin" } });
  const status = el("span", { className: "muted" });
  let root = null;
  let doc = null;
  let last = value;
  let savedRange = null;

  const commit = () => {
    if (!root) return;
    const html = fromSiteHtml(serializeChildren(root));
    if (html === last) return;
    last = html;
    onChange(html);
    status.textContent = "Edited";
  };

  /* ---------------------------------------------------- inline toolbar -- */

  const restore = () => {
    frame.contentWindow.focus();
    if (!savedRange) return false;
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  };
  const exec = (cmd, arg) => { if (restore()) { doc.execCommand(cmd, false, arg); normalizeInline(); commit(); } };

  // contenteditable writes <b>/<i>; Webflow's markup uses <strong>/<em>.
  const normalizeInline = () => {
    for (const [from, to] of [["b", "strong"], ["i", "em"]]) {
      for (const n of root.querySelectorAll(from)) {
        const r = doc.createElement(to);
        while (n.firstChild) r.appendChild(n.firstChild);
        n.replaceWith(r);
      }
    }
    for (const s of root.querySelectorAll("span[style]")) {
      if (!s.closest("[contenteditable=false]")) s.replaceWith(...s.childNodes);
    }
  };

  const btn = (text, title, action) => el("button", {
    type: "button", className: "rte-btn", title,
    onmousedown: (e) => { e.preventDefault(); action(); },
  }, text);

  const linkInput = el("input", { type: "url", placeholder: "https://…" });
  const linkBar = el("div", { className: "rte-popover", hidden: true },
    linkInput,
    el("button", { type: "button", className: "btn small primary", onclick: () => {
      const url = linkInput.value.trim();
      linkBar.hidden = true;
      if (!restore()) return;
      if (!url) { doc.execCommand("unlink"); commit(); return; }
      doc.execCommand("createLink", false, url);
      const a = doc.getSelection().anchorNode?.parentElement?.closest("a");
      if (a && /^https?:/i.test(url)) a.setAttribute("target", "_blank");
      commit();
    } }, "Apply"),
    el("button", { type: "button", className: "link", onclick: () => { linkBar.hidden = true; } }, "Cancel"));

  const floatBar = el("div", { className: "rte-float", hidden: true },
    btn("B", "Bold", () => exec("bold")),
    btn("I", "Italic", () => exec("italic")),
    btn("Link", "Link", () => {
      const a = savedRange?.startContainer?.parentElement?.closest("a");
      linkInput.value = a?.getAttribute("href") || "";
      place(linkBar, savedRange.getBoundingClientRect(), true);
      floatBar.hidden = true;
      linkInput.focus();
    }));

  const place = (node, rect, below) => {
    const fr = frame.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    node.hidden = false;
    let top = below ? fr.top - wr.top + rect.bottom + 8 : fr.top - wr.top + rect.top - node.offsetHeight - 10;
    if (top < 0) top = fr.top - wr.top + rect.bottom + 8;
    const left = Math.max(4, Math.min(fr.left - wr.left + rect.left + rect.width / 2 - node.offsetWidth / 2, wr.width - node.offsetWidth - 4));
    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
  };

  /* ------------------------------------------------------- image panel -- */

  const panelImg = el("img", { className: "ip-preview", alt: "" });
  const panelAlt = el("input", { type: "text", placeholder: "Describe this image…" });
  const panelReplace = el("button", { type: "button", className: "btn small" }, "Replace image");
  const panelFields = el("div", { hidden: true },
    panelImg, el("label", { className: "alt-label" }, "Alt text"), panelAlt,
    el("p", { className: "hint" }, "Describes the image for screen readers and search engines."), panelReplace);
  const panelEmpty = el("p", { className: "hint" }, "Click an image in the page to replace it or edit its alt text.");
  const imagePanel = el("aside", { className: "image-panel" }, el("div", { className: "ip-head" }, "Image"), panelEmpty, panelFields);

  function showImage(img) {
    for (const p of root.querySelectorAll("img.cms-selected")) p.classList.remove("cms-selected");
    img.classList.add("cms-selected");
    panelFields.hidden = false;
    panelEmpty.hidden = true;
    panelImg.src = img.getAttribute("src");
    panelAlt.value = img.getAttribute("alt") || "";
    panelAlt.classList.toggle("needs-alt", !panelAlt.value);
    panelAlt.oninput = () => { img.setAttribute("alt", panelAlt.value); panelAlt.classList.toggle("needs-alt", !panelAlt.value); commit(); };
    panelReplace.onclick = async () => {
      const picked = await pickImage();
      if (!picked) return;
      // A <picture>'s other versions belong to the old image.
      if (img.parentElement?.tagName === "PICTURE") for (const s of [...img.parentElement.querySelectorAll("source")]) s.remove();
      img.setAttribute("src", toSiteHtml(`src="${picked}"`).slice(5, -1));
      img.removeAttribute("data-cms-local-src");
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      showLocalCopies(img.parentNode);
      panelImg.src = img.getAttribute("src");
      commit();
    };
  }

  /* -------------------------------------------------------------- init -- */

  let ready = false;
  function init() {
    if (ready) return;
    doc = frame.contentDocument;
    root = doc?.getElementById("cms-root");
    if (!root) return;
    ready = true;
    root.innerHTML = toSiteHtml(last);
    root.contentEditable = "true";

    // Structure that must not be typed into: embeds, and the generated grids.
    for (const n of root.querySelectorAll("script,iframe,video,svg,form,.w-embed")) n.setAttribute("contenteditable", "false");
    for (const n of root.querySelectorAll(".w-dyn-list")) {
      n.setAttribute("contenteditable", "false");
      n.classList.add("cms-locked");
    }

    root.addEventListener("input", commit);
    root.addEventListener("focusout", commit);
    doc.addEventListener("selectionchange", () => {
      const sel = doc.getSelection();
      if (sel.rangeCount && root.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
      if (!linkBar.hidden) return;
      if (!sel.rangeCount || sel.isCollapsed || !root.contains(sel.anchorNode)) { floatBar.hidden = true; return; }
      place(floatBar, sel.getRangeAt(0).getBoundingClientRect());
    });
    root.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      doc.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
    });
    root.addEventListener("keydown", (e) => {
      // Enter would create new blocks inside Webflow's layout elements.
      if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey) doc.execCommand("insertLineBreak"); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault(); commit(); window.dispatchEvent(new CustomEvent("cms:save"));
      }
    });
    root.addEventListener("click", (e) => {
      if (e.target.closest("a")) e.preventDefault();
      const img = e.target.closest("img");
      if (!img || img.closest("[contenteditable=false]")) return;
      e.preventDefault();
      showImage(img);
    });
    // The canvas is a fixed-height window that scrolls inside itself, like a
    // browser. (Sizing the frame to its content looped forever on pages with
    // 100vh sections: a taller frame made the page taller, and so on.)
    // Toolbars follow the text they belong to, and hide when it scrolls away.
    doc.addEventListener("scroll", () => {
      const r = savedRange?.getBoundingClientRect();
      const visible = r && r.bottom > 0 && r.top < frame.clientHeight;
      if (!floatBar.hidden) { if (visible) place(floatBar, r); else floatBar.hidden = true; }
      if (!linkBar.hidden && visible) place(linkBar, r, true);
    }, { passive: true });
  }

  frame.addEventListener("load", init);
  const poll = setInterval(() => { init(); if (ready) clearInterval(poll); }, 50);
  setTimeout(() => clearInterval(poll), 15000);

  // The page's own <style> blocks live in its <head>; without them the canvas
  // misses rules the real page has.
  const pageStyles = (String(head).match(/<style>[\s\S]*?<\/style>/gi) || []).join("");
  frame.srcdoc = "<!doctype html><html><head><meta charset='utf-8'>" +
    (CONFIG.siteCss || []).map((h) => `<link rel="stylesheet" href="${h}">`).join("") +
    pageStyles + `<style>${CANVAS_CSS}</style></head><body class="body-mod"><div class="page-wrapper"><div id="cms-root"></div></div></body></html>`;

  const wrap = el("div", { className: "canvas" },
    el("div", { className: "rte-toolbar" },
      el("span", { className: "hint" }, "Click to type · select text to format · click an image to replace it"),
      el("span", { className: "rte-spacer" }), status),
    floatBar, linkBar,
    el("div", { className: "canvas-body" }, frame, imagePanel));
  return wrap;
}
