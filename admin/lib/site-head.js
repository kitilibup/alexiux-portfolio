/**
 * Site-wide head and body code from Settings: favicon, webclip, Google Tag
 * Manager, Google Analytics, Yandex Metrika, verification tags, Finsweet,
 * the Awwwards badge and custom code.
 *
 * These used to be pasted into every page's captured <head>. They now live
 * once in content/settings/site.json and are emitted on every page:
 *   siteHead()   where <!--cms:site-head--> sits in each head
 *   bodyStart()  right after <body>
 *   bodyEnd()    right before </body>
 *
 * IDs are validated before they're put into script, so a typo in the CMS can't
 * break out of a string - and can't inject markup.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const ID_PATTERNS = {
  gtmId: /^GTM-[A-Z0-9]{4,12}$/,
  ga4Id: /^G-[A-Z0-9]{4,16}$/,
  yandexId: /^\d{5,12}$/,
  pinterestVerification: /^[a-f0-9]{16,64}$/i,
};

const valid = (key, v) => ID_PATTERNS[key].test(String(v || "").trim());
const id = (key, v) => (valid(key, v) ? String(v).trim() : "");

export const MARKER = "<!--cms:site-head-->";

/* Smooth scrolling (Lenis, self-hosted) and the scrollbar's look. */
export const LENIS_SRC = "/assets/js/lenis-1.1.13.min.js";
const LENIS_LERP = { subtle: 0.16, medium: 0.1, strong: 0.07 };
const LENIS_CSS = "html.lenis,html.lenis body{height:auto}.lenis.lenis-smooth{scroll-behavior:auto!important}.lenis.lenis-smooth [data-lenis-prevent]{overscroll-behavior:contain}.lenis.lenis-stopped{overflow:hidden}.lenis.lenis-smooth iframe{pointer-events:none}";
// The scrollbar's space stays reserved when the page is locked (the open
// menu sets overflow: hidden), so nothing shifts sideways.
const GUTTER = "html{scrollbar-gutter:stable}";
const SCROLLBAR_CSS = {
  // Chrome and Safari draw a 4px thumb; Firefox gets its own thin scrollbar.
  // Standard properties only: Chrome ignores the reserved gutter for custom
  // ::-webkit-scrollbar styling, which made the page shift when the menu opened.
  thin: "html{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.3) transparent}" + GUTTER,
  hidden: "html{scrollbar-width:none}::-webkit-scrollbar{display:none}",
  default: GUTTER,
};
/* Seamless navigation: the browser cross-fades between pages (View
   Transitions; browsers without it simply navigate), and links are fetched
   ahead when the pointer rests on them (Speculation Rules, prefetch only -
   nothing runs, so analytics never count a page nobody opened). */
const TRANSITION_MS = { fade: 300, slow: 500 };
const transitionCss = (g) => {
  const ms = TRANSITION_MS[g.pageTransition];
  return ms ? `@view-transition{navigation:auto}::view-transition-old(root),::view-transition-new(root){animation-duration:${ms}ms}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}` : "";
};
/* Instant links: a page is built ahead in the background (images and all)
   when the pointer rests on its link or presses it, so it appears complete
   on click (Chrome, Edge; other browsers just open it). Analytics and the
   site's animations wait until the page is actually shown (whenShown). */
const PREFETCH = '<script type="speculationrules">{"prerender":[{"source":"document","where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/admin/*"}},{"not":{"selector_matches":"[target=_blank]"}}]},"eagerness":"moderate"}]}</script>';
/** Runs f once the page is shown: at once, or when a page built ahead is opened. */
const WHEN_SHOWN = "(function(f){document.prerendering?document.addEventListener('prerenderingchange',f,{once:true}):f()})";
/* Preloader once per visit: the first page load of a visit records it
   (sessionStorage, gone when the tab closes); a page with a preloader opened
   later in the visit hides it before anything is drawn and shows what the
   preloader's end would have revealed. Only applies where a .preloader exists. */
const SKIP = "html.cms-skip-intro:has(.preloader)";
const PRELOADER_ONCE = '<script>try{if(sessionStorage.getItem("site:loaded"))document.documentElement.classList.add("cms-skip-intro");sessionStorage.setItem("site:loaded","1")}catch(e){}</script>' +
  `<style>${SKIP} .preloader{display:none!important}${SKIP} .first-section{opacity:1!important;transform:none!important}${SKIP} .navbar-name,${SKIP} .wave-hand{opacity:1!important}</style>`;

const scrollCss = (g) => (g.smoothScroll ? LENIS_CSS : "") + (SCROLLBAR_CSS[g.scrollbar] || "") + transitionCss(g);
// Pauses while the page is locked (body overflow hidden, e.g. the open menu), as Webflow's native scrolling did.
const lenisScript = (g) => {
  if (!g.smoothScroll) return "";
  const lerp = LENIS_LERP[g.smoothScrollFeel] || LENIS_LERP.subtle;
  return `<script src="${LENIS_SRC}"></script><script>(function(){if(!window.Lenis||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))return;var l=new Lenis({lerp:${lerp},smoothWheel:true});window.lenis=l;function f(t){l.raf(t);requestAnimationFrame(f)}requestAnimationFrame(f);var b=document.body;function lock(){getComputedStyle(b).overflow==='hidden'?l.stop():l.start()}new MutationObserver(lock).observe(b,{attributes:true,attributeFilter:['style','class']})})();</script>`;
};

export function siteHead(site = {}) {
  const g = site.general || {};
  const i = site.integrations || {};
  const code = site.customCode || {};
  const out = [];

  if (g.favicon) out.push(`<link href="${esc(g.favicon)}" rel="shortcut icon" type="${/\.svg$/i.test(g.favicon) ? "image/svg+xml" : "image/x-icon"}"/>`);
  if (g.webclip) out.push(`<link href="${esc(g.webclip)}" rel="apple-touch-icon"/>`);
  if (scrollCss(g)) out.push(`<style>${scrollCss(g)}</style>`);
  out.push(SKIP_CSS);
  if (g.prefetchPages) out.push(PREFETCH);
  if (g.preloaderOnce) out.push(PRELOADER_ONCE);
  // The preloader's battery fills for at least this long (assets/js/motion.js).
  const min = Number(g.preloaderMin);
  if (min > 0) out.push(`<script>window.SITE_PRELOADER_MIN=${Math.round(Math.min(min, 10) * 1000)}</script>`);

  const gtm = id("gtmId", i.gtmId);
  if (gtm) {
    out.push(`<script>${WHEN_SHOWN}(function(){(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}')});</script>`);
  }

  // Analytics directly, unless Tag Manager is set and told to carry it.
  const ga = id("ga4Id", i.ga4Id);
  if (ga && !(gtm && i.gaViaGtm)) {
    out.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}${WHEN_SHOWN}(function(){gtag('js',new Date());gtag('config','${ga}')});</script>`);
  }

  const ym = id("yandexId", i.yandexId);
  if (ym) {
    const opts = { clickmap: i.yandexClickmap !== false, trackLinks: true, accurateTrackBounce: true, webvisor: !!i.yandexWebvisor };
    out.push(`<script>${WHEN_SHOWN}(function(){(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${ym},"init",${JSON.stringify(opts)})});</script>`,
      `<noscript><div><img src="https://mc.yandex.ru/watch/${ym}" style="position:absolute;left:-9999px" alt=""/></div></noscript>`);
  }

  const pin = id("pinterestVerification", i.pinterestVerification);
  if (pin) out.push(`<meta name="p:domain_verify" content="${pin}"/>`);

  // Finsweet Sweet Text is done by the build (sweetText below), not by
  // Finsweet's script: that one blocked the first paint on every page, then
  // rewrote all rich text and started Webflow's interactions a second time.

  if (code.head) out.push(code.head);
  return out.join("");
}

/* Skip link: the first thing a keyboard or screen-reader user reaches. Hidden
   until focused (Tab), it jumps past the navigation to the page content,
   marked by MAIN_TARGET (out of the layout, so nothing moves). */
export const SKIP_LINK = '<a class="skipLink" href="#main">Skip to content</a>';
export const MAIN_TARGET = '<div id="main" class="skip-target" tabindex="-1"></div>';
const SKIP_CSS = "<style>.skipLink{position:fixed;left:16px;top:16px;z-index:10000;padding:12px 20px;background:#101010;color:#fff;font-size:1rem;line-height:1.2;text-decoration:none;border-radius:4px;transform:translateY(-200%);transition:transform .2s}.skipLink:focus,.skipLink:focus-visible{transform:none;outline:2px solid #fff;outline-offset:2px}.skip-target{position:absolute;width:1px;height:1px;overflow:hidden;outline:none}</style>";

export function bodyStart(site = {}) {
  const i = site.integrations || {};
  const out = [SKIP_LINK];
  const gtm = id("gtmId", i.gtmId);
  if (gtm) out.push(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtm}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`);
  // The badge was in <head>, which ended the head early; it belongs in the body.
  if (i.awwwardsBadge && i.awwwardsBadgeHtml) out.push(i.awwwardsBadgeHtml);
  return out.join("");
}

/* Project pages opened from inside the site (a project card on Home or Work,
   "Next case") start at the case title row ("01 Campy. 2024") instead of the
   intro header above it. Only for a fresh link navigation from this site: a
   direct visit, a reload, Back/Forward (which restore their own position) and
   #anchors are left alone. Runs before the first paint (pagereveal), so the
   jump is never seen; DOMContentLoaded is the fallback. */
export const PROJECT_ANCHOR = '<script>(function(){try{var n=performance.getEntriesByType("navigation")[0];' +
  'if(location.hash||!n||n.type!=="navigate"||!document.referrer||new URL(document.referrer).origin!==location.origin||new URL(document.referrer).pathname===location.pathname)return}catch(e){return}' +
  'var done=0;function go(){if(done)return;var el=document.querySelector(".case-heading-container:not(a *)");if(!el)return;done=1;' +
  'var y=Math.max(0,Math.round(el.getBoundingClientRect().top+scrollY)-24);if(window.lenis)lenis.scrollTo(y,{immediate:true,force:true});else scrollTo({top:y,behavior:"instant"})}' +
  'addEventListener("pagereveal",go);document.addEventListener("DOMContentLoaded",go)})();</script>';

/**
 * Finsweet Sweet Text, as the build: <big-dot>•<big-dot> written in rich text
 * (stored escaped, &lt;big-dot&gt;) becomes <span class="big-dot">•</span>,
 * the same markup Finsweet's script produced in the browser.
 */
export const sweetText = (html) => html.replace(/&lt;([a-z][\w-]*)&gt;([\s\S]*?)&lt;\1&gt;/g, '<span class="$1">$2</span>');

/** The site's own script (assets/js/site.js): built-in fixes, on every page. */
export const SITE_JS = '<script src="/assets/js/site.js" defer=""></script>';
/* Keep files on visitors' devices (src/sw.js): registered once the page has
   loaded, never on a local preview (a port in the address) so edits show at
   once there; switched off, it removes itself and what it kept. */
export const cacheScript = (g = {}) => g.cacheAssets === false
  ? '<script id="site-cache">if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})});if(window.caches)caches.keys().then(function(k){k.forEach(function(n){if(/^site-/.test(n))caches.delete(n)})})</script>'
  : '<script id="site-cache">if("serviceWorker"in navigator&&!location.port)addEventListener("load",function(){var s=document.querySelector(\'script[src*="/assets/js/site.js"]\'),root=s?s.src.replace(/assets\\/js\\/site\\.js.*$/,""):"/";navigator.serviceWorker.register(root+"sw.js",{scope:root}).catch(function(){})})</script>';
export const bodyEnd = (site = {}) => SITE_JS + lenisScript(site.general || {}) + cacheScript(site.general || {}) + (site.customCode?.bodyEnd || "");

/** Settings problems worth showing in the CMS and the content check. */
export function validateSite(site = {}) {
  const i = site.integrations || {};
  const errors = [];
  const label = { gtmId: "Tag Manager container ID (GTM-XXXXXXX)", ga4Id: "Google Analytics ID (G-XXXXXXXXXX)", yandexId: "Yandex Metrika counter (digits)", pinterestVerification: "Pinterest code" };
  for (const k of Object.keys(ID_PATTERNS)) {
    if (i[k] && !valid(k, i[k])) errors.push(`${label[k]} doesn't look right, so it's left off the site.`);
  }
  if (i.gaViaGtm && !valid("gtmId", i.gtmId)) errors.push("Analytics is set to go through Tag Manager, but there's no valid container ID — Analytics is loaded directly instead.");
  return errors;
}
