/**
 * Connect the footer's contact form to a form service.
 *
 * GitHub Pages serves static files only, so the form posts to a third-party
 * endpoint instead of Webflow's servers. Which one is set in the CMS under
 * Settings (content/settings/site.json):
 *
 *   formspree   endpoint = https://formspree.io/f/<id>
 *   web3forms   accessKey = the key Web3Forms emails you
 *   custom      endpoint = any URL that accepts a form POST and answers 2xx
 *   none        the form stays disabled, with a note pointing to email/WhatsApp
 *
 * The markup Webflow published is kept; this only switches the form on, points
 * it at the service, adds the service's hidden fields, a spam honeypot and the
 * chosen captcha, and
 * loads assets/js/contact-form.js, which submits in place and shows Webflow's
 * own success and error states.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const WEB3FORMS = "https://api.web3forms.com/submit";

/** The resolved endpoint, or null when the form shouldn't be switched on. */
export function formTarget(cfg = {}) {
  switch (cfg.service) {
    case "formspree":
      return /^https:\/\/formspree\.io\/f\/\w+/.test(cfg.endpoint || "") ? cfg.endpoint : null;
    case "web3forms":
      return /^[\w-]{20,}$/.test(cfg.accessKey || "") ? WEB3FORMS : null;
    case "custom":
      return /^https:\/\//.test(cfg.endpoint || "") ? cfg.endpoint : null;
    default:
      return null;
  }
}

/*
 * Spam protection (captcha). Site keys are public; secret keys belong in the
 * form service's dashboard (Web3Forms verifies the token), never in the site.
 *   hcaptcha    Web3Forms' free hCaptcha: their script, no keys of your own
 *   turnstile   Cloudflare Turnstile (Web3Forms Pro, or a custom endpoint)
 *   recaptcha   Google reCAPTCHA v3, invisible (Web3Forms Pro, or custom)
 */
export const CAPTCHA_SCRIPTS = {
  hcaptcha: () => "https://web3forms.com/client/script.js",
  turnstile: () => "https://challenges.cloudflare.com/turnstile/v0/api.js",
  recaptcha: (key) => `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`,
};
const SITE_KEY = /^[\w-]{20,100}$/;

/** The captcha to use, or null (off, unsupported by the service, or no valid site key). */
export function captchaOf(cfg = {}) {
  const type = cfg.captcha;
  if (!formTarget(cfg) || !CAPTCHA_SCRIPTS[type]) return null;
  if (type === "hcaptcha") return cfg.service === "web3forms" ? { type } : null;
  if (!["web3forms", "custom"].includes(cfg.service)) return null;
  const key = String(cfg.captchaSiteKey || "").trim();
  return SITE_KEY.test(key) ? { type, key } : null;
}

const captchaWidget = (c) =>
  c.type === "hcaptcha" ? '<div class="h-captcha" data-captcha="true"></div>'
  : c.type === "turnstile" ? `<div class="cf-turnstile" data-sitekey="${esc(c.key)}" data-theme="light"></div>`
  : "";

export function connectFooterForm(footerHtml, cfg = {}) {
  const endpoint = formTarget(cfg);
  if (!endpoint || !footerHtml || !/<form\b/.test(footerHtml)) return footerHtml;

  const captcha = captchaOf(cfg);
  const hidden = [];
  if (cfg.service === "web3forms") {
    hidden.push(`<input type="hidden" name="access_key" value="${esc(cfg.accessKey)}"/>`);
    if (cfg.subject) hidden.push(`<input type="hidden" name="subject" value="${esc(cfg.subject)}"/>`);
    hidden.push(`<input type="hidden" name="from_name" value="alexiux.com"/>`);
  } else if (cfg.subject) {
    hidden.push(`<input type="hidden" name="_subject" value="${esc(cfg.subject)}"/>`);
  }
  // Bots fill every field; people never see this one. Both services discard
  // submissions where it is filled (Formspree: _gotcha, Web3Forms: botcheck).
  const trap = cfg.service === "web3forms" ? "botcheck" : "_gotcha";
  hidden.push(`<input type="checkbox" name="${trap}" tabindex="-1" autocomplete="off" aria-hidden="true" style="display:none"/>`);

  let html = footerHtml.replace(/<form\b([^>]*)>/, (tag, attrs) => {
    const a = attrs
      .replace(/\smethod="[^"]*"/, "")
      .replace(/\saction="[^"]*"/, "");
    const cap = captcha ? ` data-captcha="${captcha.type}"${captcha.type === "recaptcha" ? ` data-captcha-key="${esc(captcha.key)}"` : ""}` : "";
    return `<form${a} method="post" action="${esc(endpoint)}" data-form-service="${esc(cfg.service)}"${cap}>${hidden.join("")}`;
  });
  // The visible widget goes in the submit column, just above the button.
  const widget = captcha && captchaWidget(captcha);
  if (widget) {
    // Above the submit button's invisible click area, which covers the whole
    // wrapper (z-index), so the checkbox can be clicked.
    html = html.replace(/(<div\b[^>]*class="[^"]*\bform_submit-wrapper\b[^"]*"[^>]*>)/, `$1<div class="cms-captcha" style="position:relative;z-index:2;margin:0 0 16px">${widget}</div>`);
  }

  // Undo the migration's "not connected" state.
  html = html
    .replace(/(<input type="submit"[^>]*?)\s+disabled(?:="[^"]*")?\s+aria-disabled="true"/, "$1")
    .replace(/<div class="form-disabled-notice"[^>]*>[\s\S]*?<\/div>/, "");

  if (cfg.successMessage) {
    html = html.replace(/(<div class="w-form-done"><div>)[\s\S]*?(<\/div><\/div>)/, `$1${esc(cfg.successMessage)}$2`);
  }
  if (cfg.errorMessage) {
    html = html.replace(/(<div class="w-form-fail"><div>)[\s\S]*?(<\/div><\/div>)/, `$1${esc(cfg.errorMessage)}$2`);
  }
  return html;
}

export function connectScripts(scriptsHtml, cfg = {}) {
  if (!formTarget(cfg)) return scriptsHtml;
  const captcha = captchaOf(cfg);
  const captchaScript = captcha ? `<script src="${esc(CAPTCHA_SCRIPTS[captcha.type](captcha.key))}" async="" defer=""></script>` : "";
  return scriptsHtml + captchaScript + '<script src="/assets/js/contact-form.js" defer=""></script>';
}

/**
 * Keep what visitors type into the form out of session recordings.
 * Yandex Webvisor records keystrokes unless a field carries ym-disable-keys;
 * applied whether or not the form is switched on.
 */
export function protectFormFields(footerHtml) {
  if (!footerHtml || !/<form\b/.test(footerHtml)) return footerHtml;
  return footerHtml.replace(/<(input|textarea)\b([^>]*?)\sclass="([^"]*)"/g, (m, tag, before, cls) =>
    /(^|\s)ym-disable-keys(\s|$)/.test(cls) || /type="(submit|hidden|checkbox)"/.test(m) ? m : `<${tag}${before} class="${cls} ym-disable-keys"`);
}

