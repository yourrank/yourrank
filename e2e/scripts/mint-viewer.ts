// Local-only helper: mints a yr_viewer session directly in Postgres, because the
// real flow requires Kick/Telegram OAuth which cannot run headless.
// Prints the RAW token to stdout for use as E2E_VIEWER_SESSION.
import { SQL } from "bun";

const sql = new SQL(process.env.E2E_DB_URL!);

const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
const hashed = Array.from(new Uint8Array(digest))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const kickId = `e2e-kick-${Date.now()}`;
const username = `e2eviewer${Date.now()}`;
const [viewer] = await sql`
  insert into viewers (kick_user_id, kick_username, avatar_url)
  values (${kickId}, ${username}, null)
  returning id`;

await sql`
  insert into viewer_sessions (token, viewer_id, expires_at)
  values (${hashed}, ${viewer.id}, now() + interval '2 hours')`;

console.log(JSON.stringify({ rawToken: raw, viewerId: viewer.id, username }));

// Point MINT_VIEWER_ENV_FILE at $GITHUB_ENV (or any env file) to have the three
// variables the gate reads appended, instead of parsing the JSON in shell.
const envFile = process.env.MINT_VIEWER_ENV_FILE;
if (envFile) {
  await Bun.write(
    envFile,
    (await Bun.file(envFile).exists() ? await Bun.file(envFile).text() : "") +
      `E2E_VIEWER_SESSION=${raw}\nE2E_VIEWER_ID=${viewer.id}\nE2E_VIEWER_USERNAME=${username}\n`
  );
}
await sql.end();
