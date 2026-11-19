/**
 * CMS configuration.
 *
 * `authWorker` points at the Cloudflare Worker that completes the GitHub OAuth
 * handshake. Until it is deployed, leave it as-is: the admin falls back to a
 * pasted personal access token, so the CMS is usable before that
 * infrastructure exists. Setup: README.md, "Deploying".
 */
export const CONFIG = {
  owner: "kitilibup",
  repo: "alexiux-site",
  branch: "main",

  // GitHub accounts allowed to sign in. GitHub's own write permission on the
  // repository is the real gate; this turns away any other account that has
  // one (a collaborator, a bot). Empty = anyone with write access.
  allowedUsers: ["kitilibup"],

  // Deployed Worker URL, e.g. "https://alexiux-cms-auth.<subdomain>.workers.dev".
  // Empty string disables the "Sign in with GitHub" button.
  authWorker: "",

  // Where uploads land. Referenced from content as /assets/uploads/<file>.
  uploadPath: "assets/uploads",

  // Loaded into the content editor so it renders with the real site styles.
  siteCss: [
    "../assets/css/fonts.css",
    "../assets/css/site.css",
  ],

  collections: ["projects", "pages", "seo", "settings"],

  // Shown as the "view site" link once a publish lands.
  siteUrl: "https://alexiux.com/",
};
