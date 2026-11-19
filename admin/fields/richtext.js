/**
 * The rich-text editor.
 *
 * Edits a Webflow rich-text field the way it looks on the site: the content is
 * rendered in an iframe that carries the site's stylesheets and the field's
 * own wrapper class, so headings, lists, figures and captions appear exactly
 * as they will be published. An iframe rather than a div because the site's
 * CSS is one big set of global rules that would otherwise restyle the CMS.
 *
 *   Blocks     paragraph, headings 2-6, quote, bulleted and numbered lists
 *   Inline     bold, italic, links
 *   Media      images (alignment, alt text, caption) and video embeds
 *   History    undo/redo across everything, including media edits
 *   Paste      keeps structure (headings, lists, links, bold/italic), drops styling
 *   Source     an HTML view for the rare thing the toolbar can't do
 *
 * What is saved is produced by lib/webflow-html.js, so it is always valid
 * Webflow rich text and an untouched field never changes.
 */

import { CONFIG } from "../config.js?v=6600ab59";
import { el, toast, toSiteHtml, fromSiteHtml, showLocalCopies } from "../lib/dom.js?v=6600ab59";
import {
  richValue, cleanPastedHtml, textToParagraphs, caretOffset, setCaretOffset,
} from "../lib/webflow-html.js?v=6600ab59";
import { embedForUrl } from "../lib/project-model.js?v=6600ab59";
import { pickImage, uploadFile } from "../views/media.js?v=6600ab59";

const VARIANTS = {
  body: {
    rootClass: "rich-text-block-project w-richtext",
    frame: (root) => `<div class="section cms-pad"><div class="container">${root}</div></div>`,
    placeholder: "Write the case study. Use the toolbar to add headings, lists, images and video.",
    media: true,
  },
  intro: {
    rootClass: "text-project-description w-richtext",
    frame: (root) => `<div class="cms-narrow">${root}</div>`,
    placeholder: "A short introduction shown next to the hero image.",
    media: false,
  },
};

const BLOCK_TYPES = [
  ["p", "Paragraph"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["h4", "Heading 4"],
  ["h5", "Heading 5"], ["h6", "Heading 6"], ["blockquote", "Quote"],
];

const ALIGNS = [
  ["normal", "Left", "Image at its natural size, left aligned"],
  ["center", "Center", "Centered, up to 60% of the column"],
  ["fullwidth", "Full", "The full width of the column"],
  ["floatleft", "Float L", "Floats left; text wraps around it"],
  ["floatright", "Float R", "Floats right; text wraps around it"],
];

const EDITOR_CSS = `
html,body{margin:0;background:#fff}
html,body{height:auto!important;min-height:0!important}
body{overflow:hidden}
.cms-pad{padding-top:28px!important;padding-bottom:40px!important}
.cms-narrow{max-width:640px;padding:22px 26px}
#rt-root{outline:none;min-height:96px;position:relative}
#rt-root.cms-empty::before{content:attr(data-placeholder);position:absolute;top:0;left:0;right:0;color:#9a9a96;pointer-events:none;font-size:inherit}
#rt-root figure{cursor:pointer;transition:outline-color .12s}
#rt-root figure:hover{outline:2px solid rgba(43,43,255,.35);outline-offset:4px}
#rt-root figure.cms-selected{outline:2px solid #2b2bff;outline-offset:4px}
#rt-root figure iframe{pointer-events:none}
#rt-root figcaption{cursor:text;outline:none;min-width:4em}
#rt-root figcaption:empty::before{content:"Write a caption";opacity:.5}
#rt-root a{cursor:text}
#rt-root ::selection{background:rgba(43,43,255,.18)}
`;

export function richTextField({ value = "", onChange, variant = "body", pageStyles = "", label = "Rich text" }) {
  const V = VARIANTS[variant] || VARIANTS.body;
  let lastValue = value || "";
  let root = null;
  let doc = null;
  let savedRange = null;
  let selectedFig = null;
  let selectedImg = null;   // the picture clicked in a figure (a grid holds several)
  let ready = false;

  // No scripts ever run in here: content is edited, never executed.
  const frame = el("iframe", { className: "rte-frame", title: label, attrs: { sandbox: "allow-same-origin" } });
  const wrap = el("div", { className: "rte" });

  /* -------------------------------------------------------- value out -- */

  const words = el("span", { className: "rte-count" });
  const paintMeta = () => {
    const text = root.textContent.replace(/‍/g, "").trim();
    root.classList.toggle("cms-empty", !text && !root.querySelector("figure"));
    const n = text ? text.split(/\s+/).length : 0;
    words.textContent = n ? `${n.toLocaleString()} words` : "";
  };

  const commit = () => {
    if (!root) return;
    const v = fromSiteHtml(richValue(root));
    paintMeta();
    if (v === lastValue) return;
    lastValue = v;
    onChange(v);
  };

  /* ---------------------------------------------------------- history -- */

  const hist = { stack: [], i: -1 };
  const undoBtn = toolButton("Undo", "↶", "Undo (⌘Z)", () => undo());
  const redoBtn = toolButton("Redo", "↷", "Redo (⇧⌘Z)", () => redo());

  const paintHistory = () => {
    undoBtn.disabled = hist.i <= 0;
    redoBtn.disabled = hist.i >= hist.stack.length - 1;
  };

  function record() {
    if (!root) return;
    const snap = { html: root.innerHTML, caret: caretOffset(root) };
    const cur = hist.stack[hist.i];
    if (cur && cur.html === snap.html) { cur.caret = snap.caret ?? cur.caret; return; }
    hist.stack.splice(hist.i + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 300) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    paintHistory();
  }

  let recordTimer = null;
  const recordSoon = () => { clearTimeout(recordTimer); recordTimer = setTimeout(record, 450); };

  function restore(snap) {
    root.innerHTML = snap.html;
    decorate();
    deselectFigure();
    frame.contentWindow.focus();
    setCaretOffset(root, snap.caret);
    commit();
    fit();
    paintHistory();
  }

  function undo() {
    clearTimeout(recordTimer);
    record();
    if (hist.i <= 0) return;
    hist.i -= 1;
    restore(hist.stack[hist.i]);
  }

  function redo() {
    if (hist.i >= hist.stack.length - 1) return;
    hist.i += 1;
    restore(hist.stack[hist.i]);
  }

  /**
   * Chrome decorates what it touches: pasting or merging paragraphs leaves
   * <span style="font-size:…"> and inline styles behind. They'd be dropped on
   * save anyway, but the editor should show what will be saved. Unwrapping
   * keeps the text nodes themselves, so the caret doesn't move.
   */
  const scrub = () => {
    for (const n of root.querySelectorAll("span, font")) {
      if (!n.closest("figure")) n.replaceWith(...n.childNodes);
    }
    for (const n of root.querySelectorAll("[style]")) {
      if (n.tagName !== "FIGURE" && !n.closest("figure")) n.removeAttribute("style");
    }
  };

  /** Every change made by code rather than typing goes through here. */
  const changed = () => { scrub(); decorate(); commit(); record(); fit(); };

  /* -------------------------------------------------------- selection -- */

  const saveSelection = () => {
    const sel = doc?.getSelection();
    if (sel?.rangeCount && root.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    frame.contentWindow.focus();
    const sel = doc.getSelection();
    if (savedRange && root.contains(savedRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return true;
    }
    return false;
  };

  const exec = (cmd, arg) => {
    if (!restoreSelection()) placeCaretAtEnd();
    doc.execCommand(cmd, false, arg);
    saveSelection();
    changed();
    paintToolbarState();
  };

  const placeCaretAtEnd = () => {
    const r = doc.createRange();
    r.selectNodeContents(root.lastElementChild || root);
    r.collapse(false);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
  };

  /** The top-level block holding the caret, or null. */
  const currentBlock = () => {
    let n = savedRange?.startContainer;
    if (!n || !root.contains(n) || n === root) return null;
    while (n.parentNode !== root) n = n.parentNode;
    return n.nodeType === 1 ? n : null;
  };

  const caretElement = () => {
    const n = savedRange?.startContainer;
    return n ? (n.nodeType === 1 ? n : n.parentElement) : null;
  };

  /* ---------------------------------------------------------- toolbar -- */

  function toolButton(name, text, title, action, cls = "") {
    return el("button", {
      type: "button", className: "rte-btn " + cls, title,
      attrs: { "aria-label": name },
      // mousedown, not click: keeps the selection inside the iframe.
      onmousedown: (e) => { e.preventDefault(); if (!e.currentTarget.disabled) action(); },
    }, text);
  }

  const blockSelect = el("select", { className: "rte-block", title: "Text style", attrs: { "aria-label": "Text style" } },
    ...BLOCK_TYPES.map(([v, t]) => el("option", { value: v }, t)),
    el("option", { value: "li", disabled: true }, "List item"));
  blockSelect.onchange = () => {
    const tag = blockSelect.value;
    exec("formatBlock", `<${tag}>`);
    // The original case studies fake headings with <p><strong>…</strong></p>.
    // Made into a real heading, the bold wrapper is redundant - headings
    // carry their own weight - so it goes when it spans the whole heading.
    const block = caretElement()?.closest("h1,h2,h3,h4,h5,h6");
    const only = block && [...block.childNodes].filter((n) => n.nodeType === 1 || n.data.trim());
    if (only?.length === 1 && /^(STRONG|B)$/.test(only[0].nodeName)) {
      only[0].replaceWith(...only[0].childNodes);
      changed();
    }
  };

  const boldBtn = toolButton("Bold", "B", "Bold (⌘B)", () => exec("bold"), "b");
  const italBtn = toolButton("Italic", "I", "Italic (⌘I)", () => exec("italic"), "i");
  const linkBtn = toolButton("Link", "Link", "Link (⌘K)", () => openLinkEditor());
  const ulBtn = toolButton("Bulleted list", "• List", "Bulleted list", () => exec("insertUnorderedList"));
  const olBtn = toolButton("Numbered list", "1. List", "Numbered list", () => exec("insertOrderedList"));
  const quoteBtn = toolButton("Quote", "“ Quote", "Quote", () => {
    const inQuote = caretElement()?.closest("blockquote");
    exec("formatBlock", inQuote ? "<p>" : "<blockquote>");
  });
  const clearBtn = toolButton("Clear formatting", "Clear", "Remove bold, italic and links from the selection", () => {
    exec("removeFormat");
    exec("unlink");
  });
  const imageBtn = toolButton("Image", "+ Image", "Insert an image", () => insertImage());
  const videoBtn = toolButton("Video", "+ Video", "Embed a YouTube, Vimeo, Wistia or Loom video", () => openVideoEditor());
  const sourceBtn = el("button", { type: "button", className: "rte-btn", title: "Edit the HTML directly", onclick: () => toggleSource() }, "</>");

  const sep = () => el("span", { className: "rte-sep" });
  const toolbar = el("div", { className: "rte-toolbar", attrs: { role: "toolbar", "aria-label": `${label} formatting` } },
    blockSelect, sep(), boldBtn, italBtn, linkBtn, sep(), ulBtn, olBtn, quoteBtn, clearBtn,
    V.media ? [sep(), imageBtn, videoBtn] : null,
    el("span", { className: "rte-spacer" }), words, undoBtn, redoBtn, sourceBtn);

  const paintToolbarState = () => {
    if (!doc) return;
    const n = caretElement();
    const block = n?.closest?.("h1,h2,h3,h4,h5,h6,p,blockquote,li,figcaption");
    const tag = block?.tagName.toLowerCase();
    blockSelect.value = tag === "h1" ? "h2" : tag === "figcaption" ? "p" : tag || "p";
    blockSelect.disabled = tag === "figcaption";
    const state = (cmd) => { try { return doc.queryCommandState(cmd); } catch { return false; } };
    boldBtn.classList.toggle("on", state("bold"));
    italBtn.classList.toggle("on", state("italic"));
    ulBtn.classList.toggle("on", !!n?.closest?.("ul"));
    olBtn.classList.toggle("on", !!n?.closest?.("ol"));
    quoteBtn.classList.toggle("on", !!n?.closest?.("blockquote"));
    linkBtn.classList.toggle("on", !!n?.closest?.("a"));
  };

  /* --------------------------------------------------------- floating -- */

  // Translate a rect inside the iframe into the editor wrapper's coordinates.
  const placeFloating = (node, rect, { below = false } = {}) => {
    const fr = frame.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    node.hidden = false;
    const w = node.offsetWidth, h = node.offsetHeight;
    let top = below ? fr.top - wr.top + rect.bottom + 8 : fr.top - wr.top + rect.top - h - 10;
    if (!below && top + wr.top < 56) top = fr.top - wr.top + rect.bottom + 8;   // no room above
    let left = fr.left - wr.left + rect.left + rect.width / 2 - w / 2;
    left = Math.max(4, Math.min(left, wr.width - w - 4));
    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
  };

  const inlineBar = el("div", { className: "rte-float", hidden: true },
    toolButton("Bold", "B", "Bold", () => exec("bold"), "b"),
    toolButton("Italic", "I", "Italic", () => exec("italic"), "i"),
    toolButton("Link", "Link", "Link", () => openLinkEditor()));

  const updateInlineBar = () => {
    const sel = doc?.getSelection();
    if (!linkBar.hidden || !videoBar.hidden || selectedFig || !sel || sel.isCollapsed || !sel.rangeCount || !root.contains(sel.anchorNode)) {
      inlineBar.hidden = true;
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { inlineBar.hidden = true; return; }
    placeFloating(inlineBar, rect);
  };

  /* ------------------------------------------------------------- links -- */

  const linkInput = el("input", { type: "url", placeholder: "https://… or /project/…", attrs: { "aria-label": "Link address" } });
  const linkNewTab = el("input", { type: "checkbox", id: `rte-newtab-${Math.random().toString(36).slice(2)}` });
  const linkRemove = el("button", { type: "button", className: "btn small" }, "Remove");
  const linkBar = el("div", { className: "rte-popover", hidden: true },
    linkInput,
    el("label", { className: "inline-check" }, linkNewTab, "New tab"),
    el("button", { type: "button", className: "btn small primary", onclick: () => applyLink() }, "Apply"),
    linkRemove,
    el("button", { type: "button", className: "link", onclick: () => closeLinkEditor() }, "Cancel"));
  let editingLink = null;

  function openLinkEditor() {
    saveSelection();
    editingLink = caretElement()?.closest("a") || null;
    if (!editingLink && (!savedRange || savedRange.collapsed)) {
      toast("Select the text to link first.", "error");
      return;
    }
    linkInput.value = editingLink?.getAttribute("href") || "";
    linkNewTab.checked = editingLink ? editingLink.getAttribute("target") === "_blank" : true;
    linkRemove.hidden = !editingLink;
    inlineBar.hidden = true;
    placeFloating(linkBar, (editingLink || savedRange).getBoundingClientRect(), { below: true });
    linkInput.focus();
    linkInput.select();
  }

  function closeLinkEditor() {
    linkBar.hidden = true;
    editingLink = null;
    restoreSelection();
  }

  function applyLink() {
    let url = linkInput.value.trim();
    if (!url) return linkRemove.onclick();
    if (/^www\./i.test(url)) url = "https://" + url;
    if (/^[^/\s:]+\.[a-z]{2,}(\/|$)/i.test(url)) url = "https://" + url;
    if (/^\s*javascript:/i.test(url)) return toast("That isn't a link address.", "error");
    let a = editingLink;
    if (!a) {
      restoreSelection();
      doc.execCommand("createLink", false, url);
      saveSelection();
      a = caretElement()?.closest("a")
        || [...root.querySelectorAll("a")].find((x) => x.getAttribute("href") === url && savedRange?.intersectsNode(x));
    }
    if (a) {
      a.setAttribute("href", url);
      if (linkNewTab.checked) a.setAttribute("target", "_blank");
      else a.removeAttribute("target");
    }
    linkBar.hidden = true;
    editingLink = null;
    changed();
  }

  linkRemove.onclick = () => {
    const a = editingLink || caretElement()?.closest("a");
    if (a) {
      const parent = a.parentNode;
      while (a.firstChild) parent.insertBefore(a.firstChild, a);
      a.remove();
    }
    linkBar.hidden = true;
    editingLink = null;
    changed();
  };

  linkInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyLink(); }
    if (e.key === "Escape") { e.preventDefault(); closeLinkEditor(); }
  });

  /* ------------------------------------------------------------- media -- */

  const makeImageFigure = (src) => {
    const fig = doc.createElement("figure");
    fig.className = "w-richtext-align-center w-richtext-figure-type-image";
    const div = doc.createElement("div");
    const img = doc.createElement("img");
    // Attribute order matches what Webflow writes.
    img.setAttribute("loading", "lazy");
    img.setAttribute("alt", "");
    img.setAttribute("src", toSiteHtml(`src="${src}"`).slice(5, -1));
    div.appendChild(img);
    fig.appendChild(div);
    return fig;
  };

  const makeVideoFigure = (embed) => {
    const fig = doc.createElement("figure");
    fig.setAttribute("style", "padding-bottom:56.25%");
    fig.className = "w-richtext-align-fullwidth w-richtext-figure-type-video";
    const div = doc.createElement("div");
    const frameEl = doc.createElement("iframe");
    frameEl.setAttribute("allowfullscreen", "true");
    frameEl.setAttribute("frameborder", "0");
    frameEl.setAttribute("scrolling", "no");
    frameEl.setAttribute("src", embed.src);
    frameEl.setAttribute("title", embed.title);
    div.appendChild(frameEl);
    fig.appendChild(div);
    return fig;
  };

  /** Insert a block after the caret's block (or at the end), keeping a line to type on after it. */
  const insertBlock = (node, after = currentBlock()) => {
    if (after && after.parentNode === root) after.after(node);
    else root.appendChild(node);
    // An empty paragraph the figure replaced is no longer needed.
    if (after?.tagName === "P" && !after.textContent.replace(/[\s‍]/g, "") && !after.querySelector("img")) after.remove();
    if (!node.nextElementSibling || node.nextElementSibling.tagName === "FIGURE") {
      const p = doc.createElement("p");
      p.appendChild(doc.createElement("br"));
      node.after(p);
    }
  };

  async function insertImage(files) {
    saveSelection();
    const anchor = currentBlock();
    let paths = [];
    if (files) {
      for (const f of files) { const p = await uploadFile(f, { imagesOnly: true }); if (p) paths.push(p); }
    } else {
      paths = (await pickImage({ multiple: true, title: "Insert images" })) || [];
    }
    if (!paths.length) return;
    let after = anchor;
    let last = null;
    for (const p of paths) {
      const fig = makeImageFigure(p);
      insertBlock(fig, after);
      after = fig;
      last = fig;
    }
    changed();
    if (last) selectFigure(last);
  }

  const videoInput = el("input", { type: "url", placeholder: "Paste a YouTube, Vimeo, Wistia or Loom link", attrs: { "aria-label": "Video link" } });
  const videoBar = el("div", { className: "rte-popover", hidden: true },
    videoInput,
    el("button", { type: "button", className: "btn small primary", onclick: () => applyVideo() }, "Embed"),
    el("button", { type: "button", className: "link", onclick: () => { videoBar.hidden = true; replacingVideo = null; } }, "Cancel"));
  let replacingVideo = null;

  function openVideoEditor(fig = null) {
    saveSelection();
    replacingVideo = fig;
    videoInput.value = fig ? fig.querySelector("iframe")?.getAttribute("src") || "" : "";
    const rect = fig ? fig.getBoundingClientRect()
      : (currentBlock() || root.lastElementChild || root).getBoundingClientRect();
    figBar.hidden = true;
    placeFloating(videoBar, rect, { below: !fig });
    videoInput.focus();
    videoInput.select();
  }

  function applyVideo() {
    const embed = embedForUrl(videoInput.value);
    if (!embed) return toast("That link isn't a YouTube, Vimeo, Wistia or Loom video.", "error");
    if (replacingVideo) {
      replacingVideo.querySelector("iframe")?.setAttribute("src", embed.src);
      replacingVideo.querySelector("iframe")?.setAttribute("title", embed.title);
    } else {
      insertBlock(makeVideoFigure(embed));
    }
    videoBar.hidden = true;
    replacingVideo = null;
    changed();
  }

  videoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyVideo(); }
    if (e.key === "Escape") { e.preventDefault(); videoBar.hidden = true; }
  });

  /* ------------------------------------------------- figure settings -- */

  const alignGroup = el("div", { className: "seg", attrs: { role: "group", "aria-label": "Alignment" } });
  const captionBtn = el("button", { type: "button", className: "btn small" }, "Caption");
  const altInput = el("input", { type: "text", placeholder: "Alt text — describe the image", className: "fig-alt", attrs: { "aria-label": "Alt text" } });
  const replaceBtn = el("button", { type: "button", className: "btn small" }, "Replace");
  const upBtn = el("button", { type: "button", className: "btn small icon", title: "Move up", attrs: { "aria-label": "Move up" } }, "↑");
  const downBtn = el("button", { type: "button", className: "btn small icon", title: "Move down", attrs: { "aria-label": "Move down" } }, "↓");
  const delBtn = el("button", { type: "button", className: "btn small danger", title: "Delete (⌫)" }, "Delete");
  const figBar = el("div", { className: "rte-figbar", hidden: true },
    el("div", { className: "row" }, alignGroup, captionBtn, replaceBtn, upBtn, downBtn, delBtn),
    el("div", { className: "row alt-row" }, altInput));

  const alignOf = (fig) => (fig.className.match(/w-richtext-align-(\w+)/) || [])[1] || "normal";

  function paintFigBar() {
    if (!selectedFig) return;
    const isVideo = /figure-type-video/.test(selectedFig.className);
    const current = alignOf(selectedFig);
    alignGroup.replaceChildren(...ALIGNS.filter(([v]) => !isVideo || v === "center" || v === "fullwidth" || v === "normal")
      .map(([v, t, title]) => el("button", {
        type: "button", className: "seg-btn" + (v === current ? " on" : ""), title,
        onclick: () => {
          selectedFig.className = selectedFig.className.replace(/w-richtext-align-\w+/, `w-richtext-align-${v}`);
          if (!/w-richtext-align-/.test(selectedFig.className)) selectedFig.classList.add(`w-richtext-align-${v}`);
          changed(); paintFigBar(); placeFigBar();
        },
      }, t)));
    const cap = selectedFig.querySelector("figcaption");
    captionBtn.textContent = cap ? "Remove caption" : "Add caption";
    captionBtn.hidden = isVideo;
    replaceBtn.textContent = isVideo ? "Change video" : "Replace";
    figBar.querySelector(".alt-row").hidden = isVideo;
    const img = selectedFig.querySelector("img");
    altInput.value = img?.getAttribute("alt") || "";
    altInput.classList.toggle("needs-alt", !altInput.value);
    upBtn.disabled = !selectedFig.previousElementSibling;
    downBtn.disabled = !selectedFig.nextElementSibling;
  }

  const placeFigBar = () => {
    if (!selectedFig) return;
    placeFloating(figBar, selectedFig.getBoundingClientRect());
  };

  function selectFigure(fig) {
    deselectFigure();
    selectedFig = fig;
    fig.classList.add("cms-selected");
    inlineBar.hidden = true;
    paintFigBar();
    placeFigBar();
  }

  function deselectFigure() {
    root?.querySelectorAll("figure.cms-selected").forEach((f) => f.classList.remove("cms-selected"));
    selectedFig = null;
    figBar.hidden = true;
  }

  altInput.oninput = () => {
    const img = selectedFig?.querySelector("img");
    if (!img) return;
    img.setAttribute("alt", altInput.value);
    altInput.classList.toggle("needs-alt", !altInput.value);
    commit();
    recordSoon();
  };

  captionBtn.onclick = () => {
    const fig = selectedFig;
    if (!fig) return;
    const cap = fig.querySelector("figcaption");
    if (cap) {
      cap.remove();
      changed();
      paintFigBar();
      return;
    }
    const c = doc.createElement("figcaption");
    fig.appendChild(c);
    decorate();
    deselectFigure();
    // Put the caret in the new caption so typing goes straight there.
    frame.contentWindow.focus();
    const r = doc.createRange();
    r.selectNodeContents(c);
    r.collapse(true);
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(r);
    fit();
  };

  replaceBtn.onclick = async () => {
    const fig = selectedFig;
    if (!fig) return;
    if (/figure-type-video/.test(fig.className)) return openVideoEditor(fig);
    const picked = await pickImage({ title: "Replace image" });
    if (!picked) return;
    const img = selectedImg && fig.contains(selectedImg) ? selectedImg : fig.querySelector("img");
    // A <picture>'s phone and tablet versions belong to the old image: without
    // them the new one shows at every width, in the editor and on the site.
    const pic = img.parentElement?.tagName === "PICTURE" ? img.parentElement : null;
    if (pic) for (const src of [...pic.querySelectorAll("source")]) src.remove();
    img.setAttribute("src", toSiteHtml(`src="${picked}"`).slice(5, -1));
    img.removeAttribute("data-cms-local-src");
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    changed();
    img.addEventListener("load", () => {
      // width/height described the old picture; they now give the new one's shape.
      if (img.hasAttribute("width") && img.naturalWidth) {
        img.setAttribute("width", String(img.naturalWidth));
        img.setAttribute("height", String(img.naturalHeight));
        changed();
      }
      fit(); placeFigBar();
    }, { once: true });
  };

  const move = (dir) => {
    const fig = selectedFig;
    if (!fig) return;
    const sib = dir < 0 ? fig.previousElementSibling : fig.nextElementSibling;
    if (!sib) return;
    dir < 0 ? sib.before(fig) : sib.after(fig);
    changed();
    paintFigBar();
    fig.scrollIntoView?.({ block: "nearest" });
    requestAnimationFrame(placeFigBar);
  };
  upBtn.onclick = () => move(-1);
  downBtn.onclick = () => move(1);

  const deleteFigure = () => {
    const fig = selectedFig;
    if (!fig) return;
    const next = fig.nextElementSibling || fig.previousElementSibling;
    deselectFigure();
    fig.remove();
    if (!root.firstElementChild) root.innerHTML = "<p><br></p>";
    changed();
    if (next) {
      frame.contentWindow.focus();
      const r = doc.createRange();
      r.selectNodeContents(next);
      r.collapse(true);
      doc.getSelection().removeAllRanges();
      doc.getSelection().addRange(r);
      saveSelection();
    }
  };
  delBtn.onclick = deleteFigure;

  /* ------------------------------------------------------------ source -- */

  const source = el("textarea", { className: "rte-source code", hidden: true, spellcheck: false, attrs: { "aria-label": `${label} HTML` } });
  function toggleSource() {
    if (source.hidden) {
      commit();
      source.value = lastValue.replace(/(<\/(?:p|h[1-6]|blockquote|ul|ol|figure)>)/g, "$1\n");
      source.hidden = false;
      frame.hidden = true;
      sourceBtn.classList.add("on");
      for (const b of toolbar.querySelectorAll("button,select")) if (b !== sourceBtn) b.disabled = true;
      source.style.height = Math.max(240, Math.min(900, source.scrollHeight)) + "px";
      source.focus();
    } else {
      // Newlines between blocks were only for reading; they aren't content.
      root.innerHTML = toSiteHtml(source.value.replace(/>\n+</g, "><").trim());
      source.hidden = true;
      frame.hidden = false;
      sourceBtn.classList.remove("on");
      for (const b of toolbar.querySelectorAll("button,select")) b.disabled = false;
      changed();
      paintHistory();
    }
  }

  /* --------------------------------------------------------------- frame -- */

  const fit = () => {
    if (!doc?.body) return;
    frame.style.height = Math.max(120, doc.documentElement.scrollHeight) + "px";
  };

  const decorate = () => {
    for (const fig of root.querySelectorAll("figure")) {
      fig.setAttribute("contenteditable", "false");
      for (const cap of fig.querySelectorAll("figcaption")) cap.setAttribute("contenteditable", "true");
    }
    if (!root.firstElementChild && !root.textContent.trim()) root.innerHTML = "<p><br></p>";
    showLocalCopies(root);
  };

  function init() {
    if (ready) return;
    doc = frame.contentDocument;
    root = doc?.getElementById("rt-root");
    if (!root) return;
    ready = true;

    root.innerHTML = toSiteHtml(lastValue);
    root.contentEditable = "true";
    root.spellcheck = true;
    root.dataset.placeholder = V.placeholder;
    try { doc.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* old engines */ }
    try { doc.execCommand("styleWithCSS", false, false); } catch { /* ignore */ }
    decorate();
    paintMeta();
    record();

    let raf = 0;
    root.addEventListener("input", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { scrub(); commit(); fit(); });
      recordSoon();
    });

    doc.addEventListener("selectionchange", () => {
      saveSelection();
      updateInlineBar();
      paintToolbarState();
    });

    root.addEventListener("beforeinput", (e) => {
      if (e.inputType === "historyUndo") { e.preventDefault(); undo(); }
      if (e.inputType === "historyRedo") { e.preventDefault(); redo(); }
      if (e.inputType === "formatUnderline") e.preventDefault();   // not in Webflow's rich text
    });

    doc.addEventListener("keydown", (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "k") { e.preventDefault(); openLinkEditor(); return; }
      if (mod && k === "u") { e.preventDefault(); return; }
      if (mod && k === "s") {
        e.preventDefault();
        commit();
        window.dispatchEvent(new CustomEvent("cms:save"));
        return;
      }
      if (selectedFig) {
        if (k === "backspace" || k === "delete") { e.preventDefault(); deleteFigure(); return; }
        if (k === "escape" || k.startsWith("arrow")) deselectFigure();
        return;
      }
      // A caption is one line; Enter leaves it.
      if (k === "enter" && e.target.closest?.("figcaption") || (k === "enter" && caretElement()?.closest("figcaption"))) {
        e.preventDefault();
        const fig = caretElement().closest("figure");
        const after = fig.nextElementSibling;
        if (after) {
          const r = doc.createRange(); r.selectNodeContents(after); r.collapse(true);
          doc.getSelection().removeAllRanges(); doc.getSelection().addRange(r);
        }
      }
    });

    root.addEventListener("click", (e) => {
      const fig = e.target.closest?.("figure");
      if (fig && !e.target.closest("figcaption")) {
        e.preventDefault();
        selectFigure(fig);
        selectedImg = e.target.closest("img") || null;
        return;
      }
      if (selectedFig) deselectFigure();
      // Links are edited, not followed.
      if (e.target.closest?.("a")) e.preventDefault();
    });

    root.addEventListener("paste", (e) => {
      e.preventDefault();
      const cd = e.clipboardData;
      const inCaption = caretElement()?.closest("figcaption");
      const html = cd.getData("text/html");
      const text = cd.getData("text/plain");
      if (V.media && !html && !text && cd.files?.length) return insertImage([...cd.files]);
      if (inCaption || (!html && !/\n/.test(text))) {
        doc.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
      } else {
        const clean = html ? cleanPastedHtml(html, doc) : textToParagraphs(text);
        if (clean) doc.execCommand("insertHTML", false, clean);
      }
      changed();
    });

    root.addEventListener("drop", (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
      e.preventDefault();
      if (V.media && files.length) {
        const pos = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (pos) { savedRange = pos; }
        insertImage(files);
      }
    });

    root.addEventListener("focusout", () => commit());

    doc.addEventListener("scroll", () => { updateInlineBar(); placeFigBar(); }, true);
    for (const img of root.querySelectorAll("img")) img.addEventListener("load", fit, { once: true });
    try { new frame.contentWindow.ResizeObserver(() => { fit(); placeFigBar(); }).observe(doc.body); } catch { /* old engines */ }
    fit();
  }

  const reposition = () => { updateInlineBar(); placeFigBar(); };
  window.addEventListener("resize", reposition);
  document.addEventListener("scroll", reposition, true);

  // srcdoc doesn't reliably fire `load` before the document is reachable, so
  // initialisation is attempted from both, and init() is idempotent.
  frame.addEventListener("load", init);
  const poll = setInterval(() => { init(); if (ready) clearInterval(poll); }, 50);
  setTimeout(() => clearInterval(poll), 15000);

  frame.srcdoc =
    "<!doctype html><html><head><meta charset='utf-8'>" +
    (CONFIG.siteCss || []).map((h) => `<link rel="stylesheet" href="${h}">`).join("") +
    pageStyles +
    `<style>${EDITOR_CSS}</style></head><body class="body-mod">` +
    V.frame(`<div id="rt-root" class="${V.rootClass}"></div>`) +
    "</body></html>";

  wrap.append(toolbar, el("div", { className: "rte-stage" }, frame, source), inlineBar, linkBar, videoBar, figBar);

  // Clicking the toolbar's empty space, or anywhere outside a figure, closes figure settings.
  document.addEventListener("mousedown", (e) => {
    if (!wrap.isConnected) return;
    if (!figBar.contains(e.target) && !e.target.closest?.(".overlay")) deselectFigure();
    if (!linkBar.contains(e.target) && !linkBar.hidden && !toolbar.contains(e.target)) linkBar.hidden = true;
    if (!videoBar.contains(e.target) && !videoBar.hidden && !toolbar.contains(e.target)) videoBar.hidden = true;
  });

  wrap.getValue = () => { commit(); return lastValue; };
  return wrap;
}
