/*
 * Contact form: send in place through the configured form service.
 *
 * Loaded only when a service is set in the CMS (Settings > Contact form); the
 * build points the form at the service and adds its hidden fields. This sends
 * the form with fetch and shows Webflow's own success and error blocks, so the
 * visitor stays on the page exactly as they did on Webflow.
 *
 * Webflow's webflow.js would otherwise try to post the form to Webflow's
 * servers, so submission is caught in the capture phase, before it can.
 */
(function () {
  "use strict";

  function wrapperOf(form) {
    return form.closest(".w-form") || form.parentElement;
  }

  function show(form, state) {
    var w = wrapperOf(form);
    var done = w.querySelector(".w-form-done");
    var fail = w.querySelector(".w-form-fail");
    if (state === "done") {
      form.style.display = "none";
      if (done) { done.style.display = "block"; done.setAttribute("tabindex", "-1"); done.focus(); }
      if (fail) fail.style.display = "none";
    } else if (state === "fail") {
      if (fail) { fail.style.display = "block"; fail.setAttribute("role", "alert"); }
    } else if (fail) {
      fail.style.display = "none";
    }
  }

  function setBusy(form, busy) {
    var btn = form.querySelector('[type="submit"]');
    var label = form.querySelector(".button_link");
    if (btn) btn.disabled = busy;
    if (label) {
      if (!label.dataset.idle) label.dataset.idle = label.textContent;
      label.textContent = busy ? "Sending…" : label.dataset.idle;
    }
    form.setAttribute("aria-busy", busy ? "true" : "false");
  }

  /* Captcha: the token field each widget fills in, and how to start over. */
  var TOKEN = { hcaptcha: "h-captcha-response", turnstile: "cf-turnstile-response" };

  function captchaNote(form, text) {
    var box = form.querySelector(".cms-captcha");
    if (!box) return;
    var note = box.querySelector(".cms-captcha-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "cms-captcha-note";
      note.setAttribute("role", "alert");
      note.style.cssText = "margin-top:8px;font-size:14px;line-height:1.4";
      box.appendChild(note);
    }
    note.textContent = text;
    note.hidden = !text;
  }

  function resetCaptcha(form) {
    var type = form.getAttribute("data-captcha");
    try {
      if (type === "hcaptcha" && window.hcaptcha) window.hcaptcha.reset();
      if (type === "turnstile" && window.turnstile) window.turnstile.reset();
    } catch (err) { /* widget gone */ }
  }

  /** Resolves with the reCAPTCHA v3 token (invisible: no widget to solve). */
  function recaptchaToken(form) {
    var key = form.getAttribute("data-captcha-key");
    return new Promise(function (resolve, reject) {
      if (!window.grecaptcha || !key) return reject(new Error("reCAPTCHA did not load"));
      window.grecaptcha.ready(function () {
        window.grecaptcha.execute(key, { action: "contact" }).then(resolve, reject);
      });
    });
  }

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches("form[data-form-service]")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (form.getAttribute("aria-busy") === "true") return;
    if (form.reportValidity && !form.reportValidity()) return;

    var data = new FormData(form);
    var service = form.getAttribute("data-form-service");
    var email = data.get("Email");
    // Lets "reply" in your mail client answer the sender directly.
    if (email) {
      if (service === "formspree") data.append("_replyto", email);
      if (service === "web3forms") data.append("email", email);
    }

    // A visible captcha must be solved before anything is sent.
    var captcha = form.getAttribute("data-captcha");
    if (TOKEN[captcha] && !data.get(TOKEN[captcha])) {
      captchaNote(form, "Please confirm you're not a robot.");
      return;
    }
    captchaNote(form, "");

    show(form, "reset");
    setBusy(form, true);
    (captcha === "recaptcha"
      ? recaptchaToken(form).then(function (token) { data.append("recaptcha_response", token); })
      : Promise.resolve())
      .then(function () {
        return fetch(form.action, { method: "POST", body: data, headers: { Accept: "application/json" } });
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.success === false) throw new Error(body.message || res.status);
        });
      })
      .then(function () {
        form.reset();
        show(form, "done");
        // For Google Tag Manager: a conversion trigger on this event.
        (window.dataLayer = window.dataLayer || []).push({ event: "contact_form_submit", form_service: service });
      })
      .catch(function () { show(form, "fail"); })
      .then(function () { resetCaptcha(form); setBusy(form, false); });
  }, true);
})();
