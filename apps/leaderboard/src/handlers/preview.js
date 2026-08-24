import { currentUser } from "../auth.js";
import { effectivePlan } from "@yourrank/shared/plans";
import { getUserSiteById, FONT_KEYS } from "../site.js";
import { renderSite } from "@yourrank/shared/site-render";
import { SECURE_HTML, withNonce } from "../middleware/headers.js";
import { gamesIslandHead, gamesIslandMount } from "@yourrank/shared/games-embed";
import { redirectResponse } from "../login-redirect.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function handleDashboardPreview(request, env, nonce, {
  currentUserImpl = currentUser,
  getUserSiteByIdImpl = getUserSiteById,
} = {}) {
  const url = new URL(request.url);
  const user = await currentUserImpl(request, env);
  if (!user) return redirectResponse(new URL("/login", url), 302);
  const plan = effectivePlan(user);
  const siteId = url.searchParams.get("board");
  if (!siteId) return new Response("board required", { status: 400 });
  const site = await getUserSiteByIdImpl(env, user.id, siteId, plan);
  if (!site) return new Response("not found", { status: 404 });

  const section = url.searchParams.get("section") || "home";
  const isEmbed = url.searchParams.get("embed") === "1" || url.searchParams.get("isolated") === "1";
  const accentA = url.searchParams.get("accentA");
  const accentB = url.searchParams.get("accentB");
  const font = url.searchParams.get("font");
  const device = url.searchParams.get("device") === "mobile" ? "mobile" : "desktop";
  
  let draftData = {};
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      try {
        const fd = await request.formData();
        const draft = fd.get("draft");
        if (draft) draftData = JSON.parse(String(draft));
      } catch { /* malformed form data falls back to {} */ }
    } else {
      draftData = await request.json().catch(() => ({}));
    }
  }

  const mergedData = { ...site.data, ...draftData };
  const branding = { ...mergedData.branding };
  if (plan !== "free" && HEX.test(accentA || "") && HEX.test(accentB || "")) {
    branding.accentA = accentA;
    branding.accentB = accentB;
  }
  if (plan !== "free" && FONT_KEYS.includes(font || "")) {
    branding.font = font;
  }

  if (section === "games" && isEmbed) {
    const b = mergedData.brand || site.data?.brand || {};
    const mount = gamesIslandMount({
      slug: site.slug,
      nonce,
      siteName: b.name || site.slug,
      logoUrl: null,
      creditsUrl: `/${site.slug}/credits`,
      signInUrl: `/api/viewer/auth/kick?returnTo=${encodeURIComponent(`/${site.slug}/games`)}`,
      header: false,
    });
    const embedHtml = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Mini-games preview</title>
${gamesIslandHead()}
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; background: #0c1017; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow-x: hidden; }
  .gx-embed-wrap { max-width: 100%; margin: 0 auto; padding: 12px; }
</style>
</head><body><div class="gx-embed-wrap">${mount}</div></body></html>`;
    return new Response(embedHtml, { headers: { ...withNonce(SECURE_HTML, nonce), "cache-control": "no-store" } });
  }

  const watermark = plan === "free" ? true : (mergedData.sections?.poweredBy === true);
  const previewData = { ...mergedData, branding };
  let html = await renderSite({
    r: {
      ...site,
      plan,
      data: previewData,
      viewerKickAuthEnabled: false,
      viewerDiscordAuthEnabled: false,
    },
    section,
    viewer: null,
    viewerData: null,
    opts: {
      homeUrl: url.origin,
      slug: site.slug,
      isCustomDomain: false,
      nonce,
      logoUrl: plan !== "free" && site.data.branding?.hasLogo ? `/logo/${site.slug}` : null,
      watermark,
      preview: true,
      previewDevice: device,
    },
  });

  const previewMinWidth = device === "mobile" ? 390 : 1100;
  const editableSelectors = ".yr-brand, .yr-h1, .yr-lede, .yr-hero-r .yr-big";
  html = html.replace("</head>", `<style nonce="${nonce}">
    html, body { min-width: ${previewMinWidth}px; overflow: hidden; }
    ${editableSelectors} { cursor: text; transition: outline 0.15s ease, outline-offset 0.15s ease; }
    ${editableSelectors.split(", ").map(s => s + ":hover").join(", ")} { outline: 2px dashed rgba(91,91,245,0.4); outline-offset: 3px; border-radius: 4px; }
  </style></head>`);

  if (device === "desktop") {
    html = html.replace('</body>', `<script nonce="${nonce}">
      document.addEventListener("click", (e) => {
        const targetSelectors = "${editableSelectors}";
        const el = e.target.closest(targetSelectors);
        
        if (el && !el.isContentEditable) {
          e.preventDefault();
          e.stopPropagation();
          
          const originalText = el.textContent;
          el.contentEditable = "true";
          el.focus();
          
          // Select all text
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
          
          el.style.outline = "2px solid #5b5bf5";
          el.style.outlineOffset = "2px";
          el.style.borderRadius = "4px";
          
          const finishEditing = () => {
            if (!el.isContentEditable) return;
            el.contentEditable = "false";
            el.style.outline = "";
            el.style.outlineOffset = "";
            
            const newText = el.textContent.trim();
            if (newText !== originalText) {
              let key = null;
              let extra = null;
              
              if (el.matches(".yr-brand, .yr-h1")) key = "f_name";
              else if (el.matches(".yr-lede")) key = "f_tagline";
              else if (el.matches(".yr-hero-r .yr-big")) key = "f_pool";
              
              if (key) {
                window.parent.postMessage({ type: "yr_edit_request", key, value: newText, extra }, window.location.origin);
              }
            }
          };
          
          el.addEventListener("blur", finishEditing, { once: true });
          el.addEventListener("keydown", (evt) => {
            if (evt.key === "Enter") {
              evt.preventDefault();
              finishEditing();
            } else if (evt.key === "Escape") {
              el.textContent = originalText;
              finishEditing();
            }
          });
        }
      });
      
      window.addEventListener("message", (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data?.type === "yr_preview_update" && typeof e.data?.html === "string") {
          const parser = new DOMParser();
          const newDoc = parser.parseFromString(e.data.html, "text/html");
          document.body.innerHTML = newDoc.body.innerHTML;
          // Note: any <style> changes in head can be updated here if needed,
          // but replacing body is enough for live text/player edits.
        }
      });
    </script></body>`);
  }

  return new Response(html, {
    headers: { ...withNonce(SECURE_HTML, nonce), "cache-control": "private, no-store" },
  });
}