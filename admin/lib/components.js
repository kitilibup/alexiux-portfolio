/**
 * Components (Webflow's symbols): markup defined once in
 * content/components/<name>.json and used by every page that names it.
 *
 *   {{=pageId}}   the page's Webflow id (forms and interactions need it)
 *
 * Shared by the build and the Designer.
 */

/** The data-wf-page id from a page's <html> open tag. */
export const pageIdOf = (htmlOpen) => (String(htmlOpen || "").match(/data-wf-page="([^"]+)"/) || [])[1] || "";

export const renderComponent = (html, vars = {}) =>
  String(html || "").replace(/\{\{=(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]).replace(/[&<>"']/g, "") : m));

/** Turn rendered markup back into the component's source. */
export const unrenderComponent = (html, vars = {}) => {
  let out = String(html);
  for (const [k, v] of Object.entries(vars)) if (v) out = out.split(`data-wf-page-id="${v}"`).join(`data-wf-page-id="{{=${k}}}"`);
  return out;
};
