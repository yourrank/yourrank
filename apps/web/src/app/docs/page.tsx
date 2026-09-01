import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { MarketingShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "Docs — YourRank",
  description: "YourRank guides and API documentation: quickstart, OBS overlay setup, Kick rewards, custom domains, public endpoints, and chat bot commands.",
  alternates: { canonical: "https://yourrank.site/docs" },
};

const TOC = [
  { href: "#quickstart", label: "Quickstart" },
  { href: "#obs-setup", label: "OBS overlay setup" },
  { href: "#kick-rewards", label: "Kick rewards" },
  { href: "#custom-domain", label: "Custom domain" },
  { href: "#api", label: "API reference" },
  { href: "#chat-bots", label: "Chat bots" },
  { href: "#openapi", label: "OpenAPI" },
];

function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-[2px] border border-devin-line bg-devin-ink p-4 text-[13px] leading-relaxed text-white">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-devin-line py-12 first:border-t-0 first:pt-4">
      <h2 className="text-2xl font-medium tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

const P = "mt-4 max-w-2xl leading-relaxed text-devin-ink-soft";
const IC = "rounded-[2px] bg-devin-secondary px-1.5 py-0.5 font-mono text-[13px] text-devin-ink";

export default function DocsPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <section className="px-6 pb-8 pt-32 sm:pt-40">
          <div className="mx-auto max-w-4xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-devin-primary">Docs</p>
            <h1 className="mt-4 text-[clamp(2.5rem,6vw,4rem)] font-medium leading-[1.02] tracking-[-0.03em]">
              Guides &amp; API reference.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-devin-ink-soft">
              Everything to go from a blank page to a live community — plus the public API for overlays, bots, and your own apps.
            </p>
            <nav aria-label="Documentation sections" className="mt-8 flex flex-wrap gap-2">
              {TOC.map((item) => (
                <a key={item.href} href={item.href} className="rounded-full border border-devin-line px-3.5 py-1.5 text-sm text-devin-ink-soft transition-colors hover:border-devin-ink/40 hover:text-devin-ink">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </section>

        <div className="px-6 pb-24">
          <div className="mx-auto max-w-4xl">
            <Section id="quickstart" title="Quickstart — blank page to published site">
              <ol className="mt-6 grid gap-6">
                <li className="grid gap-2 sm:grid-cols-[60px_1fr]">
                  <span className="font-mono text-xs text-devin-ink-soft">01</span>
                  <div>
                    <h3 className="font-medium">Create your account and page</h3>
                    <p className={P}>Sign up free, pick a public handle, and your site exists at <span className={IC}>yourrank.site/&#123;your-handle&#125;</span>.</p>
                  </div>
                </li>
                <li className="grid gap-2 sm:grid-cols-[60px_1fr]">
                  <span className="font-mono text-xs text-devin-ink-soft">02</span>
                  <div>
                    <h3 className="font-medium">Set up your leaderboard</h3>
                    <p className={P}>In the dashboard editor, add your challenge details, prize breakdown, and players — or import them from CSV on a paid plan. Choose which launch sections your site shows: home, leaderboard, rewards, and viewer access.</p>
                  </div>
                </li>
                <li className="grid gap-2 sm:grid-cols-[60px_1fr]">
                  <span className="font-mono text-xs text-devin-ink-soft">03</span>
                  <div>
                    <h3 className="font-medium">Publish and share</h3>
                    <p className={P}>Publish, share the link with your community, and put the overlay on stream. Scores you update in the dashboard appear everywhere at once.</p>
                  </div>
                </li>
              </ol>
            </Section>

            <Section id="obs-setup" title="OBS overlay setup">
              <p className={P}>The overlay is a browser source (Pro and Team plans). In OBS Studio or Streamlabs:</p>
              <ol className="mt-4 max-w-2xl list-decimal space-y-2 pl-5 leading-relaxed text-devin-ink-soft">
                <li>Add a source &rarr; <b className="font-medium text-devin-ink">Browser</b>.</li>
                <li>Set the URL to your overlay address: <span className={IC}>https://yourrank.site/&#123;your-handle&#125;/overlay</span>.</li>
                <li>Pick a layout with the <span className={IC}>?layout=</span> parameter: <span className={IC}>card</span> (default), <span className={IC}>ticker</span>, or <span className={IC}>bar</span>.</li>
                <li>Size the source to fit your scene — the background is transparent and it updates itself.</li>
              </ol>
              <Code>{`https://yourrank.site/demo/overlay?layout=ticker`}</Code>
              <p className={P}>Try it now with the demo board: the URL above works without an account.</p>
            </Section>

            <Section id="kick-rewards" title="Kick rewards — credits from channel points">
              <p className={P}>Connect your Kick channel from the dashboard&apos;s Rewards section, then create credit rules that map your Kick channel-point rewards to site credits. When a viewer redeems one of those rewards on Kick, YourRank credits them automatically — no manual tallying.</p>
              <p className={P}>Viewers sign in to your site with Kick or Discord, watch their balance at <span className={IC}>/me</span>, and spend credits in your shop. You track and check off redemptions in the fulfilment ledger.</p>
            </Section>

            <Section id="custom-domain" title="Custom domain">
              <p className={P}>Pro and Team plans can serve the site from your own domain (for example <span className={IC}>leaderboard.yourstream.com</span>):</p>
              <ol className="mt-4 max-w-2xl list-decimal space-y-2 pl-5 leading-relaxed text-devin-ink-soft">
                <li>Add your domain in the dashboard&apos;s site settings.</li>
                <li>At your DNS provider (Cloudflare, Namecheap, etc.), create a <span className={IC}>CNAME</span> record pointing your subdomain at the target shown in the dashboard.</li>
                <li>Wait for DNS to propagate; the dashboard shows when the domain is verified and live.</li>
              </ol>
            </Section>

            <Section id="api" title="API reference — read-only endpoints">
              <p className={P}>Public read endpoints require no authentication. Replace <span className={IC}>&#123;slug&#125;</span> with the board&apos;s public handle. Base URL: <span className={IC}>https://yourrank.site</span>.</p>
              <div className="mt-6 overflow-x-auto rounded-[2px] border border-devin-line" role="region" aria-label="API endpoints" tabIndex={0}>
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-devin-line bg-devin-secondary/25 text-left">
                      <th scope="col" className="px-4 py-3 font-medium">Method</th>
                      <th scope="col" className="px-4 py-3 font-medium">Path</th>
                      <th scope="col" className="px-4 py-3 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["GET", "/api/public/{slug}", "Full leaderboard data object."],
                      ["GET", "/api/public/{slug}/standings", "Sorted player standings with positions and countdown."],
                      ["GET", "/api/public/{slug}/players", "Lightweight sorted player array."],
                      ["GET", "/api/public/{slug}/rank?user=PLAYER", "Plain-text rank lookup for chat bots."],
                      ["GET", "/api/public/{slug}/stats", "Views, copies, clicks, and a 14-day series."],
                    ].map(([method, path, description]) => (
                      <tr key={path} className="border-b border-devin-line last:border-b-0">
                        <td className="px-4 py-3 font-mono text-xs">{method}</td>
                        <td className="px-4 py-3 font-mono text-xs">{path}</td>
                        <td className="px-4 py-3 text-devin-ink-soft">{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="mt-8 font-medium">JavaScript</h3>
              <Code>{`const res = await fetch("https://yourrank.site/api/public/demo/standings");
const data = await res.json();
console.log(data.players[0].name);`}</Code>
            </Section>

            <Section id="chat-bots" title="Chat bot commands">
              <p className={P}><b className="font-medium text-devin-ink">Nightbot</b> rank lookup:</p>
              <Code>{`!rank $(customapi https://yourrank.site/api/public/demo/rank?user=Alex)`}</Code>
              <p className={P}><b className="font-medium text-devin-ink">Streamlabs</b> rank lookup:</p>
              <Code>{`!rank $(readapi https://yourrank.site/api/public/demo/rank?user=Alex)`}</Code>
            </Section>

            <Section id="openapi" title="OpenAPI spec">
              <p className={P}>Download the machine-readable spec at <a href="/api/openapi.json" className="text-devin-ink underline underline-offset-4 hover:text-devin-primary">/api/openapi.json</a>.</p>
            </Section>
          </div>
        </div>
      </MarketingShell>
    </MagneticCursor>
  );
}
