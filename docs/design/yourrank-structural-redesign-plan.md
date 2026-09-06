# YourRank structural redesign plan

Status: proposed replacement design and migration plan, based on live browser inspection on September 4–5, 2026. No product implementation or deployment is included in this document.

## Outcome

Make the creator workspace communicate what needs attention and the next valid action; make the public destination express the creator and give viewers a clear reason to participate and return; make marketing demonstrate that connected loop.

The existing interface, visual contract and component arrangement are migration evidence. The owner-approved product architecture, identity boundaries, authorization, persisted state and current route contracts remain constraints until deliberately changed. Community is a navigation grouping, not a new database entity. Viewer Account, Membership, Leaderboard Player and Telegram Subscriber remain separate identities.

## Proposed visual direction: the community broadcast

The signature is the connection between a creator's current community moment and a viewer's place in it. Use creator identity, real activity timing, rank and progress, and explicit participation states as the visual material. Avoid simulated popularity, fabricated activity, decorative charts and a generic SaaS card wall.

Three related modes share typography roles, status semantics, spacing rhythm, controls and accessible interaction behavior:

- Marketing persuades through one real creator-to-viewer sequence. Lead with a concrete outcome, one primary action and a working public example. Replace rotating words, cursor replacement, long sticky reveals and capability marquees with direct proof. Use expressive display typography selectively and actual product content with consent or clearly labeled fixtures.
- Workspace supports repeated operations. Establish a compact, calm canvas with strong text contrast, stable site context, dense lists and one actionable attention region. Use a dark operational mode suited to low-light use, with accessible light mode; color communicates state rather than making every module compete.
- Public destination foregrounds creator identity through available logo, approved imagery, accent and content. YourRank branding recedes. Structure Home around the creator, available activity, participation and a viewer's actual state. Omit unsupported modules; never invent a shared history service or identity merge to fill the composition.

The first design deliverable should show real populated, empty and blocked states in these three modes at desktop and mobile sizes. Evaluate two materially different compositions within this direction before finalizing exact typefaces and color values. The deciding criterion is task comprehension and creator specificity, not novelty alone.

## Page and journey redesign

### Creator Home and publishing

Order: site context → one attention/action region → current work → next scheduled work → compact evidence. For an unverified account, show one verification message and one recovery action; represent publishing as the subsequent unavailable step with its reason. After verification, the same region advances to review/publish. Do not repeat that obligation in a global banner, hero, CTA and checklist. Preserve server authorization and existing persistence.

The site selector owns switching and access to site management. Navigation expresses Home, Community, Activities, People, Rewards, Insights and Settings. Site and Leaderboard remain identifiable children of Community. Account-scoped Sites and Telegram operations need explicit scope-aware access and a tested transition; do not silently move account data into site scope. Keep current URLs unless a deliberate migration requires otherwise.

### Public Home, leaderboard and My Community

Lead with recognizable creator identity and the current available community moment. Show one meaningful participation action based on actual configuration. Treat leaderboard and rewards as different task surfaces: a readable standings list and a browseable reward catalog, rather than interchangeable summary cards. My Community should explain current viewer state and offer the corresponding sign-in/join action. Use only available membership and history data.

Repair the demo player path before it serves as proof in marketing. Every visible link must terminate in a real canonical route or cease to look interactive. Empty and unavailable states must preserve navigation and explain the actual missing resource.

### People, Rewards and Insights

People: one purpose-built empty state, then a real searchable list as data becomes available. Remove repeated container descriptions.

Rewards: lead with work requiring attention, then catalog and earning configuration. Onboarding presents the next prerequisite with optional remaining steps; avoid placing a checklist and empty analytics dashboard in equal prominence.

Insights: retain question-based grouping. Show useful baseline explanations when no data exists; distinguish unavailable, zero and not-yet-published data. Keep filters and time scope stable. Do not fabricate meaningful trends from empty data.

### Mobile and keyboard

Design mobile task order independently: compact header/context, a concise blocking state and the next action adjacent to relevant content. Use a reachable persistent action only when the workflow merits it. Preserve creator identity, visible tab overflow cues and appropriate touch targets. All drawers share one tested dialog implementation with background isolation, contained focus, Escape dismissal, return focus and one accessible close control. Inactive responsive branches must be absent from the accessibility tree.

## Ownership and migration sequence

| Phase | Work and owners | Exit evidence |
|---|---|---|
| 1. Baseline | Derive routes/states from shared dashboard-routes, dashboard-nav, chrome-state and public renderer; capture desktop/mobile states. | Route and state coverage matrix; live defects reproduced; preserved product/identity contracts recorded. |
| 2. Visual contract | Replace incumbent DESIGN.md direction after evaluating concrete compositions; establish token roles and component anatomy. | Three surface modes rendered with realistic content, empty and blocked states; one owner for each token and component. |
| 3. Shell + first journey | Migrate shared dashboard-chrome, Worker adapter, client navigation and Home/publish; repair demo/public Home/leaderboard through site-render. | Direct loads, SPA, fragment and Worker-document transitions agree; correct active nav/context; demo routes work; keyboard/mobile checks pass. |
| 4. Connected consumers | Migrate People, Rewards, Insights, setup, auth and public viewer states; rebuild marketing around the working journey. | Each visible route and state uses the replacement components and truthful content; no cosmetic page fork. |
| 5. Remove legacy ownership | Remove migrated Devin CSS injection and design contract; retire obsolete selectors, token bridges, marketing motion and dead consumers after proving usage. | No migrated route loads incumbent visual overrides; no live references to removed components; no parallel v2/new/final implementation. |
| 6. Verify and release preparation | Build shared output; run relevant tests and required lint/typecheck/test gates; inspect all route delivery modes and state classes in browser. | Passing critical journeys, accessible dialogs, bounded visual review, documented residual limitations and rollback plan. |

## File impact

Expected owners: DESIGN.md; apps/web/src/app and components; packages/shared/src/dashboard-chrome.ts, dashboard-chrome-state.ts, dashboard-nav.ts, page-shell.ts and site-render.ts; apps/leaderboard/src/pages/dashboard-shell.jsx and page owners; dashboard client shell; active stylesheet owners.

Deletion candidates require import/selector/route proof: devin-system.css and its injections after every consumer migrates; obsolete portions of dashboard-v4.css, app.css, ui.css and landing.css; old scoreboard-editorial rules; retired homepage cursor/scroll/marquee components. Do not delete a whole stylesheet because one page no longer uses it. Bot Worker documents and auth/legal pages are consumers of shared shell material and must be covered before shared deletion.

Maintain one public renderer and one dashboard route model. A redesign does not justify rewriting backend domains or creating parallel navigation registries. Build packages/shared after modifying its TypeScript sources.

## Acceptance gates

1. A first-time creator can identify the selected site, its publication state and the one valid next action from the initial viewport.
2. Verification/publication state appears in one dominant region; controls accurately represent prerequisites.
3. Every demo link works; player detail and missing-resource copy agree with the actual route.
4. Public Home visibly belongs to its creator and offers a real participation action when configured; no fabricated activity.
5. At 320, 390, 768 and 1440px, content reflows without document overflow, clipped identity or undiscoverable local navigation.
6. Keyboard focus stays inside modal drawers, Escape closes them, focus returns, and background/hidden controls are not exposed.
7. Loading, empty, error, success, disabled, unauthorized and partial states are covered where applicable. Test unpublished/unverified and active creator states, anonymous/member viewers and route delivery modes.
8. Migrated routes have one active visual owner; old theme injections and dead consumers are removed with evidence.
9. Required build and test checks pass. Browser verification and source inspection are reported separately.

## Boundaries and unknowns

Anonymous root/signup behavior was not fully observed because the existing browser session redirects to dashboard. No production publishing, payment, account changes or destructive actions were performed. Performance metrics, exhaustive screen-reader testing, user-study outcomes and production-to-local revision equivalence were not established. Source findings explain the inspected local implementation and are not proof of an exact deployed commit.

Games, wagers, paid chance, settlement and gambling-specific Telegram behavior remain outside this redesign. No schema, billing or identity consolidation is proposed. The existing worktree contains extensive user changes; implementation must preserve them and establish a focused change boundary before editing.
