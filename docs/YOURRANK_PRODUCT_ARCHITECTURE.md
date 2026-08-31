# YourRank Product Architecture

**Status:** FINAL owner-approved target product architecture.  
**Version:** 1.0 — post-debug canonical version.  
**Baseline reviewed:** `main` at `e71faab725f322c8aa965398aab941f9fb7a6f5d` (PR #663 merged).  
**Repository activation rule:** this document becomes the repository's canonical target-product source of truth when Wave 0 aligns the existing product/design/agent documents with it. Until that documentation-only alignment PR is merged, current runtime code, route manifests, tests, and schema remain authoritative for present behavior.  
**Scope:** Product architecture, information architecture, domain ownership, migration rules, safety boundaries, pricing direction, roadmap, success metrics, and implementation sequencing.  
**Not a replacement for:** low-level runtime/deployment architecture, database migrations, API contracts, security implementation details, or feature-specific technical design documents.

---

# 0. How to Read This Document

Every major statement belongs to one of four classes:

- **CURRENT** — verified repository/runtime reality.
- **TARGET** — final owner-approved product direction.
- **MIGRATION** — the intended path from current to target.
- **DEFERRED** — an implementation detail intentionally postponed until its prerequisite exists. Deferred items are not permission for an agent to invent a different product model.

The most important rule is:

> **Do not mistake target product architecture for current implementation reality.**

This document defines where YourRank is going. The canonical route manifest, current tests, runtime code, and schema still define how the current product works until a migration wave deliberately changes them.

---

# 1. Documentation Authority and Conflict Policy

## 1.1 The repository currently contains conflicting product truths

The current repository contains older approved framing that describes YourRank as a suite of peer products such as Sites/Leaderboards, Telegram, and Credits & Shop. The new owner-approved blueprint instead organizes the product around a creator community operating model.

This document is the final target architecture. It must not be added beside the older contradictory product documents without reconciling those documents in the same documentation-alignment wave.

## 1.2 Required Wave 0 documentation alignment

Before implementation against this architecture, update or explicitly supersede the conflicting product-framing sections in:

- `PRODUCT.md`
- `DESIGN.md`
- `docs/product-positioning.md`
- `PROJECT_TRUTH.md` / `.ai/PROJECT_TRUTH.md`
- `.ai/PROJECT_STATE.md`
- product-positioning language in `ARCHITECTURE.md`

Do **not** erase verified technical/runtime facts from those files merely because the product model changed.

## 1.3 Source-of-truth hierarchy after alignment

After Wave 0 is merged:

1. **Target product architecture:** this document.
2. **Current route truth:** `packages/shared/src/dashboard-routes.ts`.
3. **Current navigation presentation:** `packages/shared/src/dashboard-nav.ts`.
4. **Runtime/deployment architecture:** `ARCHITECTURE.md` + current Worker configuration/code.
5. **Product summary:** `PRODUCT.md`, synchronized with this document.
6. **Visual language:** `DESIGN.md`, synchronized with the target product model.
7. **Agent policy/current state:** `AGENTS.md`, `.ai/PROJECT_TRUTH.md`, `.ai/PROJECT_STATE.md`.
8. **Data/API contracts:** shared types/validators + Supabase migrations + current tests.
9. **Runtime truth:** executed tests, browser evidence, Worker behavior, production telemetry.

When sources disagree, the disagreement must be called out and resolved. Agents must not silently choose whichever document makes a task easier.

---

# 2. Product Thesis

## TARGET

> **YourRank is the community operating system for streamers.**

It gives creators one persistent workspace to run their community while giving viewers one persistent relationship and history inside each creator community.

For creators, YourRank should reduce the operational cost of:

- fragmented community tools,
- repeated manual community administration,
- participant review,
- claims and fulfillment,
- member recognition,
- moderator coordination,
- integration health,
- and understanding what matters next.

For viewers, YourRank should make it easy to:

- understand a creator's community,
- participate in safe community activities,
- know their current status,
- keep community history,
- receive recognition,
- manage legitimate claims/rewards,
- and return between streams.

The dashboard is a **creator workspace**.

The public site is a **creator destination**.

The product must not feel like a generic admin dashboard or a bag of unrelated feature modules.

---

# 3. Problems YourRank Owns

## TARGET

YourRank should primarily solve five problems.

### 3.1 Fragmented community

A creator's community is spread across streaming platforms, Discord, Telegram, bots, spreadsheets, leaderboard tools, reward tools, and chat.

**Product answer:** one persistent community layer with connected identities, activity, history, and creator-owned public presence.

### 3.2 Too much manual community work

Creators and moderators repeatedly manage entrants, events, claims, member questions, verification, rewards, and platform connections.

**Product answer:** make routine work automatic or structured so humans handle exceptions rather than every participant.

### 3.3 Participation is difficult to trust

Duplicate accounts, disposable identities, impersonation, and fragmented platform identities make community participation hard to review fairly.

**Product answer:** persistent identity context, explainable signals, history, and human review — never fake certainty.

### 3.4 Loyal viewers have weak persistent identity and recognition

A long-term viewer can look nearly identical to a brand-new account once activity is scattered across platforms.

**Product answer:** community membership, participation history, recognition, and creator-specific viewer context.

### 3.5 Community value collapses when the stream ends

Most platform experiences are optimized around the live moment.

**Product answer:** a persistent creator destination with standings, activities, rewards, history, recognition, and viewer status between streams.

---

# 4. Users

## TARGET

### 4.1 Primary customer — creator/operator

A community-heavy streamer or creator who already has enough audience activity that community operations consume meaningful time.

Their job is:

> Run the community without becoming its full-time administrator.

### 4.2 Viewer/community member

A viewer who wants to know:

- where they stand,
- what they can participate in,
- their current status,
- what they have completed,
- what they have claimed,
- and what history/recognition they have built.

Viewer accounts remain free for basic participation and identity functions.

### 4.3 Moderator/team member

A trusted operator who needs enough access to run community workflows without sharing the owner's credentials or receiving unnecessary billing/security access.

### 4.4 Later customer — community manager / agency

Larger creator organizations may eventually need multi-person operations, multiple communities, permissions, reporting, and delegation.

### 4.5 Market focus

The initial beachhead can include established casino-stream communities because fragmentation, duplicate participation, identity confusion, and manual community operations are often unusually painful there.

However:

> **YourRank's core architecture is community infrastructure, not gambling infrastructure.**

---

# 5. Product Pillars

## TARGET

### 5.1 Identity & Trust

Who is this community member, what legitimate history exists, and does anything require human review?

### 5.2 Community Home

Where does the creator's community live when viewers are not inside the streaming platform?

### 5.3 Participation & Activities

What safe community activities can the creator run and the viewer participate in?

### 5.4 Recognition & Rewards

What meaningful history, recognition, free loyalty credits, and creator rewards persist over time?

### 5.5 Community Operations

How does the creator or moderator run the community with minimal manual administration?

---

# 6. Core Product Loop

## TARGET

```text
Creator configures public community destination
        ↓
Viewer discovers creator site
        ↓
Viewer signs in / joins creator context when participation requires it
        ↓
Viewer links supported community identity where useful
        ↓
Viewer participates
        ↓
YourRank preserves participation/history
        ↓
Only ambiguous or exceptional cases go to review
        ↓
Result / status is recorded
        ↓
Applicable claim or reward workflow stays inside YourRank
        ↓
Recognition/history remains visible
        ↓
Viewer returns
        ↓
Creator repeats what works
```

The product is successful when this loop is easier than the creator's previous combination of chat, bots, spreadsheets, DMs, and disconnected tools.

---

# 7. Terminology and Domain Boundaries

This section fixes one of the largest ambiguities in the first architecture draft.

## 7.1 Account

**CURRENT/TARGET:** the creator/operator's global authenticated account.

Account-scoped concerns include:

- account identity,
- team,
- SaaS billing,
- global connections,
- data/privacy,
- and management of the creator's collection of sites.

## 7.2 Site

**CURRENT:** `site` is a real persisted product object and existing route/data scope.

**TARGET:** keep `Site` as the implementation/domain term until a deliberate schema/API migration proves a rename is worthwhile.

Do not rename tables, APIs, route parameters, or data contracts from `site` to `community` merely because the navigation says **Community**.

## 7.3 Community

**TARGET:** **Community is primarily a navigation/product grouping around the selected site's public/community-facing surfaces. It is not automatically a new database entity.**

Community contains:

- Site
- Leaderboard
- Recognition
- Communication, once the generic safe communication surface is implemented

The selected-site context remains visible in the topbar/context selector.

## 7.4 Manage Sites / Communities

**CURRENT:** `/dashboard/leaderboards` is account-scoped and manages the creator's collection of sites.

**TARGET:** keep this account-scoped management capability. It may eventually be labeled **Manage sites** or **Manage communities**, but it should normally be reached from the site selector/context control rather than consuming a permanent top-level rail item.

## 7.5 Viewer account

**CURRENT:** viewer accounts are distinct from creator accounts, leaderboard player records, and Telegram subscriber relationships. `viewers` is the global identity anchor exposed through **My communities**; supported provider connections count as linked only with persisted authentication proof.

**TARGET:** keep the viewer account as the stable global viewer identity anchor and add capabilities without collapsing adjacent identities.

## 7.6 Member

**CURRENT:** `site_viewers` is the creator/site-specific relationship between a Viewer Account and one site/community context, unique per site and viewer. Authenticated creator-site entry or a provider-signed interaction may create it; anonymous browsing does not.

**TARGET:** preserve this boundary as capabilities expand. A **member** remains the creator/site-specific relationship between a viewer identity and one selected site/community context.

Conceptually:

```text
Viewer Account
   ├─ membership in Site A
   ├─ membership in Site B
   └─ linked external identities
```

A member can accumulate creator-specific:

- join/history context,
- participation,
- recognition,
- claims,
- relevant moderation state.

## 7.7 Leaderboard Player

**CURRENT:** a leaderboard player record is not automatically the same thing as a viewer/member identity.

**TARGET:** allow explicit linkage where product evidence supports it, but do not collapse player rows and viewer accounts by assumption.

## 7.8 Telegram Subscriber

**CURRENT:** Telegram subscriber relationships are separate identities/relationships.

**TARGET:** supported linking can connect them to a viewer/member when ownership is legitimately established. Until then they remain separate records.

## 7.9 Activity

**TARGET:** Activity is a creator-facing product concept and a possible shared domain abstraction.

It does **not** require an immediate universal `activities` table.

Build shared primitives only after concrete safe workflows prove the abstraction.

## 7.10 Participation

A site member/viewer participating in one safe activity instance.

## 7.11 Review

A human-decision workflow attached to an ambiguous or exceptional community operation.

## 7.12 Claim

A structured authenticated lifecycle for applicable reward/community fulfillment.

A Claim does not imply cash, wagering, or gambling settlement.

## 7.13 Recognition

Persistent community acknowledgement based on legitimate community history, such as historical placement, challenge completion, tournament placement, or creator recognition.

---

# 8. Current Technical Foundation to Preserve

## CURRENT

The current repository has already completed major structural convergence work. Preserve it.

### 8.1 Canonical dashboard route semantics

Owner:

`packages/shared/src/dashboard-routes.ts`

It owns:

- stable route IDs,
- canonical paths,
- section/tab structure,
- Worker ownership,
- delivery mode,
- account/site scope,
- navigation-state parameters,
- legacy aliases.

### 8.2 Navigation presentation

Owner:

`packages/shared/src/dashboard-nav.ts`

Labels, icons, rail grouping, and ordering remain presentation concerns derived from route semantics.

### 8.3 Dashboard shell/chrome

Use the existing canonical authenticated shell/chrome ownership.

Do not create a feature-specific replacement shell.

### 8.4 Public viewer renderer

Owner:

`packages/shared/src/site-render.ts`

The public viewer already has a coherent creator-destination model and must remain one renderer.

### 8.5 Public viewer styling

Existing public style ownership remains authoritative. Do not create a `viewer-v2`, `public-new`, or parallel theme family.

### 8.6 Site Settings

The current visual Site Settings customizer is the foundation of:

**Community → Site**

Do not build another creator-site editor.

### 8.7 Existing route/data scopes

The current route manifest distinguishes account-scoped and site-scoped destinations and currently uses more than one site-context query spelling (`board`, `siteId`).

**MIGRATION RULE:** IA work must not casually normalize those query parameters. Any convergence is a separate routing/data-context task with parity tests.

---

# 9. Target Creator Information Architecture

## TARGET

Primary creator navigation:

1. **Home**
2. **Community**
3. **Activities**
4. **People**
5. **Rewards**
6. **Insights**
7. **Settings**

This is a product model, not an instruction to rename every URL immediately.

---

# 10. Scope Map

| Surface | Target scope | Notes |
|---|---|---|
| Home | Account + clearly labeled selected-site context | Cross-site items must never be silently mixed with selected-site data. |
| Manage Sites | Account | Existing collection management remains account-scoped. |
| Community → Site | Site | Public identity/branding of selected site. |
| Community → Leaderboard | Site | Existing board/editor workflow. |
| Community → Recognition | Site | Community history/recognition. |
| Activities | Site | Safe community activities for selected site. |
| People | Site | Members, reviews, moderation in selected site. |
| Rewards | Site | Free loyalty credits/rewards for selected site. |
| Insights | Site first | No fake global analytics aggregation in V1. |
| Settings → Account/Team/Billing/Data | Account | Global administration. |
| Settings → Connections | Mixed, explicitly labeled | Some connections are account-scoped; some existing channel connections are site-scoped. |
| Telegram operational workflows | Account today | Do not hide frequent operations in Settings merely because connection setup belongs there. |

---

# 11. Home

## TARGET

Home answers:

1. What needs attention?
2. What is happening now?
3. What is coming next?
4. What should I do next?

### Needs attention

Examples:

- participant reviews,
- pending claims,
- broken integrations,
- activity issues,
- required setup action.

If nothing needs attention, say so truthfully and do not immediately contradict the message with alarm-style setup cards.

### Happening now

Only active, meaningful community operations.

### Coming next

Scheduled activities, deadlines, or check-ins.

### Community pulse

A small number of useful signals only.

No KPI wall.

### Primary action

Usually one creator action such as:

**Create activity**

Secondary:

**View public site**

---

# 12. Community

## TARGET

Community owns what the selected site's viewers see and how long-term public/community identity is presented.

## 12.1 Site

Owner of global public-site identity:

- creator/site name,
- logo,
- tagline,
- accent,
- typography,
- social links,
- enabled public sections,
- public URL,
- custom domain,
- real viewer preview.

The preview must reuse the actual public renderer.

## 12.2 Leaderboard

Keep the current sub-navigation:

- Setup
- Players
- Appearance
- Share
- History

### Setup

Essential configuration first. Advanced controls behind progressive disclosure.

Generic date/time validation must prevent accidental implausible values and explain errors.

### Players

Reduce spreadsheet-first intimidation.

Default presentation should focus on:

- player,
- rank,
- relevant visible state/value,
- action.

Additional fields move to detail/progressive disclosure where practical.

Do not change underlying opaque ranking/business calculations merely to improve presentation.

### Appearance

Global creator branding comes from Community → Site.

Leaderboard Appearance owns only genuinely leaderboard-specific visual overrides.

### Share

Focus on safe generic sharing and presentation.

Do not use Share redesign work to modify restricted prediction/betting mechanics or related overlays.

### History

Improve archive/history presentation without changing restricted underlying business mechanics.

## 12.3 Recognition

A future parent for:

- Hall of Fame,
- historical placements,
- challenge completions,
- safe tournament placements,
- creator recognition,
- community milestones.

Do not build a giant achievement economy before there is enough real history to justify it.

---

# 13. Activities

## TARGET

Activities answers:

> What am I running for my community?

Safe activity families may include:

- free community giveaways,
- challenges,
- tournaments without wagering/stakes,
- free community drops/events.

Common creator-facing lifecycle where appropriate:

```text
Draft → Scheduled → Open/Live → Needs attention → Completed / Cancelled
```

These are UX concepts first. They are not mandatory database enums.

## 13.1 Shared concepts

Where evidence supports reuse:

- activity identity,
- schedule,
- eligibility,
- participant,
- status,
- review,
- result,
- history,
- notifications.

Do not build a giant universal activity engine before real workflows prove the abstraction.

## 13.2 Activity creation

Use a consistent short flow:

1. Type
2. Basic details
3. Participation/eligibility
4. Timing
5. Type-specific rules
6. Review/publish

## 13.3 Activity detail

Where useful, consistent local sections:

- Overview
- Participants
- Reviews
- Results
- History

Feature-specific behavior remains feature-owned.

---

# 14. Restricted Legacy Feature Boundary

This section is mandatory for coding agents.

## 14.1 Safe/current architecture work may cover

- public viewer shell/presentation,
- leaderboard presentation and generic configuration UX,
- free loyalty rewards/credits,
- viewer/member identity,
- free community giveaways,
- challenges,
- tournaments only where they are ordinary non-wagering community competition,
- free community drops/events,
- generic moderation/review/claims for safe workflows,
- integrations for community management,
- ordinary SaaS subscription UI.

## 14.2 Legacy restricted systems are excluded

Do not redesign, optimize, debug, extend, consolidate into new primitives, or use as architectural examples:

- Games,
- wagering/stake mechanics,
- race/wager mechanics,
- prediction mechanics,
- paid-chance mechanics,
- raffle mechanics involving credit-ticket purchases and random-value outcomes,
- odds/payout/settlement calculations.

## 14.3 Current Engagement route caution

The existing Engagement/Giveaways area mixes safe and restricted legacy tabs.

Therefore:

> **Do not blindly rename the existing container to Activities and then treat every current tab as part of the new safe Activity architecture.**

Safe activity convergence must be route/workflow specific.

Restricted legacy routes may remain operational during migration but are not part of the new architecture initiative.

## 14.4 Opaque existing display data

Existing public leaderboard rows may contain legacy prize/ranking-related display values.

Presentation work may preserve opaque display data as necessary, but must not inspect, optimize, recalculate, make more prominent, or build new gambling-specific semantics around it.

---

# 15. People

## TARGET

People is the creator's site-scoped community-management area.

Local sections:

- Members
- Reviews
- Moderation

## 15.1 Members

Use the existing Audience/Members foundation first.

A member detail surface can progressively show:

- display identity,
- member-since context,
- linked identity state,
- relevant participation history,
- recognition,
- applicable claim history,
- creator-specific moderation context.

Do not turn it into a generic CRM or invasive dossier.

## 15.2 Reviews

One creator-facing queue for safe workflows that need human decisions.

Each review should answer:

- who/what is being reviewed,
- what activity/workflow caused it,
- why review is required,
- what relevant context exists,
- what action is available.

## 15.3 Moderation

Operational, site-specific, and audit-friendly.

Keep owner/team actions attributable.

---

# 16. Viewer Identity and Membership

## TARGET

The trust architecture must not claim perfect real-person verification.

The model is:

```text
Global Viewer Account
        ↓
Creator/Site Membership
        ↓
Authenticated External Identity Links
        ↓
Optional explicit links to existing product records
        ↓
Participation + History + Recognition + Claims
```

The global viewer account is the stable anchor. Membership is the creator/site-specific relationship. External platform identities and existing records such as leaderboard players or Telegram subscribers are linked explicitly rather than silently collapsed.

## 16.1 Explainable context, not a magic score

Do not create a public or moderator-facing single “trust score.”

Useful context may include high-level signals such as:

- established vs new community membership,
- connected identity presence,
- previous participation,
- previous completed claims,
- unusual duplicate/relationship patterns that merit review.

## 16.2 No single-signal guilt

No one technical signal should automatically prove abuse.

Network/device indicators may contribute to review prioritization but should not be exposed as raw sensitive data or treated as proof of identity.

## 16.3 Human decision

Possible creator/moderator outcomes for safe workflows:

- Allow
- Exclude from this activity
- Request verification
- Keep pending

An activity-level decision must not automatically become a platform-wide ban.

## 16.4 False-positive protection

The system must account for legitimate shared environments and changing networks.

Long-term legitimate history should reduce unnecessary repeated friction where appropriate.

## 16.5 Privacy

Creators should see only information relevant to operating their own community.

Creator A must not automatically see Creator B's private moderation context.

---

# 17. Claims

## TARGET

Claims are a shared authenticated fulfillment lifecycle for applicable safe community workflows.

Canonical UX states may include:

```text
Waiting for viewer
Submitted
Needs review
Approved
Completed
Expired
Cancelled
```

These are target UX states; existing reward/redemption schema must be mapped deliberately rather than renamed blindly.

## 17.1 Claim ownership

A claim should remain attached to:

- authenticated viewer/member,
- source workflow,
- result/reward,
- status,
- audit history.

## 17.2 Claim privacy

Private fulfillment data must:

- never render publicly,
- be visible only to authorized staff,
- have access/state changes audited,
- be retained only as reasonably necessary,
- remain separated from ordinary public community history.

## 17.3 Existing Rewards integration

Existing Redemptions remain the current implementation.

A future Claims wave may adapt them into the shared lifecycle where this genuinely reduces duplication.

Do not rewrite a stable redemption system solely to obtain architectural symmetry.

---

# 18. Rewards

## TARGET

Rewards remains a first-class site-scoped product area.

Recommended local structure:

- Overview
- Catalog/Shop
- Redemptions
- Activity
- Rules

Rewards should remain based on free platform/community loyalty credits and ordinary creator rewards.

Viewer-facing reward experiences must clearly separate community credits from money.

Basic safety, privacy, and truthful status are not paid features.

---

# 19. Insights

## TARGET

Insights replaces the creator-facing label **Analytics**, but the initial implementation remains selected-site scoped.

Its job is to answer useful questions such as:

- Are people returning?
- Which safe activities get repeat participation?
- Which rewards are used?
- What changed?
- What needs attention?

Do not fabricate cross-product/global intelligence before the data model supports it.

Charts support the answer; charts are not the answer.

---

# 20. Settings, Connections, and Communication

## TARGET DECISION

Connection administration and day-to-day community communication are different jobs and must not be mixed.

### Settings → Connections

Owns connection lifecycle for supported external platforms:

- connect,
- disconnect,
- authentication/authorization state,
- least-privilege permission explanation,
- connection health,
- reconnect/recovery,
- what the connection enables,
- whether the connection is account-scoped or site-scoped.

Connection failures that affect operations may surface on Home under **Needs attention**.

### Community → Communication

This is the long-term home for safe, generic community communication operations that are valuable across channels, such as:

- announcements,
- supported broadcasts,
- community reminders,
- activity/result announcements,
- supported creator/community commands where they fit the generic product,
- channel delivery status.

It is not a permanent top-level rail item.

### Telegram migration rule

Telegram currently contains frequent operational workflows and must not be shoved into Settings merely to make the new navigation look tidy.

Migration sequence:

1. keep current Telegram operations working,
2. move only connection lifecycle/health into Settings → Connections when the shared connection model is ready,
3. introduce Community → Communication only when it can own real generic communication workflows,
4. migrate eligible Telegram operations into that generic surface deliberately,
5. leave Telegram-specific implementation/configuration details deeper in the connection/integration context where needed.

Do not create gambling-specific communication automation, wagering notifications, or other restricted mechanics as part of this architecture.

---

# 21. Team and Permissions

## TARGET

Start simple.

### V1 roles

- Owner
- Moderator

### Later

- Manager
- custom roles only if usage proves the need.

Permission groups may include:

- Site
- Activities
- Participants/Reviews
- Claims
- Members
- Rewards
- Insights
- Team

Do not require shared credentials.

Sensitive claim data should have a dedicated permission boundary where appropriate.

---

# 22. Live Control

## TARGET / LATER

Live Control is contextual, not permanent navigation.

When a safe activity is currently active, a creator or moderator may open a focused operational surface showing:

- active activity state,
- needs-attention items,
- participant/review state,
- integration issues,
- recent important moderator actions,
- relevant quick actions.

When nothing is live, this surface should not occupy permanent navigation.

---

# 23. Public Viewer Architecture

## CURRENT

The current real public renderer supports a creator destination with sections including Home, Leaderboard, Rewards, Games, and creator-scoped **My Community**. Global `/me` is the Viewer Account's **My communities** index.

My Community owns membership-specific Rewards/credits and existing Claims. My communities summarizes each membership and links to its creator-owned surface; it does not rebuild a second reward shop, Claim list, or creator destination.

## TARGET

Long-term core viewer navigation may become:

- Home
- Leaderboard
- Activities
- Rewards
- My Community

Only enabled/useful sections appear.

### Critical migration rule

Use **My Community** only for a real creator-scoped `site_viewers` membership owned by one authenticated Viewer Account. Use **My communities** only for the authenticated cross-community index derived from those memberships.

The current foundation satisfies that rule. New labels for participation, Recognition, or expanded Claims must still wait for real capabilities.

Public navigation changes follow capability, not aspiration.

## 23.1 Home

Answer quickly:

- whose community this is,
- what is happening,
- what the viewer can do,
- their status when signed in,
- what happens next.

## 23.2 Leaderboard

Readable standings, search, history, and community recognition without spreadsheet/admin visual language.

## 23.3 Activities

Future viewer destination for safe community activities only.

Target route family:

- `/<slug>/activities` on `yourrank.site`,
- `/activities` on a creator custom domain.

Do not ship the route or navigation item until the Activity foundation has real public content.

## 23.4 Rewards

Free loyalty credits/rewards, clear status, and no duplicate auth prompts.

## 23.5 My Community

Current creator-specific membership surface:

- Viewer Account and community context,
- member-since state when available,
- Credits and Rewards where enabled,
- existing reward Claims and their current status.

Participation history, Recognition, richer profile controls, and expanded Claims history remain future scope.

## 23.6 Global My Communities

Current global Viewer Account index showing memberships, free-credit balance, and a controlled pending-Claims count. Each row opens the canonical creator-scoped My Community surface. It never duplicates the creator's reward catalog, full Claim history, live activity, plan data, or internal moderation context.

## 23.7 Games

Games is a legacy/parked destination.

It may remain as an opaque existing route/nav destination during unrelated migration work, but it is not part of the new viewer architecture initiative and must not drive design decisions.

---

# 24. Streamer Lifecycle

## TARGET

```text
Create account
   ↓
Create/select site
   ↓
Configure public community destination
   ↓
Connect relevant platforms
   ↓
Launch first useful safe activity / leaderboard / reward
   ↓
Operate from Home / activity detail
   ↓
Moderator handles exceptions where delegated
   ↓
Review only ambiguous cases
   ↓
Complete result / applicable claim
   ↓
Keep history / recognition
   ↓
Reuse what works
```

The creator should not be forced to configure every product pillar before receiving value.

---

# 25. Viewer Lifecycle

## TARGET

```text
Discover creator site
   ↓
Browse useful public content without forced registration
   ↓
Sign in when participation/account state requires it
   ↓
Join creator context
   ↓
Link relevant identity where useful
   ↓
Participate
   ↓
Understand status and next action
   ↓
Build history / recognition
   ↓
Complete applicable claim/reward flow
   ↓
Return between streams
```

Authentication must return the viewer to the workflow they were performing rather than dumping them onto a generic account page.

---

# 26. State Language

Use consistent human language across safe workflows.

## 26.1 Activity

- Draft
- Scheduled
- Open / Live
- Needs attention
- Completed
- Cancelled

## 26.2 Review

- Needs review
- Waiting for verification
- Allowed
- Excluded
- Resolved

## 26.3 Claim

- Waiting for viewer
- Submitted
- Needs review
- Approved
- Completed
- Expired
- Cancelled

## 26.4 Connection

- Connected
- Needs attention
- Disconnected

These are product-language targets, not instructions to rename database enums without a migration plan.

---

# 27. UX Invariants

## 27.1 One primary action

Every primary screen should have one obvious next action.

## 27.2 State before action

If state changes the user's decision, show the truthful state before or beside the action.

## 27.3 Progressive disclosure

Advanced configuration must not dominate default screens.

## 27.4 Empty states teach

Every empty state answers:

- What is this?
- Why would I use it?
- What should I do first?

## 27.5 No filler

Short pages are allowed.

Do not add cards, charts, or fake metrics simply to fill desktop space.

## 27.6 Mobile is a real layout

Do not compress desktop tables and workflows into narrow screens unchanged.

## 27.7 Nontechnical language

Use creator-facing outcome language rather than infrastructure language.

---

# 28. Technical Architecture Invariants

## CURRENT + MIGRATION

### 28.1 One canonical route model

Do not create a second route registry.

### 28.2 One authenticated dashboard shell

Do not create feature-specific shells.

### 28.3 One navigation system

Sidebar owns section roots; local sub-navigation owns tabs; topbar owns context/actions.

### 28.4 One public renderer

Do not create a parallel viewer implementation.

### 28.5 One source of creator public branding

Community → Site owns creator-wide public branding.

### 28.6 One client navigation entry point

Do not create route-specific competing navigation runtimes.

### 28.7 Existing style owners

Use established style owners.

Do not add `*-v2`, `*-new`, `*-final`, new theme families, or a parallel design system for these migrations.

### 28.8 Route labels are not route identities

Stable route IDs and canonical path semantics must survive presentation-label changes.

### 28.9 Scope remains explicit

Account-scoped and site-scoped data must never be silently mixed.

---

# 29. Security, Privacy, and Caching Invariants

This was missing from the first draft and is mandatory.

## 29.1 Public caching boundary

Anonymous public HTML may be cacheable.

Viewer-specific/authenticated data must never leak into anonymous cached responses.

## 29.2 Claims/private fulfillment data

Never public. Access only by authorized users and appropriate backend workflows.

## 29.3 Creator isolation

One creator must not receive another creator's private member/moderation context.

## 29.4 Viewer privacy

Viewer-facing settings should support legitimate account linking/unlinking, public-profile controls where applicable, and data/privacy controls.

## 29.5 Authorization follows action ownership

UI hiding is not authorization. Server-side permission checks remain required.

## 29.6 Auditability

Sensitive creator/team actions should be attributable and time-stamped where the underlying workflow requires it.

---

# 30. SaaS Plans and Entitlement Direction

## TARGET

### Free

Enough to prove the core product works:

- real public creator destination,
- basic viewer/community identity,
- usable leaderboard,
- safe basic community activities,
- free loyalty rewards,
- basic review/claims safety,
- core connection support.

### Pro

Charge for scale, automation, customization, and richer operations:

- more capacity,
- templates,
- scheduling,
- recurring safe activities,
- deeper history,
- custom domain,
- richer creator customization,
- stronger operational context/insights.

### Team

Target product concept for multi-operator communities:

- more team members,
- roles/permissions,
- operational auditability,
- higher limits,
- team workflows.

## CURRENT BILLING CAUTION

The current repository has older billing/plan terminology and documented unresolved billing behavior.

Therefore:

- do not rename plan enums as part of UI architecture work,
- do not invent prices,
- do not invent recurring/lifetime terms,
- do not modify payment methods as part of this architecture migration.

A separate ordinary SaaS billing reconciliation must resolve current implementation vs documentation before pricing implementation changes.

## Viewer rule

Basic viewer participation, identity, claims access, privacy, and fairness must not be sold as viewer advantages.

---

# 31. Product Roadmap

## V1 — Prove the core loop

- clean creator workspace,
- public creator destination,
- viewer/site membership foundation,
- existing leaderboard simplified,
- safe activity foundation,
- basic reviews,
- unified claims where justified,
- free loyalty rewards,
- member management,
- basic moderator access,
- core connections,
- simple useful insights.

## V1.5 — Remove repetitive work

- duplicate activity,
- templates,
- recurring challenges,
- scheduling,
- reminders,
- improved check-in/waitlist for safe tournaments,
- better review grouping,
- better moderator workflow,
- stronger viewer history/recognition.

## V2 — Compound community value

- useful global My Communities,
- stronger identity continuity,
- richer review context,
- Community → Communication with supported cross-channel announcements,
- community calendar,
- deeper Team capabilities,
- stronger insights,
- safe sponsor/community reporting where legitimate.

## Later

Only after real demand:

- agency/organization views,
- advanced creator-network workflows,
- team challenges,
- richer achievements,
- mobile app,
- cross-community safe events.

---

# 32. Migration Plan

## Wave 0 — Documentation Reconciliation — BLOCKER

Before feature/UI coding against the new IA, land one documentation-only alignment PR that:

1. adds this document at `docs/YOURRANK_PRODUCT_ARCHITECTURE.md`,
2. updates/supersedes conflicting product-positioning statements,
3. makes `PROJECT_TRUTH` point to this target architecture,
4. updates stale `PROJECT_STATE` facts to the current architecture,
5. preserves technical/runtime facts in `ARCHITECTURE.md`,
6. update DESIGN product-model language without unnecessarily changing stable visual tokens/components.

No feature code required.

## Wave A — Streamer Dashboard Simplification

Focus only on safe creator presentation:

- Home contradiction/density,
- Sites/manage-sites composition,
- Leaderboard Setup clarity/date validation,
- Players progressive disclosure,
- consistent real-viewer preview treatment,
- Appearance ordinary SaaS Pro state cleanup,
- History presentation,
- responsive/accessibility polish.

Explicitly exclude restricted mechanics.

## Wave B — Navigation / Information Architecture

Move visible creator mental model toward:

- Home
- Community
- Activities
- People
- Rewards
- Insights
- Settings

But do not rename canonical URLs without evidence.

Do not fully demote Telegram operations until the communication architecture is resolved.

Do not turn restricted Engagement tabs into new safe Activities.

## Wave C — Community Consolidation

- Community → Site uses existing Site Settings,
- Community → Leaderboard keeps existing editor tabs,
- define Recognition parent when enough real content exists,
- move Manage Sites access into context/site-selector workflow if usability testing supports it.

## Wave D — People + Identity Foundation

- promote existing Members,
- define creator-specific membership,
- map existing viewer/player/subscriber identity relationships,
- create member detail progressively,
- establish privacy boundaries.

No fake automatic identity merge.

## Wave E — Safe Activity Foundation

- define safe activity common concepts from real existing workflows,
- add Challenges only after shared foundations are proven,
- converge safe free giveaway/drop/tournament UI where useful,
- leave restricted legacy systems outside this abstraction.

## Wave F — Reviews

- one safe shared review queue,
- explainable context,
- human decision,
- audit trail,
- false-positive handling.

## Wave G — Claims

- define canonical safe claims state model,
- adapt reward redemptions only where it removes real duplication,
- preserve private fulfillment boundaries.

## Wave H — Moderator / Team Operations

- Owner/Moderator roles first,
- role-based safe operations,
- auditability,
- no shared credentials.

## Wave I — Insights + Connection Health

- reframe selected-site Analytics as Insights,
- surface connection health/actionable failures on Home,
- keep connection administration in Settings.

## Wave J — Viewer Membership Expansion

The Viewer Account, My communities index, and creator-scoped My Community foundation already exist. Wave J may expand them only when persistence and product evidence support:

- viewer participation history,
- recognition history,
- expanded Claims overview/history.

Wave J must extend the canonical surfaces rather than create parallel viewer or membership products.

## Wave K — Automation

Only after the manual workflows are proven:

- templates,
- scheduling,
- reminders,
- recurring safe activities,
- safe announcements after communication architecture is approved.

---

# 33. Route Migration Policy

A visible label change does not require a URL change.

Examples:

- `/dashboard/audience/members` may display under **People**.
- `/dashboard/analytics` may display as **Insights**.
- existing selected-site routes may remain canonical while grouped under **Community**.

If a URL is eventually changed:

1. keep stable route identity,
2. encode alias/redirect in the canonical route model,
3. preserve query/navigation state,
4. preserve browser/server parity,
5. test direct load and SPA navigation,
6. remove obsolete handling only after the replacement is proven.

Do not create route aliases in random page modules.

---

# 34. Implementation Rules for Coding Agents

Before any non-trivial architecture work:

1. inspect `AGENTS.md` and the repo's current skill routing,
2. inspect the canonical route manifest,
3. inspect current navigation/chrome ownership,
4. inspect the real page and its runtime path,
5. identify actual style owner,
6. inspect relevant tests,
7. distinguish CURRENT vs TARGET behavior,
8. make the smallest coherent migration.

Never create:

- a second route model,
- a second dashboard shell,
- a second public renderer,
- a second creator-branding source,
- a parallel design system,
- an `*-v2` replacement family,
- a universal domain abstraction without real reuse evidence.

Each implementation PR must state:

- scope,
- target architecture rule being advanced,
- current owner being reused,
- explicit exclusions,
- changed files,
- runtime/browser verification performed,
- risks/not verified.

---

# 35. Success Metrics

Do not use raw signups/pageviews as the main measure of product success.

## North star

**Monthly Returning Community Participants**

A viewer meaningfully participates and returns for another meaningful community interaction in a later period.

## Creator health

**Monthly Active Creator Communities/Sites**

Count meaningful community operation, not login alone.

## Core supporting metrics

- creator completed first meaningful community workflow,
- time to first value,
- creator repeat-activity rate,
- viewer return rate,
- viewer repeat participation,
- manual interventions per 100 safe participants,
- review resolution time,
- false-positive/repeated-review health,
- percentage of applicable claims completed inside YourRank,
- integration reliability,
- moderator adoption,
- empty-state → first-action conversion.

Guardrail:

> Reducing manual work must not come from making legitimate participation harder.

---

# 36. Final Decisions and Deferred Implementation Gates

These items were open during the debug pass. The product direction is now fixed. Only implementation details remain deferred until prerequisites exist.

## 36.1 Communication location — DECIDED

- **Settings → Connections** owns authorization, health, reconnect, and platform setup.
- **Community → Communication** is the long-term generic operational home for safe announcements/broadcasts/reminders and other channel-neutral communication capabilities.
- Existing Telegram operational routes remain intact until that generic surface exists and can replace them without losing functionality.
- Communication does not become another permanent top-level product.

## 36.2 Team naming — DECIDED

The customer-facing target plan/operating concept is **Team**.

Persisted plan enums, billing identifiers, or legacy `agency`-style values must not be renamed merely to match UI language. Billing reconciliation owns any storage/entitlement migration.

## 36.3 Viewer identity linkage — DECIDED

The conceptual identity model is:

```text
Global Viewer Account
        ↓
Creator/Site Membership
        ↓
Verified/Authenticated External Identity Links
        ↓
Optional explicit links to existing product records
        ↓
Participation + History + Recognition + Claims
```

Rules:

- linking requires authenticated ownership or an equally strong platform-supported proof,
- do not merge records based only on matching usernames, display names, IP/network data, or behavioral similarity,
- leaderboard player rows and Telegram subscriber records remain separate until explicitly linked,
- creator-specific moderation context remains creator-isolated,
- data migrations must be reversible and schema-backed.

Concrete table/column names are deferred to the identity implementation design.

## 36.4 Recognition scope — DECIDED

V1 Recognition uses only trustworthy history the product can actually support, such as:

- leaderboard period placements/archive,
- supported safe activity completion/results,
- tournament placements where applicable,
- explicit creator-awarded recognition when a real moderation/audit model supports it.

Do not invent a large achievement economy, public trust badge, or synthetic recognition just to fill the page.

## 36.5 Public Activities route family — DECIDED, IMPLEMENTATION DEFERRED

Target public route family:

- apex creator site: `/<slug>/activities`
- custom domain: `/activities`

Individual activity detail routes live beneath that family using stable identifiers/slugs chosen by the activity implementation.

Do not add placeholder routes before the safe Activity foundation exists. Current polished public navigation stays unchanged until the feature is real.

## 36.6 Home scope — DECIDED

Dashboard Home remains **account-scoped**.

V1 behavior:

- selected-site operational content is clearly labeled with the current site,
- account-level items such as billing/team/global connection problems are visually separated from selected-site items,
- the site selector remains the explicit way to change site context,
- V1 does not invent cross-site aggregate KPI dashboards,
- when a creator manages multiple sites, Home may surface a concise account-level attention item that points to the affected site, but the detailed workflow opens in that site's context.

## 36.7 Billing implementation — DEFERRED GATE

Free / Pro / Team is the target customer-facing product model.

Exact prices, recurring/lifetime semantics, payment-provider behavior, persisted plan values, and entitlement migrations require a separate ordinary SaaS billing reconciliation before implementation changes.

## 36.8 Physical schema for shared Activity / Review / Claims — DEFERRED GATE

The product concepts are final, but the persistence shape is intentionally not predetermined.

Do not create universal tables merely because the architecture uses shared product language. Each implementation wave must first prove:

- actual shared lifecycle,
- shared permission needs,
- shared query patterns,
- migration/rollback safety,
- and that an adapter is worse than a true shared model.


# 37. Definition of Done

This architecture is working when:

- repo product docs agree on the same product model,
- creators see a coherent workspace rather than disconnected modules,
- the selected site context is always clear,
- Community owns creator-wide public identity,
- Leaderboard owns only leaderboard concerns,
- safe Activities are coherent without absorbing restricted legacy mechanics,
- People is the community-member home,
- Rewards keeps safe free-credit/reward semantics,
- shared Reviews and Claims exist only where they remove real duplication,
- Insights explains meaningful site behavior rather than filling screens with charts,
- connection administration is clear without burying frequent operations in Settings,
- public viewer remains one polished creator destination,
- membership/identity changes are privacy-aware and evidence-based,
- route/shell/navigation/viewer ownership remains singular,
- mobile/accessibility remain first-class,
- no parallel architecture or new design-system family is introduced,
- each migration wave can be reviewed and rolled forward independently.

---

# 38. Final Canonical Summary

YourRank should evolve through:

> **preserve → reorganize → simplify → connect → then build what is genuinely missing**

The target creator-facing product model is:

**Home → Community → Activities → People → Rewards → Insights → Settings**

but that product model sits on top of the current proven technical foundation rather than replacing it.

The strongest long-term differentiation is not any single leaderboard, giveaway, reward, or creator page. It is the combination of:

**viewer identity + creator-specific membership + participation history + explainable review context + claims history + recognition**

connected through one coherent creator community system.

The immediate implementation priority is not another rewrite. It is:

1. reconcile the repository's product truth,
2. clean the streamer dashboard,
3. establish the new visible IA without route churn,
4. build identity/membership deliberately,
5. converge only safe activity/review/claim systems where evidence justifies shared architecture.


---

# 39. Repository Activation Checklist

This final document is ready to be committed as the target architecture.

It becomes operationally canonical for coding agents only after the Wave 0 documentation-alignment PR makes the repository instruction graph consistent.

Wave 0 is complete when:

- `docs/YOURRANK_PRODUCT_ARCHITECTURE.md` contains this version,
- `PRODUCT.md` summarizes the same product model,
- `DESIGN.md` no longer requires the superseded three-peer-product navigation model,
- `docs/product-positioning.md` is clearly marked superseded or rewritten,
- `.ai/PROJECT_TRUTH.md` references this architecture as target product truth,
- `.ai/PROJECT_STATE.md` reflects the current post-Wave-2/3 technical reality rather than stale pre-convergence findings,
- `ARCHITECTURE.md` preserves verified runtime/deployment facts but removes stale product-positioning claims,
- `AGENTS.md` / the AI instruction graph has no contradictory product-source-of-truth instruction,
- repository documentation/self-check validation passes.

After Wave 0, implementation begins with the focused dashboard/navigation waves in this document. No agent should reinterpret the product architecture from the legacy UI or old product-positioning files.
