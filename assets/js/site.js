/*
 * Site behaviour, on every page (built in, not Custom code).
 * Animations are in motion.js; this is everything else the pages need.
 */
(function () {
  "use strict";
  var doc = document;

  /*
   * Menu: the page is locked while the menu is open - from the moment it
   * starts sliding in until it has slid away - read from the menu itself, not
   * by counting clicks (a click counter got out of step after the first
   * open/close, so the page scrolled under the open menu and Close moved away).
   */
  function menuShown() {
    var n = doc.querySelector(".nav-menu");
    if (!n) return false;
    var cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    var r = n.getBoundingClientRect();
    return r.bottom > 1 && r.top < window.innerHeight - 1;
  }
  var menuLocked = false;
  function syncMenuLock() {
    var open = menuShown();
    if (open && !menuLocked) { menuLocked = true; doc.body.style.overflow = "hidden"; }
    else if (!open && menuLocked) { menuLocked = false; doc.body.style.overflow = ""; }
  }
  // The menu animates after a click: follow it until it has settled.
  doc.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".menu-button-container, .close-menu-button, .nav-menu a")) return;
    var tries = 0;
    var timer = setInterval(function () { syncMenuLock(); if (++tries > 30) clearInterval(timer); }, 80);
  }, true);

  /*
   * While the page is locked (the open menu, a full-screen video), pin it in
   * place: position fixed at its current offset. "overflow: hidden" alone
   * doesn't stop touch and trackpad scrolling on iPhone/iPad Safari, so the
   * page (with the photo and the Close button) scrolled under the fixed menu.
   * On release the page is put back exactly where it was.
   */
  var pinnedAt = null;
  function pin() {
    if (pinnedAt !== null) return;
    pinnedAt = window.pageYOffset;
    var s = doc.body.style;
    s.position = "fixed"; s.top = -pinnedAt + "px"; s.left = "0"; s.right = "0"; s.width = "100%";
  }
  function unpin() {
    if (pinnedAt === null) return;
    var y = pinnedAt;
    pinnedAt = null;
    var s = doc.body.style;
    s.position = ""; s.top = ""; s.left = ""; s.right = ""; s.width = "";
    // Back to the same spot: natively first, then smooth scrolling re-measures
    // the page (it was pinned, so its height read as one screen) and follows.
    window.scrollTo(0, y);
    if (window.lenis) {
      if (window.lenis.resize) window.lenis.resize();
      window.lenis.scrollTo(y, { immediate: true, force: true });
    }
  }
  new MutationObserver(function () {
    if (doc.body.style.overflow === "hidden") pin(); else unpin();
  }).observe(doc.body, { attributes: true, attributeFilter: ["style"] });

  /*
   * Copy to clipboard: an element with data-copy copies on click - its own
   * text when data-copy="1", the page address for "url", the text of the
   * element named by data-copy-from, or else the value itself.
   */
  function attr(el, a, b) { return el.getAttribute(a) != null ? el.getAttribute(a) : el.getAttribute(b); }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    legacyCopy(text);
  }
  function legacyCopy(text) {
    var input = doc.createElement("input");
    doc.body.appendChild(input);
    input.value = text;
    input.select();
    try { doc.execCommand("copy"); } catch (err) { /* nothing to do */ }
    doc.body.removeChild(input);
  }
  doc.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-copy],[r-copy-to-clipboard]");
    if (!el) return;
    var value = attr(el, "data-copy", "r-copy-to-clipboard");
    if (!value) return;
    var from = attr(el, "data-copy-from", "custom-element");
    var text = from ? ((doc.querySelector(from) || {}).innerText || "")
      : value.toLowerCase() === "url" ? location.href
      : value === "1" ? el.innerText : value;
    copy(text);
  });

  /*
   * Links: href="#" does nothing (it is a button for an animation), and a
   * link to a section of this page scrolls there smoothly.
   */
  var validHash = /^#[a-zA-Z0-9][\w:.-]*$/;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  function samePage(a) { return a.host + a.pathname === location.host + location.pathname; }
  function headerOffset() {
    var h = doc.querySelector("header, body > .header, body > .w-nav:not([data-no-scroll])");
    return h && getComputedStyle(h).position === "fixed" ? h.offsetHeight : 0;
  }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }
  // Where an element sits in the layout, ignoring transforms: sections that
  // move with a scroll parallax (the footer) would otherwise be aimed at where
  // they appear at the moment of the click, not where they end up.
  function layoutTop(el) {
    var y = 0;
    for (var e = el; e; e = e.offsetParent) y += e.offsetTop;
    return y;
  }
  function maxScroll() { return document.documentElement.scrollHeight - window.innerHeight; }
  function scrollToY(end, duration, done) {
    var start = window.pageYOffset;
    end = Math.max(0, Math.min(end, maxScroll()));
    if (Math.abs(start - end) < 1) { if (done) done(); return; }
    if (window.lenis) {
      window.lenis.scrollTo(end, { duration: duration / 1000, immediate: !duration, easing: easeInOutCubic, force: true, onComplete: done });
      return;
    }
    var t0 = Date.now();
    (function step() {
      var t = Date.now() - t0;
      window.scrollTo(0, t >= duration ? end : start + (end - start) * easeInOutCubic(t / duration));
      if (t < duration) requestAnimationFrame(step); else if (done) done();
    })();
  }
  function scrollToEl(target, done) {
    var start = window.pageYOffset;
    // scroll-margin-top on the target (CSS, set in the Designer) leaves room above it.
    var margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    var end = layoutTop(target) - headerOffset() - margin;
    var duration = reduced && reduced.matches ? 0 : Math.max(0, 472.143 * Math.log(Math.abs(start - end) + 125) - 2000);
    var tries = 0;
    scrollToY(end, duration, function settle() {
      // Arrived: whatever the parallax still shifts at this spot is corrected
      // with a short glide (twice at most), unless the page can't scroll further.
      var miss = target.getBoundingClientRect().top - headerOffset() - margin;
      var room = miss > 0 ? maxScroll() - window.pageYOffset : window.pageYOffset;
      if (Math.abs(miss) > 2 && room > 2 && tries++ < 2) {
        setTimeout(function () { scrollToY(window.pageYOffset + miss, reduced && reduced.matches ? 0 : 250, settle); }, 60);
      } else if (done) done();
    });
  }
  doc.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var href = a.getAttribute("href");
    if (href === "#") { e.preventDefault(); return; }
    if (!validHash.test(a.hash) || !samePage(a)) return;
    var target = doc.getElementById(a.hash.slice(1));
    if (!target) return;
    e.preventDefault();
    if (location.hash !== a.hash && history.pushState) history.pushState({ hash: a.hash }, "", a.hash);
    scrollToEl(target, function () {
      var had = target.getAttribute("tabindex");
      if (had == null) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      if (had == null) target.removeAttribute("tabindex");
    });
  });

  // A link to a section of this page is marked current while that section is in view.
  function markSections() {
    var links = [].slice.call(doc.querySelectorAll("a[href^='#']")).filter(function (a) {
      return validHash.test(a.hash) && doc.getElementById(a.hash.slice(1));
    });
    if (!links.length) return;
    function update() {
      var top = window.pageYOffset, h = window.innerHeight;
      links.forEach(function (a) {
        var s = doc.getElementById(a.hash.slice(1)), r = s.getBoundingClientRect();
        var y = r.top + top, off = h * 0.5;
        var visible = s.offsetParent !== null || getComputedStyle(s).position === "fixed";
        a.classList.toggle("w--current", visible && y + r.height - off >= top && y + off <= top + h);
      });
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", markSections); else markSections();

  /*
   * Forms: a form sends through the form service set in Site settings
   * (contact-form.js). Until one is set the form has nowhere to go, so it
   * shows its error message instead of reloading the page.
   */
  doc.addEventListener("submit", function (e) {
    var form = e.target;
    if (e.defaultPrevented || !form.closest || !form.closest(".w-form") || form.getAttribute("action")) return;
    e.preventDefault();
    var box = form.closest(".w-form");
    var fail = box.querySelector(".w-form-fail");
    if (fail) { fail.style.display = "block"; fail.setAttribute("role", "alert"); }
  });
})();
