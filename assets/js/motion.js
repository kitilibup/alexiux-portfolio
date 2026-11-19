/*
 * motion.js - the site's interactions engine.
 *
 * Plays the animations described in assets/js/interactions.js: the preloader,
 * slide-ins on scroll, hovers, the menu, the copy-email reveal, mouse and
 * scroll parallax. The data keeps the format the site was designed in
 * (events -> action lists -> timed action groups, or keyframed "continuous"
 * groups driven by the mouse or scroll position), and this engine follows the
 * same rules for triggers, timing, easing, chaining and rendering, so every
 * animation looks and feels as it did. ~8 KB instead of ~1.2 MB of
 * third-party runtime.
 *
 * Elements are found by data-ix (the element id in the data); events can be
 * limited to a page (<html data-page>) and to breakpoints.
 */
(function () {
  "use strict";
  var DATA = window.SITE_INTERACTIONS;
  if (!DATA || window.__siteMotion) return;
  window.__siteMotion = true;

  var doc = document;
  var root = doc.documentElement;
  var PAGE = root.getAttribute("data-page") || root.getAttribute("data-wf-page");
  var EVENTS = DATA.events || {};
  var LISTS = DATA.actionLists || {};
  var MEDIA = DATA.mediaQueries || [];
  var MEDIA_KEYS = MEDIA.map(function (m) { return m.key; });

  /* ------------------------------------------------------------ easing -- */

  function round5(v) {
    var r = Math.round(v * 1e5) / 1e5;
    return Math.abs(r) > 0.0001 ? r : 0;
  }

  // Cubic bezier timing function (as CSS cubic-bezier()).
  function bezier(x1, y1, x2, y2) {
    function a(p1, p2) { return 1 - 3 * p2 + 3 * p1; }
    function b(p1, p2) { return 3 * p2 - 6 * p1; }
    function c(p1) { return 3 * p1; }
    function at(t, p1, p2) { return ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t; }
    function slope(t, p1, p2) { return 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1); }
    function tFor(x) {
      var t = x;
      for (var i = 0; i < 8; i++) {
        var s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-7) break;
        var dx = at(t, x1, x2) - x;
        if (Math.abs(dx) < 1e-7) return t;
        t -= dx / s;
      }
      var lo = 0, hi = 1;
      t = x;
      for (var j = 0; j < 30; j++) {
        var v = at(t, x1, x2);
        if (Math.abs(v - x) < 1e-7) break;
        if (x > v) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    }
    return function (x) { return x <= 0 ? 0 : x >= 1 ? 1 : at(tFor(x), y1, y2); };
  }

  function elastic(out) {
    return function (pos) {
      if (pos === 0) return 0;
      if (pos === 1) return 1;
      var p = 0.3, s = p / (2 * Math.PI) * Math.asin(1);
      return out
        ? Math.pow(2, -10 * pos) * Math.sin((pos - s) * (2 * Math.PI) / p) + 1
        : -(Math.pow(2, 10 * (pos -= 1)) * Math.sin((pos - s) * (2 * Math.PI) / p));
    };
  }
  function outBounce(pos) {
    if (pos < 1 / 2.75) return 7.5625 * pos * pos;
    if (pos < 2 / 2.75) return 7.5625 * (pos -= 1.5 / 2.75) * pos + 0.75;
    if (pos < 2.5 / 2.75) return 7.5625 * (pos -= 2.25 / 2.75) * pos + 0.9375;
    return 7.5625 * (pos -= 2.625 / 2.75) * pos + 0.984375;
  }
  function inOut(n) {
    return function (pos) {
      if ((pos /= 0.5) < 1) return 0.5 * Math.pow(pos, n);
      return n % 2 ? 0.5 * (Math.pow(pos - 2, n) + 2) : -0.5 * ((pos -= 2) * Math.pow(pos, n - 1) - 2);
    };
  }
  var EASING = {
    ease: bezier(0.25, 0.1, 0.25, 1), easeIn: bezier(0.42, 0, 1, 1),
    easeOut: bezier(0, 0, 0.58, 1), easeInOut: bezier(0.42, 0, 0.58, 1),
    inQuad: function (p) { return p * p; }, outQuad: function (p) { return -(Math.pow(p - 1, 2) - 1); },
    inOutQuad: function (p) { return (p /= 0.5) < 1 ? 0.5 * p * p : -0.5 * ((p -= 2) * p - 2); },
    inCubic: function (p) { return Math.pow(p, 3); }, outCubic: function (p) { return Math.pow(p - 1, 3) + 1; },
    inOutCubic: inOut(3),
    inQuart: function (p) { return Math.pow(p, 4); }, outQuart: function (p) { return -(Math.pow(p - 1, 4) - 1); },
    inOutQuart: inOut(4),
    inQuint: function (p) { return Math.pow(p, 5); }, outQuint: function (p) { return Math.pow(p - 1, 5) + 1; },
    inOutQuint: inOut(5),
    inSine: function (p) { return -Math.cos(p * (Math.PI / 2)) + 1; }, outSine: function (p) { return Math.sin(p * (Math.PI / 2)); },
    inOutSine: function (p) { return -0.5 * (Math.cos(Math.PI * p) - 1); },
    inExpo: function (p) { return p === 0 ? 0 : Math.pow(2, 10 * (p - 1)); },
    outExpo: function (p) { return p === 1 ? 1 : -Math.pow(2, -10 * p) + 1; },
    inOutExpo: function (p) {
      if (p === 0 || p === 1) return p;
      return (p /= 0.5) < 1 ? 0.5 * Math.pow(2, 10 * (p - 1)) : 0.5 * (-Math.pow(2, -10 * --p) + 2);
    },
    inCirc: function (p) { return -(Math.sqrt(1 - p * p) - 1); }, outCirc: function (p) { return Math.sqrt(1 - Math.pow(p - 1, 2)); },
    inOutCirc: function (p) { return (p /= 0.5) < 1 ? -0.5 * (Math.sqrt(1 - p * p) - 1) : 0.5 * (Math.sqrt(1 - (p -= 2) * p) + 1); },
    inBack: function (p) { var s = 1.70158; return p * p * ((s + 1) * p - s); },
    outBack: function (p) { var s = 1.70158; return (p -= 1) * p * ((s + 1) * p + s) + 1; },
    inOutBack: function (p) {
      var s = 1.70158 * 1.525;
      return (p /= 0.5) < 1 ? 0.5 * (p * p * ((s + 1) * p - s)) : 0.5 * ((p -= 2) * p * ((s + 1) * p + s) + 2);
    },
    inElastic: elastic(false), outElastic: elastic(true),
    inBounce: function (p) { return 1 - outBounce(1 - p); }, outBounce: outBounce,
  };
  function ease(name, pos) {
    if (pos === 0) return 0;
    if (pos === 1) return 1;
    var fn = name && EASING[name];
    return round5(pos > 0 && fn ? fn(pos) : pos);
  }

  /* ----------------------------------------------------------- targets -- */

  function selectorOf(t) {
    if (!t) return null;
    if (t.id) {
      var id = t.id;
      if (id.indexOf("|") !== -1) {
        var pair = id.split("|");
        if (pair[0] !== PAGE) return null; // another page's element
        id = pair[1];
      }
      // data-ix on the published site; data-w-id where the markup isn't optimised (local preview).
      return '[data-ix="' + id + '"],[data-ix^="' + id + '_instance"],[data-w-id="' + id + '"],[data-w-id^="' + id + '_instance"]';
    }
    return t.selector || null;
  }
  function all(sel) { return sel ? Array.prototype.slice.call(doc.querySelectorAll(sel)) : []; }

  /** The elements an action (or an event) applies to. */
  function affected(config, event, eventTarget) {
    if (config.targets && config.targets.length) {
      return config.targets.reduce(function (acc, t) { return acc.concat(affected({ target: t }, event, eventTarget)); }, []);
    }
    var t = config.target;
    if (!t) return [];
    if (t.appliesTo === "PAGE") return t.id == null || t.id === PAGE ? [doc] : [];
    var sel = selectorOf(t);
    var use = t.useEventTarget;
    if (event && use) {
      var targets = eventTarget && (sel || use === true) ? [eventTarget] : all(selectorOf(event.target));
      if (sel) {
        if (use === "PARENT") return all(sel).filter(function (p) { return targets.some(function (e) { return p.contains(e); }); });
        if (use === "CHILDREN") return all(sel).filter(function (c) { return targets.some(function (e) { return e.contains(c); }); });
        if (use === "SIBLINGS") return all(sel).filter(function (s) { return targets.some(function (e) { return e !== s && e.parentNode === s.parentNode; }); });
      }
      return targets;
    }
    return all(sel);
  }

  /* ------------------------------------------------------------ values -- */

  var TRANSFORMS = {
    TRANSFORM_MOVE: { xValue: 0, yValue: 0, zValue: 0 },
    TRANSFORM_SCALE: { xValue: 1, yValue: 1, zValue: 1 },
    TRANSFORM_ROTATE: { xValue: 0, yValue: 0, zValue: 0 },
    TRANSFORM_SKEW: { xValue: 0, yValue: 0 },
  };
  var FILTERS = { blur: 0, "hue-rotate": 0, invert: 0, grayscale: 0, saturate: 100, sepia: 0, contrast: 100, brightness: 100 };
  var COLOR_PROP = { STYLE_BACKGROUND_COLOR: "backgroundColor", STYLE_BORDER: "borderColor", STYLE_TEXT_COLOR: "color" };
  var WILL_CHANGE = { transform: "transform", backgroundColor: "background", opacity: "opacity", filter: "filter", width: "width", height: "height" };

  var refs = new WeakMap(); // element -> { [actionTypeId]: current values + units }
  function refState(el) {
    var s = refs.get(el);
    if (!s) refs.set(el, (s = {}));
    return s;
  }
  function kind(type) {
    return /^TRANSFORM_/.test(type) ? "transform" : /^STYLE_/.test(type) ? "style" : /^GENERAL_/.test(type) ? "general" : "plugin";
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

  function parseColor(el, type) {
    var prop = COLOR_PROP[type];
    var inline = el.style[prop];
    var value = /^rgb/.test(inline) ? inline : getComputedStyle(el)[prop];
    var m = (/rgba?\(([^)]+)\)/.exec(value) || [, ""])[1].split(",");
    return { rValue: num(parseInt(m[0], 10), 255), gValue: num(parseInt(m[1], 10), 255), bValue: num(parseInt(m[2], 10), 255), aValue: num(m[3], 1) };
  }

  function originOf(el, item) {
    var type = item.actionTypeId, st = refState(el);
    if (TRANSFORMS[type]) return st[type] || TRANSFORMS[type];
    switch (type) {
      case "STYLE_FILTER":
        var f = st[type] || {};
        (item.config.filters || []).forEach(function (x) { if (f[x.type] == null) f[x.type] = FILTERS[x.type]; });
        return f;
      case "STYLE_OPACITY":
        return { value: num(el.style.opacity, 1) };
      case "STYLE_SIZE":
        var cs = getComputedStyle(el), w = el.style.width, h = el.style.height;
        return {
          widthValue: item.config.widthUnit === "AUTO" && /px/.test(w) ? parseFloat(w) : num(w, parseFloat(cs.width)),
          heightValue: item.config.heightUnit === "AUTO" && /px/.test(h) ? parseFloat(h) : num(h, parseFloat(cs.height)),
        };
      case "STYLE_BACKGROUND_COLOR": case "STYLE_BORDER": case "STYLE_TEXT_COLOR":
        return parseColor(el, type);
      case "GENERAL_DISPLAY":
        return { value: el.style.display || getComputedStyle(el).display };
    }
    return {};
  }

  function destinationOf(el, item) {
    var c = item.config, type = item.actionTypeId;
    if (TRANSFORMS[type]) return { xValue: c.xValue, yValue: c.yValue, zValue: c.zValue };
    switch (type) {
      case "STYLE_SIZE":
        var w = c.widthValue, h = c.heightValue, keep;
        if (c.widthUnit === "AUTO") { keep = el.style.width; el.style.width = ""; w = el.offsetWidth; el.style.width = keep; }
        if (c.heightUnit === "AUTO") { keep = el.style.height; el.style.height = ""; h = el.offsetHeight; el.style.height = keep; }
        return { widthValue: w, heightValue: h };
      case "STYLE_BACKGROUND_COLOR": case "STYLE_BORDER": case "STYLE_TEXT_COLOR":
        return { rValue: c.rValue, gValue: c.gValue, bValue: c.bValue, aValue: c.aValue };
      case "STYLE_FILTER":
        return (c.filters || []).reduce(function (r, f) { r[f.type] = f.value || 0; return r; }, {});
    }
    return { value: c.value };
  }

  function configValue(type, key, config) {
    if (type === "STYLE_FILTER") {
      var hit = null;
      (config.filters || []).forEach(function (f) { if (f.type === key) hit = f; });
      return hit ? hit.value : 0;
    }
    return config[key];
  }

  // The units an action writes (only for the values it sets).
  function unitsOf(item) {
    var c = item.config, r = {};
    [["xValue", "xUnit"], ["yValue", "yUnit"], ["zValue", "zUnit"], ["value", "unit"]].forEach(function (p) {
      if (c[p[0]] != null && c[p[1]] != null) r[p[1]] = c[p[1]];
    });
    return r;
  }
  function mergeState(el, type, values, item) {
    var st = refState(el), next = {}, k, prev = st[type] || {};
    for (k in prev) next[k] = prev[k];
    for (k in values) next[k] = values[k];
    var u = unitsOf(item);
    for (k in u) next[k] = u[k];
    st[type] = next;
  }

  /* ----------------------------------------------------------- render -- */

  function addWillChange(el, prop) {
    var v = WILL_CHANGE[prop];
    if (!v) return;
    var cur = el.style.willChange;
    if (!cur) { el.style.willChange = v; return; }
    var list = cur.split(",").map(function (s) { return s.trim(); });
    if (list.indexOf(v) === -1) el.style.willChange = list.concat(v).join(",");
  }
  function removeWillChange(el, prop) {
    var v = WILL_CHANGE[prop], cur = el.style.willChange;
    if (!v || !cur || cur.indexOf(v) === -1) return;
    el.style.willChange = cur.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s !== v; }).join(",");
  }
  function propsOf(type) {
    if (TRANSFORMS[type]) return ["transform"];
    if (type === "STYLE_OPACITY") return ["opacity"];
    if (type === "STYLE_FILTER") return ["filter"];
    if (type === "STYLE_SIZE") return ["width", "height"];
    if (COLOR_PROP[type]) return [COLOR_PROP[type]];
    if (type === "GENERAL_DISPLAY") return ["display"];
    return [];
  }

  function renderTransform(el, item) {
    var st = refState(el);
    el.style.transform = Object.keys(TRANSFORMS).map(function (type) {
      var d = TRANSFORMS[type], s = st[type] || {};
      var x = s.xValue === undefined ? d.xValue : s.xValue, y = s.yValue === undefined ? d.yValue : s.yValue,
        z = s.zValue === undefined ? d.zValue : s.zValue;
      var xu = s.xUnit || "", yu = s.yUnit || "", zu = s.zUnit || "";
      if (type === "TRANSFORM_MOVE") return "translate3d(" + x + xu + ", " + y + yu + ", " + z + zu + ")";
      if (type === "TRANSFORM_SCALE") return "scale3d(" + x + xu + ", " + y + yu + ", " + z + zu + ")";
      if (type === "TRANSFORM_ROTATE") return "rotateX(" + x + xu + ") rotateY(" + y + yu + ") rotateZ(" + z + zu + ")";
      return "skew(" + x + xu + ", " + y + yu + ")";
    }).join(" ");
    addWillChange(el, "transform");
    var s = st[item.actionTypeId] || {};
    var t = item.actionTypeId;
    if (((t === "TRANSFORM_MOVE" || t === "TRANSFORM_SCALE") && s.zValue !== undefined) ||
        (t === "TRANSFORM_ROTATE" && (s.xValue !== undefined || s.yValue !== undefined))) {
      el.style.transformStyle = "preserve-3d";
    }
  }

  function render(el, item) {
    var type = item.actionTypeId, k = kind(type), c = item.config, s = refState(el)[type] || {};
    if (k === "transform") return renderTransform(el, item);
    if (k === "general") {
      if (type === "GENERAL_DISPLAY") el.style.display = c.value;
      return;
    }
    if (k !== "style") return;
    if (type === "STYLE_SIZE") {
      if (s.widthValue !== undefined) { addWillChange(el, "width"); el.style.width = s.widthValue + (c.widthUnit === "AUTO" ? "px" : c.widthUnit || ""); }
      if (s.heightValue !== undefined) { addWillChange(el, "height"); el.style.height = s.heightValue + (c.heightUnit === "AUTO" ? "px" : c.heightUnit || ""); }
    } else if (type === "STYLE_FILTER") {
      addWillChange(el, "filter");
      el.style.filter = Object.keys(s).reduce(function (r, f) {
        var unit = null;
        (c.filters || []).forEach(function (x) { if (x.type === f && x.unit) unit = x.unit; });
        return r + " " + f + "(" + s[f] + (unit || (f === "blur" ? "px" : f === "hue-rotate" ? "deg" : "%")) + ")";
      }, "");
    } else if (COLOR_PROP[type]) {
      var p = COLOR_PROP[type], r = Math.round(s.rValue), g = Math.round(s.gValue), b = Math.round(s.bValue);
      addWillChange(el, p);
      el.style[p] = s.aValue >= 1 ? "rgb(" + r + "," + g + "," + b + ")" : "rgba(" + r + "," + g + "," + b + "," + s.aValue + ")";
    } else {
      var prop = type.replace("STYLE_", "").toLowerCase();
      addWillChange(el, prop);
      el.style[prop] = s.value + (c.unit || "");
    }
  }

  /* -------------------------------------------------------- instances -- */

  var instances = [];
  var params = {};
  var eventState = {};
  var tick = 0;

  /*
   * Preloader clock. The page-load animations of a page with a preloader run
   * on a clock that follows the real loading: the battery fills as the page,
   * its fonts and images and the video player load (up to twice
   * as fast as designed when they are quick), waits while they are still
   * loading, and once everything is ready the rest plays exactly as designed.
   */
  var LOAD_SPEED = 2, LOAD_CAP = 9000;
  var loadClock = { events: {}, full: 0, v: 0, last: 0, start: 0, progress: 0, active: false };
  // The battery fills for at least this long (Site settings > General > Preloader minimum time).
  var LOAD_MIN = Number(window.SITE_PRELOADER_MIN) || 0;
  function setupLoadClock() {
    var pre = null;
    Object.keys(LISTS).forEach(function (id) { if (!pre && /preloader/i.test(JSON.stringify(LISTS[id].actionItemGroups || []))) pre = id; });
    if (!pre || !doc.querySelector(".preloader")) return;
    var page = null;
    Object.keys(EVENTS).forEach(function (id) {
      var ev = EVENTS[id];
      if (ev.eventTypeId === "PAGE_START" && ev.action.config.actionListId === pre && affected({ target: ev.target }).length) page = ev.target.id;
    });
    if (!page) return;
    Object.keys(EVENTS).forEach(function (id) {
      var ev = EVENTS[id];
      if (ev.eventTypeId === "PAGE_START" && ev.target.id === page && !(ev.config && ev.config.loop)) loadClock.events[id] = true;
    });
    // "Full" is the end of the first group after the initial state: the battery filled.
    var list = LISTS[pre], g = (list.actionItemGroups || [])[list.useFirstGroupAsInitialState ? 1 : 0];
    loadClock.full = g ? g.actionItems.reduce(function (m, it) { return Math.max(m, (it.config.delay || 0) + (it.config.duration || 0)); }, 0) : 0;
    loadClock.active = true;
    trackLoading();
  }
  function trackLoading() {
    var tasks = 0, done = 0;
    function task(promiseLike) {
      tasks++;
      var finished = false;
      var finish = function () { if (!finished) { finished = true; done++; } update(); };
      promiseLike(finish);
    }
    function update() { loadClock.progress = Math.max(loadClock.progress, tasks ? done / tasks : 1); }
    task(function (f) { doc.readyState === "loading" ? doc.addEventListener("DOMContentLoaded", f) : f(); });
    task(function (f) { (doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve()).then(f, f); });
    [].slice.call(doc.images).filter(function (i) { return i.loading !== "lazy"; }).forEach(function (img) {
      task(function (f) { if (img.complete) f(); else { img.addEventListener("load", f); img.addEventListener("error", f); } });
    });
    task(function (f) { doc.readyState === "complete" ? f() : window.addEventListener("load", f); });
    // The 3D scene (far down the page) keeps loading in the background; the
    // preloader doesn't wait for it.
    setTimeout(function () { loadClock.progress = 1; }, LOAD_CAP);
    update();
  }
  function advanceLoadClock(now) {
    if (!loadClock.active) return;
    var dt = loadClock.last ? Math.min(now - loadClock.last, 100) : 0;
    loadClock.last = now;
    if (!loadClock.start) loadClock.start = now;
    if (loadClock.v < loadClock.full) {
      var share = LOAD_MIN ? Math.min(1, (now - loadClock.start) / LOAD_MIN) : 1;
      var limit = loadClock.full * Math.min(loadClock.progress, share);
      loadClock.v = Math.max(loadClock.v, Math.min(loadClock.v + dt * LOAD_SPEED, limit));
      if (loadClock.progress >= 1 && share >= 1 && limit <= loadClock.v) loadClock.v = Math.min(loadClock.v, loadClock.full);
    } else {
      loadClock.v += dt;
    }
  }
  function clockOf(o, now) { return o.loadClock ? loadClock.v : now; }
  var mediaKey = null;

  function mediaAllows(list) {
    return mediaKey == null || (list || MEDIA_KEYS).indexOf(mediaKey) !== -1;
  }

  function create(o) {
    var el = o.element, item = o.actionItem;
    var origin = originOf(el, item);
    mergeState(el, item.actionTypeId, origin, item);
    var dest = destinationOf(el, item);
    o.origin = origin;
    o.destination = dest;
    o.keys = Object.keys(dest).filter(function (k) { return dest[k] != null && typeof dest[k] !== "string"; });
    o.kind = kind(item.actionTypeId);
    o.position = 0;
    o.current = null;
    o.active = false;
    o.complete = false;
    instances.push(o);
    if (o.immediate) {
      o.active = true; o.start = 0;
      if (stepTimed(o, performance.now())) changed(o);
      return;
    }
    o.loadClock = !!(loadClock.active && loadClock.events[o.eventId]);
    if (!o.continuous) { o.active = true; o.start = o.loadClock ? loadClock.v : tick; }
  }

  function remove(o) {
    var i = instances.indexOf(o);
    if (i !== -1) instances.splice(i, 1);
    var el = o.element, c = o.actionItem.config;
    if (o.actionItem.actionTypeId === "STYLE_SIZE") {
      if (c.widthUnit === "AUTO") el.style.width = "";
      if (c.heightUnit === "AUTO") el.style.height = "";
    }
    if (el.style && el.style.willChange) propsOf(o.actionItem.actionTypeId).forEach(function (p) { removeWillChange(el, p); });
  }

  function stepTimed(o, now) {
    if (!o.active) return false;
    var c = o.actionItem.config;
    var duration = c.duration, delay = o.instanceDelay != null ? o.instanceDelay : c.delay;
    if (o.kind === "general") duration = 0;
    else if (o.immediate) duration = delay = 0;
    var delta = clockOf(o, now) - (o.start + (delay || 0));
    if (delta < 0) return false;
    var position = round5(Math.min(Math.max(0, delta / duration), 1));
    if (isNaN(position)) position = 0;
    var eased = ease(c.easing, position);
    if (o.keys.length) {
      var cur = {};
      o.keys.forEach(function (k) {
        var from = parseFloat(o.origin[k]) || 0;
        cur[k] = (parseFloat(o.destination[k]) - from) * eased + from;
      });
      o.current = cur;
    } else o.current = null;
    o.position = position;
    if (position === 1) { o.active = false; o.complete = true; }
    return true;
  }

  function stepContinuous(o) {
    var velocity = Math.max(1 - o.smoothing, 0.01);
    var value = params[o.parameterId];
    if (value == null) { velocity = 1; value = o.restingValue; }
    var next = Math.max(value, 0) || 0;
    var position = round5(o.position + round5(next - o.position) * velocity);
    if (position === o.position && o.current) return false;
    var key = position * 100, from, to, offset, range;
    for (var i = 0; i < o.actionGroups.length; i++) {
      var g = o.actionGroups[i];
      if (i === 0) from = g.actionItems[0];
      if (key >= g.keyframe) {
        from = g.actionItems[0];
        var n = o.actionGroups[i + 1];
        var has = n && key !== g.keyframe;
        to = has ? n.actionItems[0] : null;
        if (has) { offset = g.keyframe / 100; range = (n.keyframe - g.keyframe) / 100; }
      }
    }
    var cur = {}, type = o.actionItem.actionTypeId;
    if (from && !to) {
      o.keys.forEach(function (k) { cur[k] = configValue(type, k, from.config); });
    } else if (from && to && offset !== undefined) {
      var eased = ease(from.config.easing, (position - offset) / range);
      o.keys.forEach(function (k) {
        var a = configValue(type, k, from.config), b = configValue(type, k, to.config);
        cur[k] = (b - a) * eased + a;
      });
    }
    o.position = position;
    o.current = cur;
    return true;
  }

  // Draw an instance's new values. Returns whether it then has to finish.
  function draw(o) {
    var ev = EVENTS[o.eventId] || {};
    if (!mediaAllows(ev.mediaQueries)) return false;
    if (!(o.continuous || o.active || o.complete)) return false;
    if (o.current || (o.kind === "general" && o.complete)) {
      if (o.current) {
        var vals = {};
        for (var k in o.current) if (o.current[k] != null && !isNaN(o.current[k])) vals[k] = o.current[k];
        mergeState(o.element, o.actionItem.actionTypeId, vals, o.actionItem);
      }
      if (o.element.nodeType === 1) render(o.element, o.actionItem);
    }
    return o.complete;
  }
  // A finished instance hands over to the next group (if it carries the timing).
  function finish(o) {
    if (instances.indexOf(o) === -1) return;
    if (o.isCarrier) {
      startGroup({ eventId: o.eventId, eventTarget: o.eventTarget, eventStateKey: o.eventStateKey, actionListId: o.actionListId, groupIndex: o.groupIndex + 1 });
    }
    remove(o);
  }
  function changed(o) { if (draw(o)) finish(o); }

  // Every changed value is drawn before any next group starts, so a group
  // that follows starts from what every element of this one ended on.
  function frame(now) {
    tick = now;
    advanceLoadClock(now);
    var list = instances.slice(), done = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (instances.indexOf(o) === -1) continue;
      if ((o.continuous ? stepContinuous(o) : stepTimed(o, now)) && draw(o)) done.push(o);
    }
    done.forEach(finish);
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------ action lists -- */

  var isQuickEffect = function (type) { return /_EFFECT$/.test(type || ""); };

  function carrierIndex(items) {
    var max = 0, at = 0;
    items.forEach(function (it, i) {
      var total = it.config.delay + it.config.duration;
      if (total >= max) { max = total; at = i; }
    });
    return at;
  }

  function startGroup(o) {
    var ev = EVENTS[o.eventId] || {};
    var list = LISTS[o.actionListId] || {};
    var groups = list.actionItemGroups;
    if (!groups || !groups.length) return false;
    var index = o.groupIndex || 0;
    if (index >= groups.length && ev.config && ev.config.loop) index = 0;
    if (index === 0 && list.useFirstGroupAsInitialState) index++;
    var first = index === 0 || (index === 1 && list.useFirstGroupAsInitialState);
    var delay = first && isQuickEffect(ev.action && ev.action.actionTypeId) ? ev.config.delay : undefined;
    var items = (groups[index] || {}).actionItems || [];
    if (!items.length || !mediaAllows(ev.mediaQueries)) return false;
    var carrier = carrierIndex(items), started = false;
    items.forEach(function (item, ai) {
      if (!item.config.target) return;
      affected(item.config, ev, o.eventTarget).forEach(function (el, ei) {
        started = true;
        create({
          element: el, actionItem: item, eventId: o.eventId, eventTarget: o.eventTarget, eventStateKey: o.eventStateKey,
          actionListId: o.actionListId, groupIndex: index, isCarrier: carrier === ai && ei === 0, instanceDelay: delay,
        });
      });
    });
    return started;
  }

  function stopGroup(o) {
    instances.slice().forEach(function (i) {
      if (i.actionListId === o.actionListId && i.eventId === o.eventId && (o.eventStateKey ? i.eventStateKey === o.eventStateKey : true)) remove(i);
    });
  }

  function renderInitialGroup(eventId, actionListId) {
    var list = LISTS[actionListId], ev = EVENTS[eventId];
    if (!list || !list.useFirstGroupAsInitialState || !mediaAllows(ev.mediaQueries)) return;
    var items = ((list.actionItemGroups || [])[0] || {}).actionItems || [];
    items.forEach(function (item) {
      var t = item.config.target;
      var config = t && t.useEventTarget === true && t.objectId == null ? { target: ev.target, targets: ev.targets } : item.config;
      affected(config, ev).forEach(function (el) {
        create({ element: el, actionItem: item, eventId: eventId, actionListId: actionListId, immediate: true });
      });
    });
  }

  function autoStopEvent(id) {
    var ev = id && EVENTS[id];
    return ev && ev.eventTypeId !== "PAGE_START" && ev.eventTypeId !== "PAGE_FINISH" ? ev : null;
  }

  function run(opts, state) {
    var ev = opts.event, c = ev.action.config;
    var stop = autoStopEvent(c.autoStopEventId);
    if (stop) {
      stopGroup({ eventId: c.autoStopEventId, eventStateKey: c.autoStopEventId + ":" + opts.eventStateKey.split(":")[1], actionListId: stop.action.config.actionListId });
    }
    stopGroup({ eventId: ev.id, eventStateKey: opts.eventStateKey, actionListId: c.actionListId });
    startGroup({ eventId: ev.id, eventTarget: opts.element, eventStateKey: opts.eventStateKey, actionListId: c.actionListId });
    return state;
  }

  /* ------------------------------------------------------------ events -- */

  function viewport() {
    var d = doc.documentElement;
    return {
      scrollTop: window.pageYOffset, scrollLeft: window.pageXOffset,
      stiffScrollTop: Math.min(Math.max(window.pageYOffset, 0), d.scrollHeight - window.innerHeight),
      scrollWidth: d.scrollWidth, scrollHeight: d.scrollHeight, clientWidth: d.clientWidth, clientHeight: d.clientHeight,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    };
  }
  var isOrContains = function (o) { return o.element === o.nativeEvent.target || (o.element.contains && o.element.contains(o.nativeEvent.target)); };
  var isElement = function (o) { return o.element === o.nativeEvent.target; };
  function filtered(test, handler) { return function (o, s) { return test(o) ? handler(o, s) : s; }; }

  function hovered(o) {
    var e = o.nativeEvent, has = o.element.contains(e.target);
    if (e.type === "mouseover" && has) return true;
    return e.type === "mouseout" && has && o.element.contains(e.relatedTarget);
  }
  function onHoverChange(handler) {
    return function (o, old) {
      var s = { elementHovered: hovered(o) };
      if (old ? s.elementHovered !== old.elementHovered : s.elementHovered) return handler(o, s) || s;
      return s;
    };
  }
  function visible(o) {
    var v = viewport(), c = o.event.config;
    var pad = c.scrollOffsetUnit === "PX" ? c.scrollOffsetValue : v.clientHeight * (c.scrollOffsetValue || 0) / 100;
    var r = o.element.getBoundingClientRect();
    return !(r.left > v.clientWidth || r.right < 0 || r.top > v.clientHeight - pad || r.bottom < pad);
  }
  function onVisibilityChange(handler) {
    return function (o, old) {
      var s = {}, k;
      for (k in old) s[k] = old[k];
      s.elementVisible = visible(o);
      if (old ? s.elementVisible !== old.elementVisible : s.elementVisible) return handler(o, s) || s;
      return s;
    };
  }
  function onScrollDirectionChange(handler) {
    return function (o, old) {
      old = old || {};
      var v = viewport(), c = o.event.config;
      var bounds = v.scrollHeight - v.innerHeight;
      var percentTop = Number((v.stiffScrollTop / bounds).toFixed(2));
      if (old.percentTop === percentTop) return old;
      var pad = (c.scrollOffsetUnit === "PX" ? c.scrollOffsetValue : v.innerHeight * (c.scrollOffsetValue || 0) / 100) / bounds;
      var down, flipped, anchor = 0;
      if (old) {
        down = percentTop > old.percentTop;
        flipped = old.scrollingDown !== down;
        anchor = flipped ? percentTop : old.anchorTop;
      }
      var inBounds = o.event.eventTypeId === "PAGE_SCROLL_DOWN" ? percentTop >= anchor + pad : percentTop <= anchor - pad;
      var s = {}, k;
      for (k in old) s[k] = old[k];
      s.percentTop = percentTop; s.inBounds = inBounds; s.anchorTop = anchor; s.scrollingDown = down;
      if (old && inBounds && (flipped || s.inBounds !== old.inBounds)) return handler(o, s) || s;
      return s;
    };
  }
  function onClickCount(handler) {
    return function (o, old) {
      old = old || { clickCount: 0 };
      var s = { clickCount: (old.clickCount % 2) + 1 };
      return s.clickCount !== old.clickCount ? handler(o, s) || s : s;
    };
  }
  function namespaced(key, id) { return key + ":" + id; }

  var SCROLL_TYPES = [
    { target: window, types: "resize orientationchange", throttle: true },
    { target: doc, types: "scroll wheel readystatechange IX2_PAGE_UPDATE", throttle: true },
  ];
  var scrollIntoOutOfView = {
    types: SCROLL_TYPES,
    handler: onVisibilityChange(function (o, s) {
      var ev = o.event;
      if (!EVENTS[ev.action.config.autoStopEventId] && s.triggered) return s;
      if ((ev.eventTypeId === "SCROLL_INTO_VIEW") === s.elementVisible) {
        run(o);
        s.triggered = true;
      }
      return s;
    }),
  };
  function directional(down) {
    return { types: SCROLL_TYPES, handler: onScrollDirectionChange(function (o, s) { if (!!s.scrollingDown === down) run(o); return s; }) };
  }

  var LOGIC = {
    MOUSE_CLICK: {
      types: "click",
      handler: filtered(isOrContains, onClickCount(function (o, s) {
        if (autoStopEvent(o.event.action.config.autoStopEventId)) { if (s.clickCount === 1) run(o); } else run(o);
        return s;
      })),
    },
    MOUSE_SECOND_CLICK: {
      types: "click",
      handler: filtered(isOrContains, onClickCount(function (o, s) { if (s.clickCount === 2) run(o); return s; })),
    },
    MOUSE_DOWN: { types: "mousedown", handler: filtered(isOrContains, run) },
    MOUSE_UP: { types: "mouseup", handler: filtered(isOrContains, run) },
    MOUSE_OVER: { types: "mouseover mouseout", handler: filtered(isOrContains, onHoverChange(function (o, s) { if (s.elementHovered) run(o); return s; })) },
    MOUSE_OUT: { types: "mouseover mouseout", handler: filtered(isOrContains, onHoverChange(function (o, s) { if (!s.elementHovered) run(o); return s; })) },
    MOUSE_MOVE: {
      types: "mousemove mouseout scroll",
      handler: function (o, old) {
        old = old || { clientX: 0, clientY: 0, pageX: 0, pageY: 0 };
        var c = o.eventConfig, e = o.nativeEvent;
        var cx = e.clientX == null ? old.clientX : e.clientX, cy = e.clientY == null ? old.clientY : e.clientY;
        var px = e.pageX == null ? old.pageX : e.pageX, py = e.pageY == null ? old.pageY : e.pageY;
        var isX = c.selectedAxis === "X_AXIS", out = e.type === "mouseout";
        var value = (c.restingState || 0) / 100, id = c.continuousParameterGroupId, hover = false;
        if (c.basedOn === "VIEWPORT") {
          value = isX ? Math.min(cx, window.innerWidth) / window.innerWidth : Math.min(cy, window.innerHeight) / window.innerHeight;
        } else if (c.basedOn === "PAGE") {
          var v = viewport();
          value = isX ? Math.min(v.scrollLeft + px, v.scrollWidth) / v.scrollWidth : Math.min(v.scrollTop + py, v.scrollHeight) / v.scrollHeight;
        } else {
          id = namespaced(o.eventStateKey, id);
          var mouse = e.type.indexOf("mouse") === 0;
          var r = o.element.getBoundingClientRect();
          if (!(mouse && isOrContains(o) !== true) &&
              (mouse || (cx > r.left && cx < r.right && cy > r.top && cy < r.bottom))) {
            hover = true;
            value = isX ? (cx - r.left) / r.width : (cy - r.top) / r.height;
          }
        }
        if (out && (value > 0.95 || value < 0.05)) value = Math.round(value);
        if (c.basedOn !== "ELEMENT" || hover || hover !== old.elementHovered) params[id] = c.reverse ? 1 - value : value;
        return { elementHovered: hover, clientX: cx, clientY: cy, pageX: px, pageY: py };
      },
    },
    PAGE_SCROLL: {
      types: SCROLL_TYPES,
      handler: function (o) {
        var v = viewport(), c = o.eventConfig, value = v.scrollTop / (v.scrollHeight - v.clientHeight);
        params[c.continuousParameterGroupId] = c.reverse ? 1 - value : value;
      },
    },
    SCROLLING_IN_VIEW: {
      types: SCROLL_TYPES,
      handler: function (o, old) {
        old = old || { scrollPercent: 0 };
        var v = viewport(), c = o.eventConfig;
        if (c.basedOn === "VIEWPORT") {
          var value = c.selectedAxis === "X_AXIS" ? v.scrollLeft / v.scrollWidth : v.scrollTop / v.scrollHeight;
          if (value !== old.scrollPercent) params[c.continuousParameterGroupId] = value;
          return { scrollPercent: value };
        }
        var id = namespaced(o.eventStateKey, c.continuousParameterGroupId);
        var r = o.element.getBoundingClientRect();
        var start = (c.addStartOffset ? c.addOffsetValue || 0 : 0) / 100, end = (c.addEndOffset ? c.endOffsetValue || 0 : 0) / 100;
        start = c.startsEntering ? start : 1 - start;
        end = c.startsExiting ? end : 1 - end;
        var top = r.top + Math.min(r.height * start, v.clientHeight);
        var bottom = r.top + r.height * end;
        var height = Math.min(v.clientHeight + (bottom - top), v.scrollHeight);
        var perc = Math.min(Math.max(0, v.clientHeight - top), height) / height;
        // progressScale (data): keeps a page-long parallax moving as designed
        // when the page has grown taller than the original layout.
        if (c.progressScale) perc = Math.min(1, perc * c.progressScale);
        if (perc !== old.scrollPercent) params[id] = perc;
        return { scrollPercent: perc };
      },
    },
    SCROLL_INTO_VIEW: scrollIntoOutOfView,
    SCROLL_OUT_OF_VIEW: scrollIntoOutOfView,
    PAGE_SCROLL_DOWN: directional(true),
    PAGE_SCROLL_UP: directional(false),
    PAGE_START: {
      types: "readystatechange IX2_PAGE_UPDATE",
      handler: filtered(isElement, function (o, old) { if (!old) run(o); return { started: true }; }),
    },
    PAGE_FINISH: {
      types: "readystatechange IX2_PAGE_UPDATE",
      handler: filtered(isElement, function (o, old) {
        var done = doc.readyState === "complete";
        if (done && !(old && old.finished)) run(o);
        return { finished: done };
      }),
    },
  };

  function throttle(fn, wait) {
    var last = 0, timer = null, pending;
    return function (e) {
      var now = Date.now(), left = wait - (now - last);
      pending = e;
      if (left <= 0 || left > wait) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        fn(e);
      } else if (!timer) {
        timer = setTimeout(function () { last = Date.now(); timer = null; fn(pending); }, left);
      }
    };
  }

  function sameState(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return a[k] === b[k]; });
  }

  function stringifyTarget(t) {
    if (typeof t === "string") return t;
    return (t.id || "") + "|" + (t.selector || "") + "|" + (t.useEventTarget || "");
  }

  function continuousInstances(ev, element, eventStateKey, eventConfig, group) {
    var smoothing = (eventConfig.smoothing || 0) / 100;
    var resting = (eventConfig.restingState || 0) / 100;
    var parameterId = group.id;
    var basedOn = eventConfig.basedOn;
    if ((ev.eventTypeId === "SCROLLING_IN_VIEW" && (basedOn === "ELEMENT" || basedOn == null)) ||
        (ev.eventTypeId === "MOUSE_MOVE" && basedOn === "ELEMENT")) parameterId = namespaced(eventStateKey, parameterId);
    var byKey = {}, seen = {}, targets = [];
    group.continuousActionGroups.forEach(function (ag) {
      ag.actionItems.forEach(function (item) {
        var t = item.config.target;
        if (!t) return;
        var key = stringifyTarget(t) + ":" + item.actionTypeId;
        var groups = byKey[key] || (byKey[key] = []);
        var g = groups.filter(function (x) { return x.keyframe === ag.keyframe; })[0];
        if (!g) groups.push((g = { keyframe: ag.keyframe, actionItems: [] }));
        g.actionItems.push(item);
        if (!seen[key]) {
          seen[key] = true;
          affected(item.config, ev, element).forEach(function (el) { targets.push({ el: el, key: key }); });
        }
      });
    });
    targets.forEach(function (t) {
      var groups = byKey[t.key], item = groups[0].actionItems[0];
      if (kind(item.actionTypeId) === "plugin") return;
      create({
        element: t.el, actionItem: item, eventId: ev.id, actionListId: ev.action.config.actionListId, continuous: true,
        parameterId: parameterId, actionGroups: groups, smoothing: smoothing, restingValue: resting,
      });
    });
  }

  var listeners = [];
  var definedMedia = false;

  function bindType(type, events) {
    var logic = LOGIC[type];
    if (!logic) return;
    var targets = {};
    events.forEach(function (ev) {
      var els = affected({ target: ev.target, targets: ev.targets });
      if (els.length) targets[ev.id] = els;
    });
    Object.keys(targets).forEach(function (id) {
      var ev = EVENTS[id], c = ev.action.config, mq = ev.mediaQueries || MEDIA_KEYS;
      if (mq.slice().sort().join() !== MEDIA_KEYS.slice().sort().join()) definedMedia = true;
      if (ev.action.actionTypeId === "GENERAL_CONTINUOUS_ACTION") {
        var configs = Array.isArray(ev.config) ? ev.config : [ev.config];
        var groups = (LISTS[c.actionListId] || {}).continuousParameterGroups || [];
        configs.forEach(function (cfg) {
          var group = groups.filter(function (g) { return g.id === cfg.continuousParameterGroupId; })[0];
          if (!group) return;
          targets[id].forEach(function (el, i) { continuousInstances(ev, el, id + ":" + i, cfg, group); });
        });
      }
      if (ev.action.actionTypeId === "GENERAL_START_ACTION" || isQuickEffect(ev.action.actionTypeId)) renderInitialGroup(id, c.actionListId);
    });
    if (!Object.keys(targets).length) return;

    function handle(nativeEvent) {
      Object.keys(targets).forEach(function (id) {
        var ev = EVENTS[id];
        targets[id].forEach(function (element, i) {
          var key = id + ":" + i;
          if (!mediaAllows(ev.mediaQueries)) return;
          var old = eventState[key]; // every config of the event sees the state from before it
          var withConfig = function (eventConfig) {
            var next = logic.handler({ element: element, event: ev, eventConfig: eventConfig || {}, nativeEvent: nativeEvent, eventStateKey: key }, old);
            if (!sameState(next, old)) eventState[key] = next;
          };
          if (ev.action.actionTypeId === "GENERAL_CONTINUOUS_ACTION") (Array.isArray(ev.config) ? ev.config : [ev.config]).forEach(withConfig);
          else withConfig();
        });
      });
    }
    var throttled = throttle(handle, 12);
    var add = function (spec) {
      spec.types.split(" ").forEach(function (t) {
        var fn = spec.throttle ? throttled : handle;
        var target = spec.target || doc;
        target.addEventListener(t, fn);
        listeners.push([target, t, fn]);
      });
    };
    if (Array.isArray(logic.types)) logic.types.forEach(add);
    else add({ types: logic.types });
  }

  function updateMedia() {
    var w = window.innerWidth, key = null;
    for (var i = 0; i < MEDIA.length; i++) if (w >= MEDIA[i].min && w <= MEDIA[i].max) { key = MEDIA[i].key; break; }
    var was = mediaKey;
    mediaKey = key;
    return was !== key;
  }

  function start() {
    updateMedia();
    var byType = {};
    Object.keys(EVENTS).forEach(function (id) {
      var ev = EVENTS[id];
      (byType[ev.eventTypeId] || (byType[ev.eventTypeId] = [])).push(ev);
    });
    Object.keys(byType).forEach(function (t) { bindType(t, byType[t]); });
    if (root.className.indexOf("w-mod-ix") === -1) root.className += " w-mod-ix";
  }

  function stop() {
    listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
    listeners = [];
    instances = [];
    params = {};
    eventState = {};
    refs = new WeakMap();
  }

  // Changing breakpoint starts over from each animation's initial state.
  function clearStyles() {
    Object.keys(LISTS).forEach(function (id) {
      var list = LISTS[id];
      var groups = (list.actionItemGroups || []).concat.apply(list.actionItemGroups || [],
        (list.continuousParameterGroups || []).map(function (p) { return p.continuousActionGroups; }));
      groups.forEach(function (g) {
        (g.actionItems || []).forEach(function (item) {
          var t = item.config.target;
          if (!t) return;
          var els = t.useEventTarget ? all(selectorOf(t)) : affected(item.config);
          els.forEach(function (el) {
            if (!el.style) return;
            propsOf(item.actionTypeId).forEach(function (p) {
              removeWillChange(el, p);
              el.style[p] = "";
              if (p === "transform") el.style.transformStyle = "";
            });
          });
        });
      });
    });
  }
  window.addEventListener("resize", function () {
    var before = mediaKey;
    updateMedia();
    if (definedMedia && before !== mediaKey) {
      stop();
      clearStyles();
      start();
      doc.dispatchEvent(new CustomEvent("IX2_PAGE_UPDATE"));
    }
  });

  function boot(activated) {
    setupLoadClock();
    start();
    requestAnimationFrame(frame);
    // Started after the page was parsed: run the page-load and in-view checks now.
    var update = function () { doc.dispatchEvent(new CustomEvent("IX2_PAGE_UPDATE")); };
    if (doc.readyState !== "loading") activated ? update() : setTimeout(update, 0);
  }
  // A page built ahead of a click (Instant links) animates once it is shown.
  if (doc.prerendering) doc.addEventListener("prerenderingchange", function () { boot(true); }, { once: true });
  else boot(false);
})();
