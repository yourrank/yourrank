// Lead submission handler
import { json, bad, readJson, rateLimitHeaders, rateLimit, clientIp, uuid } from "../auth.js";
import { exec } from "@yourrank/shared/db";
import { normalizeLegacyLeadInput } from "@yourrank/shared/legacy-schema";

export async function handleLead(request, env) {
  try {
    const rl = await rateLimit(env, `lead:${clientIp(request)}`, 5, 3600);
    if (!rl.ok) return bad("Too many requests. Try again later.", 429, rateLimitHeaders(rl));
    const body = normalizeLegacyLeadInput(await readJson(request));
    if (!body) return bad("Invalid request");
    const handle = String(body.handle || "").slice(0, 120), brand = String(body.brand || "").slice(0, 60);
    const contact = String(body.contact || "").slice(0, 160), note = String(body.note || "").slice(0, 500);
    if (!handle && !contact) return bad("Tell us who you are");
    await exec("INSERT INTO leads (id,handle,brand,contact,note) VALUES ($1,$2,$3,$4,$5)", [uuid(), handle, brand, contact, note]);
    if (env.LEAD_WEBHOOK_URL) {
      // Strip Discord/Slack mention syntax so a lead submitter can't @everyone,
      // <@&role-id>, or otherwise ping the operator's server through the webhook.
      const safe = (s) => String(s ?? "").replace(/@/g, "@\u200b").replace(/</g, "<\u200b");
      try {
        await fetch(env.LEAD_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ content: `New YourRank lead: ${safe(handle)} (${safe(brand)}) — ${safe(contact)}\n${safe(note)}` }),
        });
      } catch (err) { console.error("[leadWebhook]: webhook delivery failed", err); }
    }
    return json({ ok: true }, 200, rateLimitHeaders(rl));
  } catch (e) {
    console.error("lead failed:", String(e?.message || e));
    return bad("Couldn't submit right now. Please try again.", 500);
  }
}
