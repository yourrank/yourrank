# YourRank FEATURES_AUDIT.md

Comprehensive inventory of pages, routes, components, features, forms, actions, API calls, state, navigation, modals, drawers, tooltips, and hidden UI.

This file is the preservation contract for UI/UX work: every listed item should remain present and functional unless explicitly approved for removal.


## 1. Repo & tech stack

| Field | Value |
| --- | --- |
| Monorepo root | yourrank/ |
| Package manager | Bun >= 1.3.0 |
| Runtime | Cloudflare Workers + Supabase/Postgres + Cloudflare Queues |
| Frontend | JSX/Preact server-rendered pages + vanilla-JS dashboard SPA + Next.js marketing |
| Test command | bun run scripts/test.mjs |


### 1.1 Apps

| App | Purpose |
| --- | --- |
| `bot` | Worker/frontend app |
| `consumer` | Worker/frontend app |
| `leaderboard` | Worker/frontend app |
| `monitor` | Worker/frontend app |
| `web` | Worker/frontend app |


### 1.2 Shared packages

| Shared module |
| --- |
| packages/shared/src/activation-funnel.ts |
| packages/shared/src/audit.ts |
| packages/shared/src/avatar.ts |
| packages/shared/src/board-views.ts |
| packages/shared/src/brand-assets.ts |
| packages/shared/src/circuit-breaker.ts |
| packages/shared/src/clicks.ts |
| packages/shared/src/conversions.ts |
| packages/shared/src/crypto.ts |
| packages/shared/src/dashboard-chrome.ts |
| packages/shared/src/dashboard-nav.ts |
| packages/shared/src/db.d.ts |
| packages/shared/src/db.ts |
| packages/shared/src/discord-oauth.ts |
| packages/shared/src/domain-provider.ts |
| packages/shared/src/email.ts |
| packages/shared/src/env.ts |
| packages/shared/src/errors.ts |
| packages/shared/src/features.ts |
| packages/shared/src/games/dice.ts |
| packages/shared/src/games/fairness.ts |
| packages/shared/src/games/index.ts |
| packages/shared/src/games/limbo.ts |
| packages/shared/src/games/mines.ts |
| packages/shared/src/games/plinko.ts |
| packages/shared/src/games/store.ts |
| packages/shared/src/games/types.ts |
| packages/shared/src/games-embed.ts |
| packages/shared/src/index.ts |
| packages/shared/src/kick-credits.ts |
| packages/shared/src/kick-oauth.ts |
| packages/shared/src/monitoring.ts |
| packages/shared/src/notifications.ts |
| packages/shared/src/oauth-state.ts |
| packages/shared/src/page-shell.ts |
| packages/shared/src/plans.ts |
| packages/shared/src/postback.ts |
| packages/shared/src/postgres.d.ts |
| packages/shared/src/provider-events.ts |
| packages/shared/src/public-render-helpers.ts |
| packages/shared/src/queue-producer.ts |
| packages/shared/src/rate-limiter-do.ts |
| packages/shared/src/ratelimit.ts |
| packages/shared/src/request-id.ts |
| packages/shared/src/safe-next.ts |
| packages/shared/src/session.d.ts |
| packages/shared/src/session.ts |
| packages/shared/src/shell-nav.ts |
| packages/shared/src/site-render.ts |
| packages/shared/src/stats.ts |
| packages/shared/src/team.ts |
| packages/shared/src/validation.ts |
| packages/shared/src/viewer-session.ts |
| packages/shared/src/with-worker.ts |
| packages/shared/src/work-concurrency.ts |


## 2. HTTP routes


### 2.1 Leaderboard Worker API

| Method | Path | Handler | Purpose |
| --- | --- | --- | --- |
| GET | `/auth/demo` | `handleDemoLogin` | Auth routes (CSRF-exempt: callers may not have a CSRF cookie yet) |
| POST | `/api/auth/signup` | `handleSignup` |  |
| POST | `/api/auth/login` | `handleLogin` |  |
| GET | `/api/auth/me` | `handleMe` |  |
| POST | `/api/auth/forgot` | `handleForgot` | POST /api/auth/forgot — always answers ok; never reveals whether the account exists. SEC-702: try/catch ensures reset tokens are never logged even if an unexpected error occurs during the email send or KV write. |
| POST | `/api/auth/reset` | `handleReset` | POST /api/auth/reset — { token, password } SEC-702: Wrap in try/catch that redacts the reset token before logging. |
| POST | `/api/auth/verify` | `handleVerifyEmail` | POST /api/auth/verify — { token } |
| POST | `/api/auth/resend-verification` | `handleResendVerification` | POST /api/auth/resend-verification — { email } Does not reveal whether the email exists. |
| POST | `/api/auth/logout` | `handleLogout` | Authenticated auth routes (CSRF required) |
| POST | `/api/auth/change-password` | `handleChangePassword` | Security center handlers: password change, active sessions, and GDPR/CCPA export. |
| GET | `/api/auth/sessions` | `handleListSessions` | Security center handlers: password change, active sessions, and GDPR/CCPA export. |
| POST | `/api/auth/sessions/revoke-others` | `handleRevokeOtherSessions` | Security center handlers: password change, active sessions, and GDPR/CCPA export. |
| POST | `/api/account/export` | `handleCreateExportJob` | Security center handlers: password change, active sessions, and GDPR/CCPA export. |
| GET | `/api/account/export/:id/status` | `handleExportJobStatus` | Security center handlers: password change, active sessions, and GDPR/CCPA export. |
| GET | `/api/account/export/:id/download` | `handleExportJobDownload` | Security center handlers: password change, active sessions, and GDPR/CCPA export. |
| POST | `/api/auth/telegram/link` | `handleTelegramLink` | POST /api/auth/telegram/link Link a Telegram identity to the current user's account. Body: { id, first_name, last_name, username, photo_url, auth_date, hash } Verifies the Telegram Login widget payload, then links telegr |
| POST | `/api/auth/telegram/unlink` | `handleTelegramUnlink` | POST /api/auth/telegram/unlink Unlink Telegram identity from the current user's account. |
| GET | `/api/auth/telegram/status` | `handleTelegramStatus` | GET /api/auth/telegram/status Check if the current user has a linked Telegram account. |
| GET | `/api/site` | `handleGetSite` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| PUT | `/api/site` | `handlePutSite` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| POST | `/api/site/sections` | `handlePostSiteSections` | POST /api/site/sections — toggle public viewer sections (shop, credits, games). |
| GET | `/api/site/games/settings` | `handleGetSiteGameSettings` | GET /api/site/games/settings |
| POST | `/api/site/games/settings` | `handlePostSiteGameSettings` | POST /api/site/games/settings |
| POST | `/api/site/finish` | `handleFinishSetup` | POST /api/site/finish — mark the wizard-created board as finished. |
| POST | `/api/site/theme` | `handlePutTheme` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| DELETE | `/api/site` | `handleDeleteSite` | DELETE /api/site — { siteId } |
| GET | `/api/site/list` | `handleListBoards` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| POST | `/api/site/create` | `handleCreateBoard` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| POST | `/api/site/duplicate` | `handleDuplicateBoard` | POST /api/site/duplicate — { siteId } |
| POST | `/api/site/archive` | `handleArchive` | POST /api/site/archive — { label?, clear: "wagers"\|"players"\|"none" } |
| POST | `/api/sites/:id/quick-add` | `handleQuickAdd` | POST /api/sites/:id/quick-add Takes { name: "Steve", amount: 500 } Updates existing player or creates new one, then saves board. |
| POST | `/api/site/archive/delete` | `handleArchiveDelete` | POST /api/site/archive/delete — { id, siteId? } |
| POST | `/api/site/archive/restore` | `handleRestoreArchive` | POST /api/site/archive/restore — { archiveId, siteId? } |
| POST | `/api/site/active` | `handleSetActive` | POST /api/site/active — { siteId } |
| GET | `/api/site/stats/export` | `handleExportStats` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| GET | `/api/site/players/export` | `handleExportPlayers` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| GET | `/api/site/stats` | `handleStats` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| GET | `/api/site/stats/heatmap` | `handleHeatmap` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| POST | `/api/site/notify/test` | `handleNotifyTest` | POST /api/site/notify/test — send a test Discord or Telegram notification. |
| POST | `/api/site/domain/verify` | `handleDomainVerify` | POST /api/site/domain/verify — verify custom domain CNAME and provision TLS via Cloudflare for SaaS custom hostnames. Pro/Agency only. |
| POST | `/api/domains/search` | `handleDomainSearch` | POST /api/domains/search — Search domain availability across popular TLDs with retail pricing |
| POST | `/api/domains/purchase` | `handleDomainPurchase` | POST /api/domains/purchase — Purchase a domain with instant 1-click CNAME DNS & SSL linking |
| GET | `/api/domains/my-domain` | `handleGetMyDomain` | GET /api/domains/my-domain — Get active custom domain details & transfer status for current site/user |
| POST | `/api/domains/toggle-lock` | `handleDomainToggleLock` | POST /api/domains/toggle-lock — Enable/disable ICANN registrar transfer lock |
| POST | `/api/domains/transfer-auth-code` | `handleDomainTransferAuthCode` | POST /api/domains/transfer-auth-code — Retrieve EPP Authorization code to transfer domain out |
| GET | `/api/site/team` | `handleTeamList` | GET /api/site/team?siteId=... List members and pending invites for a site. |
| POST | `/api/site/team/invite` | `handleTeamInvite` | POST /api/site/team/invite Send or generate an invite for a mod or manager. |
| POST | `/api/site/team/invite/revoke` | `handleTeamRevokeInvite` | POST /api/site/team/invite/revoke Cancel an active invitation. |
| POST | `/api/site/team/remove` | `handleTeamRemoveMember` | POST /api/site/team/remove Remove a member from the site. |
| POST | `/api/site/team/role` | `handleTeamUpdateRole` | POST /api/site/team/role Update role of a member (e.g. moderator <-> manager). |
| POST | `/api/site/team/accept-invite` | `handleTeamAcceptInvite` | POST /api/site/team/accept-invite Accept an invite for the current user. |
| GET | `/api/site/team/invite-info` | `handleGetInviteInfo` | GET /api/site/team/invite-info?token=... Fetch public metadata about an invite. |
| POST | `/api/lead` | `handleLead` | Lead submission handler |
| POST | `/api/contact` | `handleContact` | Public contact/support form handler. Stores the message and emails the support inbox when RESEND_API_KEY is set. |
| POST | `/api/feedback` | `handleFeedback` | Public viewer feedback handler. Submits feedback tied to the current site and (optionally) signed-in viewer. |
| POST | `/api/track/copy` | `handleTrackCopy` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| POST | `/api/track/scroll` | `handleTrackScroll` | Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain |
| POST | `/api/scores` | `handleScores` | POST /api/scores — authenticated by X-Postback-Key header + X-Postback-Signature HMAC. Validates key against sites table, checks Pro plan gate, replaces player list. |
| POST | `/webhooks/kick` | `handleKickWebhook` | Kick webhook handler for channel-point reward redemptions. Keeps the request thread thin: verify the signature, filter the event, then drop it onto the shared events queue. The consumer durably grants credits. |
| GET | `/auth/kick` | `handleKickAuthStart` | Kick OAuth 2.1 flow for streamers linking their Kick channel. |
| GET | `/auth/kick/callback` | `handleKickAuthCallback` | Kick OAuth 2.1 flow for streamers linking their Kick channel. |
| POST | `/api/kick/disconnect` | `handleKickAuthDisconnect` | Kick OAuth 2.1 flow for streamers linking their Kick channel. |
| GET | `/api/giveaways/chatroom` | `handleGiveawayChatroom` | Handler for Kick Giveaway and Live Chatroom resolution |
| GET | `/api/events/raffles` | `handleGetRaffles` | GET /api/events/raffles — List raffles for streamer dashboard |
| POST | `/api/events/raffles` | `handleCreateRaffle` | POST /api/events/raffles — Create a new ticket raffle |
| POST | `/api/events/raffles/draw` | `handleDrawRaffle` | POST /api/events/raffles/draw — Draw a random winning ticket for an active raffle |
| GET | `/api/events/drops` | `handleGetCodeDrops` | GET /api/events/drops — List flash code drops |
| POST | `/api/events/drops` | `handleCreateCodeDrop` | POST /api/events/drops — Create a new flash code drop |
| POST | `/api/events/drops/claim` | `handleClaimCodeDrop` | POST /api/events/drops/claim — Viewer redeems a flash drop code |
| GET | `/api/predictions` | `handleGetPredictions` | GET /api/predictions — List predictions for the site |
| POST | `/api/predictions` | `handleCreatePrediction` | POST /api/predictions — Create a new prediction |
| POST | `/api/predictions/:id/lock` | `handleLockPrediction` | POST /api/predictions/:id/lock — Lock betting on prediction |
| POST | `/api/predictions/:id/settle` | `handleSettlePrediction` | POST /api/predictions/:id/settle — Settle prediction and distribute proportional payouts |
| POST | `/api/predictions/:id/cancel` | `handleCancelPrediction` | POST /api/predictions/:id/cancel — Cancel prediction and refund all bets |
| GET | `/api/games/wheel/config` | `handleGetWheelConfig` | GET /api/games/wheel/config — Get wheel config for site |
| POST | `/api/games/wheel/config` | `handleUpdateWheelConfig` | POST /api/games/wheel/config — Streamer updates wheel config |
| POST | `/api/games/wheel/spin` | `handleSpinWheel` | POST /api/games/wheel/spin — Viewer spins the wheel |
| GET | `/api/battlepass/season` | `handleGetSeason` | GET /api/battlepass/season — Get active season and viewer progress |
| POST | `/api/battlepass/season` | `handleCreateSeason` | POST /api/battlepass/season — Streamer creates or starts a new season |
| POST | `/api/battlepass/claim` | `handleClaimTierReward` | POST /api/battlepass/claim — Viewer claims milestone tier reward |
| POST | `/api/battlepass/award-xp` | `handleAwardXp` | POST /api/battlepass/award-xp — Award XP to a viewer and handle automatic level up |
| GET | `/overlay/prediction` | `handleOverlayPredictionPage` | GET /overlay/prediction — Transparent OBS Browser Source for active Prediction HUD |
| GET | `/overlay/alerts` | `handleOverlayAlertsPage` | GET /overlay/alerts — Transparent OBS Browser Source for Audio-Visual Alerts & Sound effects |
| GET | `/api/overlays/active-events` | `handleGetActiveEvents` | GET /api/overlays/active-events — Live events endpoint for OBS overlays |
| GET | `/api/quests/daily` | `handleGetDailyQuests` | GET /api/quests/daily — Get today's quests and viewer progress |
| POST | `/api/quests/claim` | `handleClaimQuestReward` | POST /api/quests/claim — Viewer claims reward for completed quest |
| POST | `/api/quests/progress` | `handleTrackQuestProgress` | POST /api/quests/progress — Track activity progress for viewer |
| GET | `/api/duels/active` | `handleGetDuels` | GET /api/duels/active — List active and recent duels |
| POST | `/api/duels/create` | `handleCreateDuel` | POST /api/duels/create — Create a 1v1 duel challenge |
| POST | `/api/duels/:id/accept` | `handleAcceptDuel` | POST /api/duels/:id/accept — Target accepts duel; execute provably fair roll |
| POST | `/api/duels/:id/decline` | `handleDeclineDuel` | POST /api/duels/:id/decline — Decline or cancel duel challenge |
| GET | `/api/tournaments` | `handleGetTournaments` | GET /api/tournaments — List tournaments for site |
| POST | `/api/tournaments` | `handleCreateTournament` | POST /api/tournaments — Streamer creates a single-elimination tournament bracket |
| POST | `/api/tournaments/:id/score` | `handleUpdateMatchScore` | POST /api/tournaments/:id/score — Streamer updates match score & advances winner |
| GET | `/api/tournaments/:id/bracket` | `handleGetBracket` | GET /api/tournaments/:id/bracket — Get bracket tree for viewer & streamer |
| POST | `/api/tournaments/:id/signups/open` | `handleOpenTournamentSignups` | Tournament & Elimination Brackets Handlers. |
| POST | `/api/tournaments/:id/signups/lock` | `handleLockTournamentSignups` | Tournament & Elimination Brackets Handlers. |
| POST | `/api/tournaments/:id/settings` | `handleUpdateTournamentSettings` | POST /api/tournaments/:id/settings — Update the quiet tournament options. |
| GET | `/api/tournaments/:id/entries` | `handleListTournamentEntries` | GET /api/tournaments/:id/entries — Private, rate-limited streamer entry list. |
| POST | `/api/tournaments/:id/entries` | `handleAddTournamentEntry` | POST /api/tournaments/:id/entries — Add one streamer-sourced entry. |
| POST | `/api/tournaments/:id/entries/:entryId/remove` | `handleRemoveTournamentEntry` | Tournament & Elimination Brackets Handlers. |
| POST | `/api/tournaments/:id/entries/:entryId/block` | `handleBlockTournamentEntry` | Tournament & Elimination Brackets Handlers. |
| POST | `/api/tournaments/:id/entries/:entryId/restore` | `handleRestoreTournamentEntry` | Tournament & Elimination Brackets Handlers. |
| POST | `/api/tournaments/:id/entries/random-pick` | `handleRandomPickTournamentEntries` | Tournament & Elimination Brackets Handlers. |
| GET | `/api/export/raffle-winners.csv` | `handleExportRaffleWinnersCsv` | GET /api/export/raffle-winners.csv — Export raffle winners report |
| GET | `/api/export/drop-claims.csv` | `handleExportDropClaimsCsv` | GET /api/export/drop-claims.csv — Export flash drop claims report |
| GET | `/api/export/predictions.csv` | `handleExportPredictionsCsv` | GET /api/export/predictions.csv — Export predictions & payouts report |
| GET | `/api/credits/status` | `handleCreditsStatus` | Dashboard API for the Kick credits / shop system. |
| POST | `/api/credits/connect` | `handleCreditsConnect` | Dashboard API for the Kick credits / shop system. |
| POST | `/api/credits/rewards/create` | `handleCreditsCreateReward` | Dashboard API for the Kick credits / shop system. |
| POST | `/api/credits/rewards` | `handleCreditsSaveReward` | Dashboard API for the Kick credits / shop system. |
| DELETE | `/api/credits/rewards/:id` | `handleCreditsDeleteReward` | Dashboard API for the Kick credits / shop system. |
| POST | `/api/credits/shop` | `handleCreditsSaveShopItem` | Dashboard API for the Kick credits / shop system. |
| DELETE | `/api/credits/shop/:id` | `handleCreditsDeleteShopItem` | Dashboard API for the Kick credits / shop system. |
| POST | `/api/credits/redemptions/:id` | `handleCreditsUpdateRedemption` | Dashboard API for the Kick credits / shop system. |
| GET | `/api/credits/analytics` | `handleCreditsAnalytics` | Dashboard API for the Kick credits / shop system. |
| GET | `/api/credits/viewer/history` | `handleCreditsViewerHistory` | Cross-board viewer history for a streamer: all of their sites where a given Kick viewer has a site_viewer record, with balances and redemption counts. |
| GET | `/api/credits/activity` | `handleCreditsActivity` | Dashboard API for the Kick credits / shop system. |
| POST | `/api/credits/viewers/:id/balance` | `handleCreditsAdjustBalance` | Streamer-only: add or remove credits from a site viewer with a ledger row. |
| POST | `/api/credits/tip` | `handleCreditsAdjustBalance` | Streamer-only: add or remove credits from a site viewer with a ledger row. |
| GET | `/api/credits/reconcile` | `handleCreditsReconcile` | Reconcile ledger-derived balance against stored site_viewers.balance. |
| POST | `/api/credits/viewers/:id/block` | `handleCreditsBlockViewer` | Block / unblock / flag a viewer for anti-fraud purposes. |
| GET | `/api/public/credits` | `handlePublicCredits` | Public viewer endpoints: shop is public, viewer data is session-only. |
| GET | `/api/viewer/auth/kick` | `handleKickViewerAuthStart` | --- Kick --- |
| GET | `/api/viewer/auth/kick/callback` | `handleKickViewerAuthCallback` | Viewer OAuth login: Kick and Discord. Separate from streamer OAuth so viewers get their own /me dashboard. |
| GET | `/api/viewer/auth/kick/handoff` | `handleKickViewerAuthHandoff` | Viewer OAuth login: Kick and Discord. Separate from streamer OAuth so viewers get their own /me dashboard. |
| GET | `/api/viewer/auth/discord` | `handleDiscordViewerAuthStart` | --- Discord --- |
| GET | `/api/viewer/auth/discord/callback` | `handleDiscordViewerAuthCallback` | Viewer OAuth login: Kick and Discord. Separate from streamer OAuth so viewers get their own /me dashboard. |
| POST | `/api/viewer/logout` | `handleViewerLogout` | --- Logout --- |
| GET | `/api/viewer/me` | `handleViewerMe` | Viewer-facing dashboard API: cross-board credits, per-board shop, and redeem. |
| GET | `/api/viewer/site` | `handleViewerSite` | Viewer-facing dashboard API: cross-board credits, per-board shop, and redeem. |
| POST | `/api/viewer/redeem` | `handleViewerRedeem` | Viewer-facing dashboard API: cross-board credits, per-board shop, and redeem. |
| POST | `/api/viewer/export` | `handleCreateViewerExportJob` |  |
| GET | `/api/viewer/export/:id/status` | `handleViewerExportStatus` |  |
| GET | `/api/viewer/export/:id/download` | `handleViewerExportDownload` |  |
| POST | `/api/credits/viewer-auth` | `handleCreditsViewerAuth` | Dashboard API for the Kick credits / shop system. |
| GET | `/api/games/config` | `handleGamesConfig` | GET /api/games/config?slug= |
| POST | `/api/games/bet` | `handleGamesBet` | POST /api/games/bet |
| POST | `/api/games/mines/reveal` | `handleGamesMinesReveal` | POST /api/games/mines/reveal |
| POST | `/api/games/mines/cashout` | `handleGamesMinesCashout` | POST /api/games/mines/cashout |
| GET | `/api/games/history` | `handleGamesHistory` | GET /api/games/history?slug=&limit= |
| GET | `/api/games/fairness` | `handleGamesFairness` | GET /api/games/fairness?slug= |
| POST | `/api/games/fairness/rotate` | `handleGamesFairnessRotate` | POST /api/games/fairness/rotate |
| GET | `/api/docs` | `handleApiDocs` | Public API documentation handlers Serves an OpenAPI 3.1 JSON spec for the public leaderboard API. |
| GET | `/api/openapi.json` | `handleOpenApiJson` | Public API documentation handlers Serves an OpenAPI 3.1 JSON spec for the public leaderboard API. |
| GET | `/api/public/:slug/standings` | `handlePublicStandings` | Handle GET /api/public/:slug/standings Returns full standings JSON for embedding / Telegram bot queries |
| GET | `/api/public/:slug/players` | `handlePublicPlayers` | Handle GET /api/public/:slug/players Returns lightweight players-only endpoint for live polling |
| GET | `/api/public/:slug/stream` | `handlePublicStream` | Handle GET /api/public/:slug/stream Server-Sent Events for live leaderboard updates (replaces 30s polling). |
| GET | `/api/public/:slug/rank` | `handlePublicRank` | Handle GET /api/public/:slug/rank?user=X Returns plain-text rank lookup for Nightbot / Streamlabs custom commands |
| GET | `/api/public/:slug/stats` | `handlePublicStats` | Handle GET /api/public/:slug/stats Public stats page for publishers/streamers to share. Returns summary counts and a 14-day views series. |
| GET | `/api/public/:slug` | `handlePublicData` | Handle GET /api/public/:slug (generic endpoint) Returns the full leaderboard data as JSON |
| GET | `/api/referrals` | `handleReferrals` | Referral dashboard API: returns the authenticated user's referral link and stats. |
| POST | `/api/billing/checkout` | `handleCheckout` | Billing routes |
| POST | `/api/billing/checkout-lifetime` | `handleCheckoutLifetime` |  |
| GET | `/api/billing/pending` | `handlePendingPayment` |  |
| POST | `/api/billing/trial` | `handleTrial` | POST /api/billing/trial — start a free 7-day Pro trial (one-time per user). |
| POST | `/api/billing/cancel` | `handleCancel` |  |
| GET | `/api/account/payments` | `handleUserPayments` |  |
| GET | `/api/account/usage` | `handleAccountUsage` |  |
| POST | `/api/billing/ipn` | `handleIpn` |  |
| GET | `/api/account/postbacks` | `handleAccountPostbacks` | GET /api/account/postbacks |
| POST | `/api/account/postbacks/rotate` | `handleAccountPostbacksRotate` | POST /api/account/postbacks/rotate |
| DELETE | `/api/account/postbacks` | `handleAccountPostbacksRevoke` | DELETE /api/account/postbacks |
| POST | `/api/account/postbacks/test` | `handleAccountPostbacksTest` | POST /api/account/postbacks/test |
| GET | `/api/account/conversions` | `handleAccountConversions` | GET /api/account/conversions |
| GET | `/api/account/connected-accounts` | `handleAccountConnectedAccounts` | GET /api/account/connected-accounts |
| GET | `/api/attribution` | `handleAttribution` | GET /api/attribution — per-offer clicks, conversions, revenue, and postback URL. |
| GET | `/api/attribution/export` | `handleAttributionExport` | GET /api/attribution/export — CSV download of the same data. |
| POST | `/api/attribution/rotate-key` | `handleRotatePostbackKey` | POST /api/attribution/rotate-key — create a new postback key and revoke active ones. |
| DELETE | `/api/attribution/postback-key` | `handleRevokePostbackKey` | DELETE /api/attribution/postback-key — revoke all active postback keys. |
| POST | `/api/postback` | `handlePostback` | POST /api/postback — receive casino conversion postbacks. |
| POST | `/api/csp-report` | `handleCspReport` | POST /api/csp-report Receives CSP violation reports from browsers. Logs structured JSON for monitoring/alerting. |
| POST | `/api/log` | `handleLog` | Client-side error / log ingestion endpoint. Dashboard JS posts here so client errors are correlated with server logs, Sentry, and the original request ID. |
| GET | `/api/health/backup` | `handleBackupHealth` | Backup health and verification recording. |
| GET | `/api/admin/backup-verifications` | `handleListBackupVerifications` | Backup health and verification recording. |
| POST | `/api/admin/backup-verifications` | `handleRecordBackupVerification` | Backup health and verification recording. |
| GET | `/api/admin/overview` | `handleOverview` |  |
| GET | `/api/admin/users` | `handleUsers` |  |
| GET | `/api/admin/leads` | `handleLeads` |  |
| GET | `/api/admin/payments` | `handlePayments` |  |
| GET | `/api/admin/support` | `handleSupportMessages` |  |
| POST | `/api/admin/support/reply` | `handleSupportReply` |  |
| GET | `/api/admin/audit` | `handleAudit` |  |
| POST | `/api/admin/action` | `handleAction` |  |
| GET | `/api/admin/features` | `handleFeatureFlags` |  |
| POST | `/api/admin/features` | `handleFeatureFlags` |  |
| POST | `/api/admin/features/override` | `handleFeatureFlagOverride` |  |
| GET | `/api/admin/identity` | `handleGetIdentity` |  |
| PUT | `/api/admin/identity` | `handleUpdateIdentity` |  |
| POST | `/api/admin/2fa/enable` | `handle2faEnable` |  |
| POST | `/api/admin/2fa/verify` | `handle2faVerify` |  |
| POST | `/api/admin/2fa/recovery` | `handle2faRecovery` |  |
| GET | `/api/admin/2fa/status` | `handle2faStatus` |  |
| POST | `/api/admin/2fa/disable` | `handle2faDisable` |  |


### 2.2 Leaderboard Worker page routing

**Marketing / auth / utility exact paths**

| Exact path |
| --- |
| `/account` |
| `/account.html` |
| `/admin` |
| `/contact` |
| `/contact.html` |
| `/cookies` |
| `/cookies.html` |
| `/dashboard/_content` |
| `/dashboard/attribution` |
| `/dashboard/audience` |
| `/dashboard/audience/activity` |
| `/dashboard/audience/members` |
| `/dashboard/audience/viewers` |
| `/dashboard/billing` |
| `/dashboard/credits` |
| `/dashboard/giveaways` |
| `/dashboard/giveaways/preds` |
| `/dashboard/integrations` |
| `/dashboard/manage` |
| `/dashboard/preview` |
| `/dashboard/rewards` |
| `/dashboard/security` |
| `/dashboard/settings` |
| `/dashboard/settings/board` |
| `/dashboard/settings/integrations` |
| `/dashboard/settings/plan` |
| `/dashboard/setup` |
| `/dashboard/site/connections` |
| `/dashboard/support` |
| `/demo` |
| `/embed` |
| `/faq.html` |
| `/favicon.ico` |
| `/forgot` |
| `/hall-of-fame` |
| `/health` |
| `/help` |
| `/help.html` |
| `/login` |
| `/login.html` |
| `/logout` |
| `/logout.html` |
| `/me` |
| `/me.html` |
| `/og.png` |
| `/password` |
| `/pricing.html` |
| `/privacy` |
| `/profile` |
| `/refund` |
| `/reset` |
| `/responsible` |
| `/reviews` |
| `/reviews.html` |
| `/robots.txt` |
| `/setup` |
| `/signup` |
| `/signup.html` |
| `/sitemap.xml` |
| `/terms` |
| `/verify-email` |
| `/verify-email.html` |
| `/webhooks/kick` |

**Prefix / wildcard paths**

| Prefix / pattern |
| --- |
| `/_next/` |
| `/account/` |
| `/api/` |
| `/assets/` |
| `/auth/` |
| `/brand/` |
| `/dashboard/` |
| `/dashboard/giveaways/` |
| `/dashboard/rewards/` |
| `/demo/` |
| `/go/` |
| `/help/` |
| `/logo/` |
| `/overlay/` |
| `/player/` |
| `/ref/` |

**Dynamic / per-site route categories**

| Route category |
| --- |
| custom domain resolution |
| branded site sections (custom domain): /, /leaderboard, /shop, /games, /me |
| static assets |
| SEO endpoints |
| health check |
| helper for rendering strings or JSX pages |
| pages |
| streamer logos (uploaded via dashboard, served as real images) |
| API routing |
| /setup → /dashboard redirect (legacy bookmark fixup) |
| permanent demo leaderboard (always works, no DB needed) |
| tracked Join redirect: /go/<slug> → streamer's referral URL |
| referral redirect: /ref/<code> → /signup?ref=<code> |
| OBS overlay: /<slug>/overlay |
| per-site Hall of Fame at /<slug>/hall-of-fame |
| embed widget: /<slug>/embed |
| per-site legal pages at /<slug>/<legal> |
| per-player profile pages at /<slug>/player/<name> |
| streamer profile pages at /<slug>/profile |
| legacy public credits URL: the new shell's Shop is the canonical page |
| password unlock submission for public boards |
| branded site sections: /<slug>, /<slug>/leaderboard, /shop, /games, /me |
| public leaderboard at /<slug> |

**Branded site sections (/<slug> and custom domains)**

| Section |
| --- |
| home |
| leaderboard |
| shop |
| games |
| me |


### 2.3 Page components

| Page key | Export |
| --- | --- |
| `docs` | `docsPage` |
| `login` | `loginPage` |
| `forgot` | `forgotPage` |
| `reset` | `resetPage` |
| `signup` | `signupPage` |
| `dashboard` | `dashboardPage` |
| `dashboardNotFound` | `dashboardNotFoundPage` |
| `giveaways` | `giveawaysPage` |
| `admin` | `adminPage` |
| `admin2fa` | `admin2faPage` |
| `overlay` | `overlayPage` |
| `terms` | `termsPage` |
| `privacy` | `privacyPage` |
| `responsible` | `responsiblePage` |
| `refund` | `refundPage` |
| `cookies` | `cookiesPage` |
| `helpSupport` | `helpSupportPage` |
| `helpFeedback` | `helpFeedbackPage` |
| `helpHub` | `helpHubPage` |
| `rewardsChannel` | `rewardsChannelPage` |
| `rewardsOverview` | `rewardsOverviewPage` |
| `rewardsRules` | `rewardsRulesPage` |
| `rewardsShop` | `rewardsShopPage` |
| `audienceMembers` | `audienceMembersPage` |
| `rewardsRedemptions` | `rewardsRedemptionsPage` |
| `rewardsHistory` | `rewardsHistoryPage` |
| `settingsUnified` | `settingsUnifiedPage` |
| `faq` | `faqPage` |
| `reviews` | `reviewsPage` |
| `invite` | `invitePage` |


### 2.4 Page file inventory


#### `apps/leaderboard/src/pages/account-pages.js`

Purpose: Account page bodies, one directly-authored template per tab. The surrounding chrome (sidebar, topbar, titles) lives in account.jsx.

Forms=0, Buttons=23, IDs=93, data-attrs=1, Inputs=0, Selects=0, Links=2

- IDs: `accChangePassword`, `accCurrentPassword`, `accExportData`, `accExportStatus`, `accNewPassword`, `accPasswordStatus`, `accRevokeSessions`, `accSessions`, `accSessionsStatus`, `accSignOut`, `accountDangerTitle`, `accountExportTitle`, `btnCloseInviteModal`, `btnCopyInviteLink`, `btnOpenInviteModal`, `btnSendInvite`, `cancelBtn`, `cancelStatus`, `cancelWrap`, `connected`, `connectedAccounts`, `conversionsBody`, `conversionsEmpty`, `conversionsTable`, `data`, `deleteAccountBtn`, `deleteAccountCancelBtn`, `deleteAccountConfirm`, `deleteAccountConfirmBtn`, `deleteAccountModal`, `deleteAccountModalDescription`, `deleteAccountModalStatus`, `deleteAccountModalTitle`, `deleteAccountPassword`, `deleteAccountPasswordWrap`, `historyBody`, `historyCard`, `historyEmpty`, `historyTable`, `inviteEmail` (+53)

- data-attrs: `data-data-pwd-toggle`

- Links: `#`, `/dashboard/settings/billing`


#### `apps/leaderboard/src/pages/account.jsx`

Forms=0, Buttons=0, IDs=2, data-attrs=1, Inputs=0, Selects=0, Links=3

- IDs: `acc-app`, `connectedAccounts`

- data-attrs: `data-data-acc-tab`

- Links: `/dashboard/site/connections`, `/dashboard/site?tab=danger`, `/help/support?area=account`


#### `apps/leaderboard/src/pages/admin-2fa.js`

Purpose: admin2fa page

Forms=0, Buttons=4, IDs=21, data-attrs=0, Inputs=0, Selects=0, Links=3

- IDs: `logout`, `main-content`, `tfaBackToCode`, `tfaCode`, `tfaDone`, `tfaErr`, `tfaQr`, `tfaRecovery`, `tfaRecoveryCode`, `tfaRecoveryErr`, `tfaRecoveryList`, `tfaRecoverySubmit`, `tfaSecret`, `tfaSetup`, `tfaSetupCode`, `tfaSetupErr`, `tfaSetupSubmit`, `tfaSubmit`, `tfaSuccess`, `tfaUseRecovery`, `tfaVerify`

- Links: `#`, `#main-content`, `/dashboard`


#### `apps/leaderboard/src/pages/admin.js`

Purpose: admin page

Forms=2, Buttons=11, IDs=64, data-attrs=1, Inputs=0, Selects=0, Links=3

- IDs: `auditBody`, `auditEmpty`, `auditPagination`, `featuresBody`, `featuresEmpty`, `featuresStatus`, `i_affiliate_disclosure`, `i_company_country`, `i_company_name`, `i_company_number`, `i_support_email`, `identityCard`, `identityForm`, `identityStatus`, `leadsBody`, `leadsEmpty`, `leadsPagination`, `loading`, `logout`, `main-content`, `panel`, `payBody`, `payEmpty`, `payPagination`, `replyCancel`, `replyForm`, `replyId`, `replyMessage`, `replyStatus`, `replySubject`, `replyText`, `replyToEmail`, `s_leads`, `s_pro`, `s_rev`, `s_users`, `status`, `supportBody`, `supportEmpty`, `supportFilter` (+24)

- data-attrs: `data-data-tab`

- Links: `#`, `#main-content`, `/dashboard`


#### `apps/leaderboard/src/pages/audience.jsx`

Forms=0, Buttons=0, IDs=3, data-attrs=1, Inputs=0, Selects=0, Links=1

- IDs: `cr-app`, `cr-empty`, `cr-loading`

- data-attrs: `data-data-cr-tab`

- Links: `/dashboard/analytics`


#### `apps/leaderboard/src/pages/cookies.js`

Forms=0, Buttons=0, IDs=0, data-attrs=0, Inputs=0, Selects=0, Links=1

- Links: `mailto:{{SUPPORT_EMAIL}}`


#### `apps/leaderboard/src/pages/credits-pages.js`

Forms=7, Buttons=20, IDs=123, data-attrs=1, Inputs=17, Selects=0, Links=5

- IDs: `cr-add-mapping`, `cr-analytics`, `cr-analytics-days`, `cr-analytics-days-label`, `cr-analytics-status`, `cr-channel`, `cr-channel-chip`, `cr-channel-connect`, `cr-channel-connect-wrap`, `cr-channel-connected`, `cr-channel-disconnect`, `cr-channel-form`, `cr-channel-id`, `cr-channel-id-input`, `cr-channel-linked`, `cr-channel-live`, `cr-channel-name`, `cr-channel-name-input`, `cr-channel-reconnect`, `cr-channel-status`, `cr-channel-submit`, `cr-channel-token`, `cr-credits-by-day`, `cr-credits-by-day-empty`, `cr-fulfilled-counter`, `cr-history`, `cr-history-empty`, `cr-history-feed-empty`, `cr-history-feed-list`, `cr-history-form`, `cr-history-list`, `cr-history-load-more`, `cr-history-search`, `cr-history-status`, `cr-history-summary`, `cr-history-type`, `cr-history-username`, `cr-mapping-foot`, `cr-mapping-toolbar`, `cr-onboarding` (+83)

- data-attrs: `data-data-amount`

- Inputs: `active`, `amount`, `backgroundColor`, `cost`, `credits`, `description`, `discord`, `externalId`, `kick`, `kickRewardCost`, `kickRewardId`, `kickRewardTitle`, `name`, `reason`, `stock`, `title`, `username`

- Links: `/auth/kick`, `/dashboard/rewards/rules`, `/dashboard/rewards/rules#cr-reward-create-form`, `/dashboard/rewards/shop`, `/dashboard/site/connections`


#### `apps/leaderboard/src/pages/dashboard-shell.jsx`

Forms=0, Buttons=5, IDs=12, data-attrs=2, Inputs=0, Selects=0, Links=2

- IDs: `lbMenu`, `lbPublishLabel`, `lbSide`, `lbTopbar`, `lbTopbarDraft`, `lbTopbarStatus`, `liveLink`, `pubToggle`, `publishAction`, `sidebarBoardSelect`, `status`, `topbarCmdTrigger`

- data-attrs: `data-data-auth-workspace`, `data-data-identity`

- Links: `#`, `/dashboard`


#### `apps/leaderboard/src/pages/dashboard.jsx`

Forms=0, Buttons=74, IDs=311, data-attrs=15, Inputs=0, Selects=0, Links=25

- IDs: `a_clear`, `a_go`, `a_label`, `addRow`, `apiAccess`, `apiAccessDetails`, `applyCustomColors`, `archEmpty`, `archList`, `boardLimitCta`, `boardLimitText`, `boardLimitTitle`, `boardLimitUpsell`, `boardsBody`, `boardsEmpty`, `boardsSearch`, `brandBody`, `brandCard`, `brandLock`, `brandUpgrade`, `bulkActions`, `bulkClearWager`, `bulkCount`, `bulkDelete`, `c_a`, `c_b`, `colDropdownBtn`, `colMenu`, `colorPresets`, `colorsReset`, `csvExportBtn`, `csvFileInput`, `csvImportBtn`, `csvTemplateBtn`, `designPreview`, `discard`, `domainBody`, `domainBuyCard`, `domainConnectCard`, `domainDisconnectBtn` (+271)

- data-attrs: `data-data-col`, `data-data-device`, `data-data-egroup`, `data-data-field-error`, `data-data-field-warning`, `data-data-jump`, `data-data-page`, `data-data-perf-panel`, `data-data-perf-tab`, `data-data-preview-game`, `data-data-range`, `data-data-settings-panel`, `data-data-settings-tab`, `data-data-template`, `data-data-width`

- Links: `#`, `#quickAdd`, `/api/site/stats/export`, `/dashboard`, `/dashboard/analytics/activity`, `/dashboard/analytics/events`, `/dashboard/analytics/referrals`, `/dashboard/giveaways`, `/dashboard/leaderboard/design`, `/dashboard/leaderboard/players`, `/dashboard/leaderboard/setup`, `/dashboard/leaderboard/share`, `/dashboard/leaderboards`, `/dashboard/rewards/redemptions`, `/dashboard/settings`, `/dashboard/settings/account`, `/dashboard/settings/billing?from=branding`, `/dashboard/settings/billing?from=domain`, `/dashboard/settings/billing?from=notifications`, `/dashboard/settings/billing?from=overlay`


#### `apps/leaderboard/src/pages/docs.js`

Purpose: Public API documentation page

Forms=0, Buttons=0, IDs=9, data-attrs=0, Inputs=0, Selects=0, Links=13

- IDs: `authentication`, `base-url`, `chat-bots`, `endpoints`, `examples`, `getting-started`, `main-content`, `openapi`, `postbacks`

- Links: `#authentication`, `#chat-bots`, `#endpoints`, `#examples`, `#getting-started`, `#main-content`, `#openapi`, `#postbacks`, `/`, `/api/openapi.json`, `/login`, `/privacy`, `/terms`


#### `apps/leaderboard/src/pages/faq.js`

Purpose: FAQ page — answer-engine optimization (FAQPage schema)

Forms=0, Buttons=1, IDs=1, data-attrs=1, Inputs=0, Selects=0, Links=7

- IDs: `main-content`

- data-attrs: `data-data-identity`

- Links: `#main-content`, `/`, `/#products`, `/help/support`, `/login`, `/pricing`, `/signup`


#### `apps/leaderboard/src/pages/forgot.js`

Purpose: forgot page

Forms=1, Buttons=1, IDs=6, data-attrs=0, Inputs=1, Selects=0, Links=2

- IDs: `email`, `err`, `form`, `main-content`, `msg`, `submit`

- Inputs: `email`

- Links: `#main-content`, `/login`


#### `apps/leaderboard/src/pages/giveaway-pages.js`

Purpose: Markup for Giveaways & Community Events Hub (Chat Giveaways, Ticket Raffles, Flash Code Drops)

Forms=5, Buttons=55, IDs=165, data-attrs=4, Inputs=7, Selects=1, Links=1

- IDs: `btn-create-drop`, `btn-create-pred`, `btn-create-raffle`, `btn-open-event-drawer`, `cd-active-list`, `cd-btn-random`, `cd-cancel`, `cd-code`, `cd-drawer`, `cd-drawer-close`, `cd-drawer-title`, `cd-empty-active`, `cd-expire`, `cd-form`, `cd-max`, `cd-past-list`, `cd-points`, `cd-status`, `cd-submit`, `gw-btn-copy-winner`, `gw-btn-export`, `gw-btn-listen`, `gw-btn-reroll`, `gw-btn-reset`, `gw-btn-roll`, `gw-channel-input`, `gw-chat-feed`, `gw-claim-box`, `gw-claim-countdown`, `gw-claim-dot`, `gw-claim-fill`, `gw-claim-status`, `gw-count-header`, `gw-custom-rule-text`, `gw-entrants-card`, `gw-entrants-empty`, `gw-entrants-list`, `gw-feed-card`, `gw-feed-counter`, `gw-feed-empty` (+125)

- data-attrs: `data-data-field-error`, `data-data-tab`, `data-data-target`, `data-data-val`

- Inputs: `antiAltEnabled`, `channel`, `entryCap`, `entryKeyword`, `gameName`, `keyword`, `title`

- Selects: `format`

- Links: `${giveawayPath(tab)}`


#### `apps/leaderboard/src/pages/giveaways.jsx`

Forms=0, Buttons=0, IDs=1, data-attrs=0, Inputs=0, Selects=0, Links=0

- IDs: `gw-app`


#### `apps/leaderboard/src/pages/help.js`

Forms=1, Buttons=1, IDs=20, data-attrs=0, Inputs=5, Selects=0, Links=24

- IDs: `${id}`, `${introId}`, `${titleId}`, `c_back`, `c_back_wrap`, `c_context`, `c_email`, `c_err`, `c_kind`, `c_message`, `c_name`, `c_subject`, `c_submit`, `c_success`, `contactForm`, `help-account`, `help-credits`, `help-hub`, `help-site`, `help-telegram`

- Inputs: `context`, `email`, `kind`, `name`, `subject`

- Links: `${tab.href}`, `/`, `/dashboard/audience/members`, `/dashboard/leaderboard/design`, `/dashboard/leaderboard/players`, `/dashboard/leaderboard/setup`, `/dashboard/leaderboard/share`, `/dashboard/rewards/activity`, `/dashboard/rewards/redemptions`, `/dashboard/rewards/rules`, `/dashboard/rewards/shop`, `/dashboard/settings/account`, `/dashboard/settings/billing`, `/dashboard/settings/connections`, `/dashboard/settings/data`, `/dashboard/site`, `/dashboard/site/connections`, `/dashboard/telegram/bots`, `/dashboard/telegram/broadcasts`, `/dashboard/telegram/commands`


#### `apps/leaderboard/src/pages/invite.jsx`

Forms=0, Buttons=1, IDs=1, data-attrs=0, Inputs=0, Selects=0, Links=1

- IDs: `btnAcceptInvite`

- Links: `/dashboard`


#### `apps/leaderboard/src/pages/legal-helper.js`

Purpose: Shared legal page shell helper NOTE: fill in company identity from Dashboard → Admin → Identity before going live.

Forms=0, Buttons=0, IDs=1, data-attrs=0, Inputs=0, Selects=0, Links=14

- IDs: `main-content`

- Links: `#main-content`, `/`, `/#how`, `/cookies`, `/docs`, `/help/support`, `/login`, `/pricing`, `/privacy`, `/refund`, `/responsible`, `/signup`, `/terms`, `mailto:{{SUPPORT_EMAIL}}`


#### `apps/leaderboard/src/pages/login.jsx`

Forms=1, Buttons=2, IDs=8, data-attrs=1, Inputs=2, Selects=0, Links=5

- IDs: `email`, `email-err`, `err`, `form`, `main-content`, `password`, `password-err`, `submit`

- data-attrs: `data-data-field-err`

- Inputs: `email`, `password`

- Links: `#main-content`, `/`, `/forgot`, `/me`, `/signup`


#### `apps/leaderboard/src/pages/overlay.js`

Purpose: overlay page

Forms=0, Buttons=0, IDs=3, data-attrs=7, Inputs=0, Selects=0, Links=0

- IDs: `ov-config`, `ov-count`, `ov-players`

- data-attrs: `data-data-json`, `data-data-layout`, `data-data-name`, `data-data-slug`, `data-data-sponsor`, `data-data-sponsor-url`, `data-data-theme`


#### `apps/leaderboard/src/pages/privacy.js`

Forms=0, Buttons=0, IDs=0, data-attrs=0, Inputs=0, Selects=0, Links=2

- Links: `/dashboard/settings`, `mailto:{{SUPPORT_EMAIL}}`


#### `apps/leaderboard/src/pages/refund.js`

Forms=0, Buttons=0, IDs=0, data-attrs=0, Inputs=0, Selects=0, Links=3

- Links: `/dashboard/settings`, `/help/support`, `mailto:{{SUPPORT_EMAIL}}`


#### `apps/leaderboard/src/pages/reset.js`

Purpose: reset page

Forms=1, Buttons=2, IDs=8, data-attrs=2, Inputs=1, Selects=0, Links=2

- IDs: `err`, `form`, `main-content`, `password`, `password-err`, `pw-hint`, `pwReqs`, `submit`

- data-attrs: `data-data-field-err`, `data-data-req`

- Inputs: `password`

- Links: `#main-content`, `/login`


#### `apps/leaderboard/src/pages/responsible.js`

Forms=0, Buttons=0, IDs=0, data-attrs=0, Inputs=0, Selects=0, Links=6

- Links: `https://www.begambleaware.org`, `https://www.connexontario.ca`, `https://www.gamblersanonymous.org`, `https://www.gamblingtherapy.org`, `https://www.gamcare.org.uk`, `https://www.loketkansspel.nl`


#### `apps/leaderboard/src/pages/reviews.js`

Purpose: Reviews / Google Business Profile page

Forms=0, Buttons=1, IDs=3, data-attrs=1, Inputs=0, Selects=0, Links=9

- IDs: `gbp-photo`, `gbp-review`, `main-content`

- data-attrs: `data-data-identity`

- Links: `#main-content`, `/`, `/#products`, `/faq`, `/help/support`, `/login`, `/pricing`, `/signup`, `{{GBP_REVIEW_URL}}`


#### `apps/leaderboard/src/pages/rewards.jsx`

Forms=0, Buttons=0, IDs=3, data-attrs=0, Inputs=0, Selects=0, Links=0

- IDs: `cr-app`, `cr-empty`, `cr-loading`


#### `apps/leaderboard/src/pages/signup.js`

Purpose: signup page

Forms=1, Buttons=2, IDs=18, data-attrs=2, Inputs=4, Selects=0, Links=4

- IDs: `email`, `email-err`, `email-tip`, `err`, `form`, `main-content`, `name`, `name-err`, `password`, `password-err`, `planBanner`, `pw-hint`, `pwMeter`, `pwReqs`, `slug`, `slug-err`, `slugPreview`, `submit`

- data-attrs: `data-data-field-err`, `data-data-req`

- Inputs: `email`, `name`, `password`, `slug`

- Links: `#main-content`, `/`, `/login`, `/me`


#### `apps/leaderboard/src/pages/terms.js`

Forms=0, Buttons=0, IDs=0, data-attrs=0, Inputs=0, Selects=0, Links=2

- Links: `/refund`, `mailto:{{SUPPORT_EMAIL}}`


#### `apps/leaderboard/src/pages/verify-email.js`

Purpose: email verification landing page The {{VERIFY_*}} placeholders are filled server-side so verification never depends on client JavaScript running.

Forms=0, Buttons=1, IDs=5, data-attrs=0, Inputs=0, Selects=0, Links=2

- IDs: `err`, `main-content`, `msg`, `resendBtn`, `resendWrap`

- Links: `#main-content`, `/login`


#### `apps/leaderboard/src/pages/viewer-dashboard.js`

Forms=0, Buttons=4, IDs=36, data-attrs=0, Inputs=0, Selects=0, Links=3

- IDs: `main-content`, `vd-avatar`, `vd-back`, `vd-boards`, `vd-boards-card`, `vd-boards-empty`, `vd-drop-claim`, `vd-drop-claim-btn`, `vd-drop-code`, `vd-drop-status`, `vd-earn-hint`, `vd-events-empty`, `vd-events-status`, `vd-identity`, `vd-loading`, `vd-login-card`, `vd-login-discord`, `vd-login-kick`, `vd-login-status`, `vd-logout`, `vd-nav`, `vd-predictions`, `vd-profile`, `vd-raffles`, `vd-redemptions-empty`, `vd-redemptions-list`, `vd-shop-empty`, `vd-shop-list`, `vd-site-balance`, `vd-site-card`, `vd-site-name`, `vd-site-streamer`, `vd-switch`, `vd-title`, `vd-username`, `vd-wrong-account`

- Links: `/`, `/api/viewer/auth/discord`, `/api/viewer/auth/kick`


### 2.5 Bot Worker

| Method | Path | Group note |
| --- | --- | --- |
| GET | `/bot/health` | Health check — reachable at /bot/health (Cloudflare routes /bot/* to this Worker) |
| POST | `/hook/:secret` | ================================================================= 1) TELEGRAM WEBHOOK — one endpoint for ALL bots ================================================================= |
| GET | `/r/:slug` | ================================================================= 2) TRACKED REDIRECT ================================================================= |
| POST | `/pb` | ================================================================= 2b) CASINO POSTBACKS Two equivalent paths to the same recordConversion(): - SIGNED (preferred): POST /pb X-Postback-Key: <postback_key> X-Postback-Signature: <hex HMAC-SHA256 of the raw query string, keyed by the postback_key> ?event=deposit&amount=50&click_ref=x The key never rides the URL (no access-log/Referer leakage) and the HMAC means a logged/intercepted request can't be forged or replayed with new params. Use this once your affiliate networks support it. - LEGACY (still works, for casinos already configured): GET\|POST /pb/:key?event=deposit&amount=50&click_ref=x — key in the URL path. Rate-limited per key + amount clamped; no signature. Safe to keep until every integration migrates, then deprecate. ================================================================= |
| GET|POST | `/pb/:key` | LEGACY path — key in the URL, unsigned. Kept for integrations already calling GET /pb/:key. See the signed POST /pb above for the upgrade path. DEPRECATED: migrate to POST /pb with X-Postback-Key + X-Postback-Signature. |
| POST | `/users` |  |
| POST | `/bots` |  |
| POST | `/offers` |  |
| GET | `/stats` |  |
| GET | `/dlq` |  |
| POST | `/dlq/replay` |  |
| POST | `/reencrypt` | POST /api/reencrypt — re-encrypt all bot tokens with the current key. Used after a TOKEN_ENC_KEY rotation: old tokens (legacy or old version prefix) are decrypted with the old key and re-encrypted with the current one (producing a fresh "v1:" prefix). |
| GET | `/bot` |  |
| GET | `/me` |  |
| GET | `/offers` |  |
| POST | `/offers` |  |
| PATCH | `/offers/:id` |  |
| GET | `/stats/daily` |  |
| GET | `/stats/subscribers` | Subscriber totals + deep-link attribution (where subscribers came from). |
| GET | `/bots` |  |
| GET | `/bots/:id/health` | Returns the bot's current webhook status from Telegram. Useful for diagnosing why a connected bot isn't receiving messages. |
| POST | `/bots/:id/disconnect` | Disconnect a bot: remove its Telegram webhook and mark it revoked so the hook endpoint stops accepting updates. This frees the bot plan slot and lets the user reconnect or switch to a different bot later. |
| POST | `/bots/:id/sync-commands` | Manually re-sync a bot's Telegram command menu (custom + built-in commands). Updates the bot's last_command_sync_at on success. |
| POST | `/bots/:id/reconnect` | One-click reconnect: re-register the stored webhook with Telegram. Useful when the dashboard shows the bot disconnected or after a webhook failure during the initial token setup. |
| DELETE | `/bots/:id` | Permanently delete a bot. Remove the webhook first so Telegram stops sending updates to a secret that no longer exists in our DB. |
| POST | `/bots/:id/test-message` | Send a test DM to verify the bot token works and the user can receive it. |
| POST | `/bots` |  |
| PATCH | `/bots/:id` | Update a bot's welcome message (the /start reply). Empty clears it back to the engine's default greeting. |
| GET | `/bots/:id/commands` | List a bot's custom commands. |
| POST | `/bots/:id/commands` | Create or replace a custom command (upsert on the (bot_id, command) unique key). |
| PATCH | `/commands/:id` | Toggle or edit a command. Ownership is enforced by joining bots.owner_id. |
| DELETE | `/commands/:id` | Delete a command. |
| GET | `/plan` | ---- plan & billing ---- |
| GET | `/broadcasts` | ---- broadcasts ---- |
| GET | `/broadcasts/audience` | How many subscribers a broadcast would reach (active, non-blocked), so the UI can warn before sending to the whole list. |
| POST | `/broadcasts` |  |
| DELETE | `/broadcasts/:id` | Cancel a scheduled broadcast. Already sent/delivered broadcasts can't be canceled; the cron processor will skip rows with status = 'canceled'. |
| POST | `/postback-key` | ---- postbacks ---- |
| POST | `/postback-key/rotate` |  |
| DELETE | `/postback-key` |  |
| GET | `/postback-status` | Status-only view for Bot Settings; full management lives in /dashboard/settings/connections. |
| GET | `/conversions` |  |


### 2.6 Bot dashboard pages

| Path |
| --- |
| `/bots` |
| `/offers` |
| `/commands` |
| `/broadcasts` |
| `/settings` |


### 2.7 Monitor Worker

| Path |
| --- |
| `/health` |
| `/check` |


### 2.8 Next.js marketing app

| Route | File |
| --- | --- |
| `/about` | about/page.tsx |
| `/brand` | brand/page.tsx |
| `/changelog` | changelog/page.tsx |
| `/credits` | credits/page.tsx |
| `/docs` | docs/page.tsx |
| `/faq` | faq/page.tsx |
| `/games` | games/page.tsx |
| `/overlays` | overlays/page.tsx |
| `/` | page.tsx |
| `/pricing` | pricing/page.tsx |
| `/sites` | sites/page.tsx |
| `/status` | status/page.tsx |
| `/switch` | switch/page.tsx |
| `/telegram` | telegram/page.tsx |


## 3. Dashboard SPA structure


### 3.1 Core SPA sections

| Key | Path | Title | Tabs |
| --- | --- | --- | --- |
| `home` | `/dashboard` | Home |  |
| `board` | `/dashboard/leaderboard` | Leaderboard |  |
| `boards` | `/dashboard/leaderboards` | Sites |  |
| `games` | `/dashboard/games` | Games |  |
| `performance` | `/dashboard/analytics` | Analytics |  |
| `site` | `/dashboard/site` | Site settings |  |


### 3.2 Dynamic / fragment-loaded sections

| Key | Boot module | Nav key | Board context | Tabs |
| --- | --- | --- | --- | --- |
| `rewards` | `credits` | redemptions | selector | overview,shop,rules,redemptions,history |
| `siteConnections` | `credits` | site | selector | channel |
| `giveaways` | `giveaways` | engage | selector | chat,raffles,drops,preds,tournaments |
| `audience` | `credits` | audience | selector | viewers |
| `settings` | `account` | settings | none | account,team,plan,connections,data |


### 3.3 Dashboard rail navigation

| Key | Label | Href |
| --- | --- | --- |
| home | Home | /dashboard |
| sites | Sites | /dashboard/leaderboards |
| site-scope | Current site | /dashboard/leaderboard |
| engage | Engagement | /dashboard/giveaways |
| games | Games | /dashboard/games |
| redemptions | Rewards | /dashboard/rewards |
| audience | Audience | /dashboard/audience/members |
| performance | Analytics | /dashboard/analytics |
| site | Site settings | /dashboard/site |
| telegram | Telegram | /dashboard/telegram |
| settings | Account | /dashboard/settings |


## 4. State management & data flows


### 4.1 Dashboard shared store

| State key |
| --- |
| SLUG |
| EXTRA |
| ME |
| ACTIVE_SITE_ID |
| SITE_UPDATED_AT |
| PUBLISHED_AT |
| BOARDS |
| PLAYERS |
| SAVED_PLAYERS |
| SAMPLE_PLAYERS |
| CURRENT_BRANDING |
| PUBLISHED |
| IS_DRAFT |
| RANK_BY |
| STATS_STATUS |
| GIVEAWAYS_STATUS |
| CREDITS_ANALYTICS_STATUS |
| CREDITS_STATUS |
| CREDITS_PRODUCT_ENABLED |
| HEATMAP_STATUS |
| REFERRALS_STATUS |
| USAGE_STATUS |
| SESSIONS_STATUS |
| GAMES_STATUS |
| THEME_SAVING |
| LOGO |
| _dirty |
| pageReqId |

Store API: `createDashboardState()` returns `getState`, `setState`, `subscribe`, `markDirty`, `boardStatus`. Subscribers are notified by changed key; `markDirty` triggers `draft` subscribers.


### 4.2 Cross-app state/data flow

- `@yourrank/shared/session` — signed `yr_session` cookies across `.yourrank.site`.

- `@yourrank/shared/db` — Postgres pool with timeout/reuse handling.

- `yourrank-events` queue → `apps/consumer` for analytics, conversions, notifications, broadcasts.

- `apps/monitor` — synthetic uptime/health checks.


## 5. UI component / element inventory


### 5.1 Leaderboard client JS modules


#### `apps/leaderboard/src/assets/account.js`

- Exports / purpose:

  - `enter` — Persistent-shell lifecycle

  - `leave`

- getElementById: `acc-app`

- $ selector: `accSummaryAvatar`, `accSummaryEmail`, `accSummaryName`, `accSummaryPlan`, `accUserName`, `btnCloseInviteModal`, `btnCopyInviteLink`, `btnOpenInviteModal`, `btnSendInvite`, `connectedAccounts`, `conversionsBody`, `conversionsEmpty`, `conversionsTable`, `inviteEmail`, `inviteLinkInput`, `inviteMemberModal`, `inviteModalStatus`, `inviteResultWrap`, `inviteRole`, `lbSide`, `postbackAdvanced`, `postbackCopyManager`, `postbackKey`, `postbackKeyCard`, `postbackLegacy` (+15)

- data-* refs: `data-close-side`, `data-invite-id`, `data-settings-panel`, `data-settings-tab`, `data-url`, `data-user-id`

- dataset refs: `settingsPanel`, `settingsTab`

- aria-* refs: `aria-selected`

- fetch endpoints: `/api/account/postbacks`

- jsonReq endpoints: `DELETE`, `GET`, `POST`

- Event listeners: click=17, submit=0, change=1


#### `apps/leaderboard/src/assets/admin.js`

- getElementById: `loading`, `panel`

- $ selector: `auditBody`, `auditEmpty`, `featuresBody`, `featuresEmpty`, `i_affiliate_disclosure`, `i_company_country`, `i_company_name`, `i_company_number`, `i_support_email`, `identityForm`, `identityStatus`, `leadsBody`, `leadsEmpty`, `loading`, `logout`, `panel`, `payBody`, `payEmpty`, `replyCancel`, `replyForm`, `replyId`, `replyMessage`, `replyStatus`, `replySubject`, `replyText` (+19)

- data-* refs: `data-act`, `data-feature-override`, `data-feature-override-user`, `data-id`, `data-pag`, `data-reply`

- dataset refs: `act`, `featureOverride`, `id`, `pag`, `reason`, `reply`, `tab`

- aria-* refs: `aria-selected`

- fetch endpoints: `/api/auth/logout`

- api endpoints: `/api/admin/action`, `/api/admin/audit?page=`, `/api/admin/features`, `/api/admin/features/override`, `/api/admin/identity`, `/api/admin/leads?page=`, `/api/admin/overview`, `/api/admin/payments?page=`, `/api/admin/support/reply`, `/api/admin/users?`, `/api/auth/me`

- Event listeners: click=10, submit=2, change=1


#### `apps/leaderboard/src/assets/admin2fa.js`

- $ selector: `logout`, `tfaBackToCode`, `tfaCode`, `tfaDone`, `tfaQr`, `tfaRecovery`, `tfaRecoveryCode`, `tfaRecoveryList`, `tfaRecoverySubmit`, `tfaSecret`, `tfaSetup`, `tfaSetupCode`, `tfaSetupSubmit`, `tfaSubmit`, `tfaSuccess`, `tfaUseRecovery`, `tfaVerify`

- fetch endpoints: `/api/auth/logout`

- api endpoints: `/api/admin/2fa/enable`, `/api/admin/2fa/recovery`, `/api/admin/2fa/status`, `/api/admin/2fa/verify`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/auth.js`

- getElementById: `email`, `err`, `form`, `msg`, `name`, `password`, `planBanner`, `pwMeter`, `pwReqs`, `slug`, `slugPreview`, `submit`

- data-* refs: `data-eye`, `data-eye-off`, `data-field-err`, `data-pw-strength`, `data-pw-toggle`, `data-req`

- aria-* refs: `aria-invalid`, `aria-label`

- fetch endpoints: `/api/auth/me`

- Event listeners: click=1, submit=1, change=0


#### `apps/leaderboard/src/assets/chat-entry.js`

- Exports / purpose:

  - `connectKickChat` — ws-us2.pusher.com/app/${PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

  - `computeTrustScore`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/contact-context.js`

- Exports / purpose:

  - `resolveContactType`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/contact.js`

- getElementById: `c_back`, `c_back_wrap`, `c_context`, `c_email`, `c_err`, `c_kind`, `c_message`, `c_name`, `c_subject`, `c_submit`, `c_success`, `contactForm`, `contactIntro`, `contactTitle`, `help-app`, `helpBackdrop`, `helpSide`, `yr`

- data-* refs: `data-close-side`

- aria-* refs: `aria-controls`, `aria-expanded`, `aria-modal`

- fetch endpoints: `/api/auth/me`, `/api/contact`

- Event listeners: click=3, submit=1, change=0


#### `apps/leaderboard/src/assets/cookie-consent.js`

- aria-* refs: `aria-label`

- Event listeners: click=2, submit=0, change=0


#### `apps/leaderboard/src/assets/credits.js`

- Exports / purpose:

  - `applyOAuthContext`

  - `enter` — Persistent-shell lifecycle When this module is imported as a fragment by the dynamic-section loader (window.__yrSpaShell is set), the auto-i

  - `leave`

- $ selector: `cr-add-mapping`, `cr-analytics`, `cr-analytics-days`, `cr-analytics-days-label`, `cr-app`, `cr-channel-chip`, `cr-channel-connect-wrap`, `cr-channel-connected`, `cr-channel-disconnect`, `cr-channel-form`, `cr-channel-id-input`, `cr-channel-linked`, `cr-channel-live`, `cr-channel-name`, `cr-channel-name-input`, `cr-channel-reconnect`, `cr-channel-submit`, `cr-channel-token`, `cr-credits-by-day`, `cr-credits-by-day-empty`, `cr-empty`, `cr-fulfilled-counter`, `cr-history-empty`, `cr-history-feed-empty`, `cr-history-feed-list` (+81)

- data-* refs: `data-block`, `data-blocked`, `data-cancel`, `data-close-side`, `data-del-reward`, `data-del-shop`, `data-edit-reward`, `data-edit-shop`, `data-fulfill`, `data-pop-no`, `data-pop-yes`, `data-shop-next`, `data-shop-page`, `data-shop-prev`, `data-tip-viewer`, `data-toggle-reward`, `data-toggle-shop`, `data-viewer-balance`, `data-viewer-name`, `data-wired`

- dataset refs: `amount`, `block`, `blocked`, `cancel`, `crTab`, `delReward`, `delShop`, `editReward`, `editShop`, `fulfill`, `origText`, `tipViewer`, `toggleReward`, `toggleShop`, `viewerName`, `wired`

- aria-* refs: `aria-busy`, `aria-disabled`, `aria-hidden`, `aria-label`

- api endpoints: `DELETE`, `GET`, `POST`

- Event listeners: click=27, submit=8, change=5


#### `apps/leaderboard/src/assets/dashboard/account-delete-modal.js`

- Exports / purpose:

  - `wireDeleteAccountModal`

- getElementById: `deleteAccountBtn`, `deleteAccountCancelBtn`, `deleteAccountConfirm`, `deleteAccountConfirmBtn`, `deleteAccountModal`, `deleteAccountModalStatus`, `deleteAccountPassword`, `deleteAccountPasswordWrap`

- aria-* refs: `aria-atomic`, `aria-busy`, `aria-describedby`, `aria-hidden`, `aria-labelledby`, `aria-live`, `aria-modal`

- fetch endpoints: `/api/account/delete`

- Event listeners: click=4, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/account.js`

- Exports / purpose:

  - `wireAccount`

  - `setupSettingsScreen` — Board settings (`/dashboard/site`). Plan, usage and account-level providers live in the account settings document, not here.

- $ selector: `accChangePassword`, `accCurrentPassword`, `accExportData`, `accExportRetry`, `accExportStatus`, `accNewPassword`, `accPasswordStatus`, `accRevokeSessions`, `accSessions`, `accSessionsStatus`, `accSignOut`, `f_webhook`, `notifyBody`, `playerFieldsLink`, `pwdReqCase`, `pwdReqLength`, `pwdReqNumber`, `pwdReqSymbol`, `settingsBoardAccessLink`, `settingsDeleteBoard`, `settingsResetData`, `settingsWebhookEnabled`, `status`

- data-* refs: `data-page`, `data-pwd-toggle`, `data-settings-panel`, `data-settings-tab`

- dataset refs: `configured`, `settingsPanel`, `settingsTab`

- aria-* refs: `aria-busy`, `aria-label`, `aria-selected`

- fetch endpoints: `/api/account/export`, `/api/auth/sessions`, `/api/site`, `/api/site/archive`

- Event listeners: click=9, submit=0, change=1


#### `apps/leaderboard/src/assets/dashboard/board-shell.js`

- Exports / purpose:

  - `siteQuery`

  - `sitePath`

  - `preserveSiteContextLinks`

  - `loadBoardShell`

- $ selector: `lbTopbarStatus`, `liveLink`, `planBadge`, `sidebarBoardSelect`

- data-* refs: `data-product-link`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/boards.js`

- Exports / purpose:

  - `renderBoardSwitcher`

  - `deleteBoard`

  - `setActiveBoard`

  - `openNewBoardForm`

  - `duplicateBoard`

  - `renderBoardSelect`

  - `renderBoardsPage`

- $ selector: `boardLimitCta`, `boardLimitText`, `boardLimitTitle`, `boardLimitUpsell`, `boardsBody`, `boardsCreateEmpty`, `boardsEmpty`, `boardsSearch`, `nb_cancel`, `nb_casino`, `nb_code`, `nb_create`, `nb_err`, `nb_name`, `nb_slug`, `newBoard`, `newBoardForm`, `sidebarBoardSelect`, `status`

- data-* refs: `data-action`

- aria-* refs: `aria-controls`, `aria-expanded`

- fetch endpoints: `/api/site`, `/api/site/active`, `/api/site/create`, `/api/site/duplicate`

- Event listeners: click=6, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/command-palette.js`

- getElementById: `topbarCmdTrigger`

- $ selector: `gamesResetDemo`, `openHelpDrawerBtn`, `publishAction`, `save`, `yrPaletteInput`, `yrPaletteResults`

- data-* refs: `data-index`

- dataset refs: `index`

- aria-* refs: `aria-activedescendant`, `aria-autocomplete`, `aria-controls`, `aria-expanded`, `aria-hidden`, `aria-label`, `aria-modal`, `aria-selected`

- Event listeners: click=4, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/dynamic-section.js`

- Exports / purpose:

  - `loadDynamicSection` — Load a dynamic section into the persistent shell.

  - `leaveDynamicSection` — Tear down the current dynamic section (if any) and hide the content region. Called when navigating back to an SPA section.

  - `restoreTopbarContext` — Show a local loading skeleton inside the content region. function showLocalLoading(container) { container.innerHTML = `<div class="lb-dynami

  - `showSpaSection` — Show a local error state with a retry button inside the content region. function showLocalError(container, err) { renderError(container, { t

  - `isDynamicActive` — true if a dynamic section is currently active.

- getElementById: `pubToggle`

- $ selector: `lbDynamic`

- data-* refs: `data-focus-target`, `data-page`

- dataset refs: `page`

- aria-* refs: `aria-busy`, `aria-hidden`, `aria-live`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/games.js`

- Exports / purpose:

  - `setGamesPreviewState`

  - `initGames` — Called on every visit to the Games section, so the rendering and data load re-run to keep the section fresh. The one-time wiring (simulator

- $ selector: `gameSettingRows`, `gamesPopoutLink`, `gamesPreviewBtn`, `gamesResetDemo`, `gamesSimulatorIframe`

- data-* refs: `data-game`, `data-game-max`, `data-game-status`, `data-game-toggle`, `data-preview-game`, `data-test-game`

- dataset refs: `currentSrc`, `gameMax`, `gameToggle`, `previewGame`, `previous`, `saveError`, `state`

- aria-* refs: `aria-disabled`, `aria-label`, `aria-live`, `aria-selected`

- fetch endpoints: `/api/site/games/settings`

- Event listeners: click=4, submit=0, change=1


#### `apps/leaderboard/src/assets/dashboard/help-drawer.js`

- data-* refs: `data-action`, `data-insert`, `data-keywords`, `data-nav`, `data-open-feedback`, `data-open-help`, `data-open-support`, `data-tab`

- dataset refs: `keywords`, `tab`

- aria-* refs: `aria-hidden`, `aria-label`, `aria-labelledby`, `aria-live`, `aria-modal`, `aria-selected`

- fetch endpoints: `/api/auth/me`, `/api/contact`

- Event listeners: click=8, submit=2, change=0


#### `apps/leaderboard/src/assets/dashboard/notifications.js`

- Exports / purpose:

  - `serializeWebhookUrl`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/overview-state.js`

- Exports / purpose:

  - `giveawayAction`

  - `visitsMetricState`

  - `activityEmptyAction`

  - `nextStepAction`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/overview.js`

- Exports / purpose:

  - `loadOverviewLiveData`

  - `renderOverviewSummary`

- $ selector: `f_name`, `ovActiveBento`, `ovActiveGiveaway`, `ovActivityEmpty`, `ovActivityList`, `ovCommandGrid`, `ovCreditsCard`, `ovCreditsUsed`, `ovFirstRun`, `ovGiveawayAction`, `ovHeadSub`, `ovKpiRow`, `ovNextStep`, `ovNextStepAction`, `ovNextStepBody`, `ovNextStepTitle`, `ovOnboardingBento`, `ovPendingOrders`, `ovPendingOrdersAlert`, `ovPendingOrdersAlertCount`, `ovPendingOrdersAlertLabel`, `ovPendingOrdersCard`, `ovPlayersCount`, `ovPublicSiteAction`, `ovPublishedStatus` (+12)

- data-* refs: `data-name`, `data-publication-action`, `data-setup-state`, `data-setup-step`

- dataset refs: `publicationAction`

- aria-* refs: `aria-hidden`, `aria-valuenow`

- Event listeners: click=1, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/performance.js`

- Exports / purpose:

  - `initPerformance`

  - `renderPerformance`

  - `renderPerformanceLoading`

- $ selector: `eventsEmpty`, `perf-heatmap`, `perfActivityBody`, `perfActivityEmpty`, `perfBoardName`, `perfExport`, `perfHeatmapGrid`, `perfRangeFilter`, `perfRangeLabel`, `perfReferrersBody`, `perfReferrersEmpty`, `perfTotalViews`, `statBars`, `statsEmpty`

- data-* refs: `data-page`, `data-perf-tab`, `data-range`

- dataset refs: `perfTab`, `range`

- aria-* refs: `aria-busy`, `aria-current`, `aria-hidden`, `aria-label`

- Event listeners: click=2, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/players.js`

- Exports / purpose:

  - `PLAYER_NAME_LIMIT`

  - `truncatePlayerName`

  - `commitDraftMutation` — Commit a change to the in-memory draft through one path. markDirty() keeps the save bar and preview in sync; the status region is the existi

  - `parsePlayerNumber`

  - `setPlayerFieldError`

  - `updateDuplicateWarnings`

  - `playerLimitMessage`

  - `validateQuickAddValues`

  - `persistPlayersDraft`

  - `clearPlayersDraft`

  - `loadPlayersDraft`

  - `discardPlayersDraft`

  - `collectPlayers`

  - `validatePlayersForSave`

  - `playerRow`

- $ selector: `addRow`, `bulkActions`, `bulkClearWager`, `bulkCount`, `bulkDelete`, `colDropdownBtn`, `colMenu`, `csvExportBtn`, `csvFileInput`, `csvImportBtn`, `csvTemplateBtn`, `emptyImportBtn`, `emptyPasteBtn`, `f_currency`, `gsheetBtn`, `gsheetFetch`, `gsheetPanel`, `gsheetStatus`, `gsheetUrl`, `importApply`, `importMenu`, `importMenuBtn`, `importPanel`, `importPasteBtn`, `importPreview` (+26)

- data-* refs: `data-col`, `data-field`, `data-field-error`, `data-field-warning`

- dataset refs: `col`, `field`

- aria-* refs: `aria-controls`, `aria-describedby`, `aria-disabled`, `aria-expanded`, `aria-hidden`, `aria-invalid`, `aria-label`, `aria-live`

- Event listeners: click=21, submit=0, change=5


#### `apps/leaderboard/src/assets/dashboard/preview-tabs.js`

- data-* refs: `data-device`, `data-width`

- aria-* refs: `aria-selected`

- Event listeners: click=1, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/profile-menu.js`

- Exports / purpose:

  - `updateProfileMenu`

- data-* refs: `data-profile-name`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/publication.js`

- Exports / purpose:

  - `requestPublicationChange`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/referrals.js`

- Exports / purpose:

  - `renderReferrals`

- $ selector: `refCopy`, `refCount`, `refDays`, `refLink`, `refSaved`, `refStatus`

- fetch endpoints: `/api/referrals`

- Event listeners: click=1, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/request.js`

- Exports / purpose:

  - `DASHBOARD_REQUEST_TIMEOUT_MS`

  - `isDashboardAuthError`

  - `loginRedirectPath`

  - `withDashboardTimeout`

  - `fetchDashboard`

  - `fetchDashboardJson`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/routes.js`

- Exports / purpose:

  - `SECTIONS`

  - `TAB_TITLES`

  - `MANAGE_SITES_VALUE`

  - `trimTrailingSlashes` — Trim trailing slashes in linear time. A `/\/+$/` regex on request-derived paths is polynomial on adversarial input (many repeated '/') — Cod

  - `DYNAMIC_SECTIONS` — Dynamic sections These dashboard areas were separate server-rendered documents, each with its own boot script (credits.js / giveaways.js / a

  - `isDynamicSection` — true if `page` is one of the dynamic (fragment-loaded) sections.

  - `parseDynamicPath` — Parse a dashboard URL into a dynamic section route, or null if the path does not belong to a dynamic section. `/dashboard/rewards/shop` → {

  - `dynamicPath` — Build the URL path for a dynamic section + tab.

  - `dynamicTitle` — Human-readable title for a dynamic section route.

  - `SECTION_ALIASES` — Names we have shipped links for, in copy, e-mails and older builds.

  - `legacyDashboardPath`

  - `resolveSection`

  - `defaultTab`

  - `dashboardPath` — `("board", "players") → "/dashboard/leaderboard/players"

  - `parseDashboardPath` — `"/dashboard/leaderboard/players" → { page: "board", tab: "players" }`, or null.

- data-* refs: `data-cr-tab`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/session.js`

- Exports / purpose:

  - `getMe` — Returns a cached promise for the authenticated user. Re-fetches on failure.

  - `getSites` — Returns a cached promise for the site list. Re-fetches on failure.

  - `refreshSites` — Force a re-fetch of the site list (after create/delete/rename).

  - `clearSession` — Drop all cached session data (logout, account switch).

  - `handleAuthError` — Redirect to login if the session has ended. Returns true if redirected.

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/shell.js`

- Exports / purpose:

  - `registerSectionMounter`

  - `areaForPage`

  - `currentRoute` — The section this document was opened at, from the path the Worker served.

  - `requestDashboardRoute`

  - `setActiveSideNav`

  - `navTo`

  - `scrollToHash`

  - `openDrawer`

  - `closeDrawer`

  - `setupEditorTabs` — Editor sub-navigation: group the endless controls column into tabs (Setup / Players / Design / Share / History) so the form isn't one long s

  - `setupShell`

- getElementById: `editorTabs`, `lbDynamic`

- $ selector: `lbSide`, `save`

- data-* refs: `data-close-side`, `data-egroup`, `data-jump`, `data-nav`, `data-page`

- dataset refs: `area`, `egroup`, `hash`, `jump`, `nav`, `page`

- aria-* refs: `aria-current`, `aria-expanded`, `aria-hidden`, `aria-label`, `aria-modal`, `aria-selected`

- Event listeners: click=8, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/site-sections.js`

- Exports / purpose:

  - `siteSections` — Current public-section flags for the active site (shop/credits/games).

  - `initSiteSections` — Render the Sections tab of Site settings. Runs at shell boot (the sections read shell state that is already loaded) and re-renders cheaply o

- $ selector: `leaderboardBlockNote`, `leaderboardBlockRows`, `siteSectionRows`

- data-* refs: `data-section-status`, `data-site-section`, `data-site-section-row`

- dataset refs: `siteSection`, `state`

- aria-* refs: `aria-label`, `aria-live`

- fetch endpoints: `/api/site/sections`

- Event listeners: click=0, submit=0, change=1


#### `apps/leaderboard/src/assets/dashboard/site-selector.js`

- Exports / purpose:

  - `renderSiteSelector`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/site.js`

- Exports / purpose:

  - `DEFAULT_SECTIONS`

  - `isLifetime`

  - `isPro`

  - `checkout`

  - `renderPlan`

  - `loadHistory`

  - `loadPlanUsage`

  - `wireCancelSubscription`

  - `collect`

  - `fitDesignPreview` — --- branding --- { name: "Indigo", accentA: "#5b5bf5", accentB: "#7b7bf8" }, { name: "Cyan", accentA: "#06b6d4", accentB: "#42e6ff" }, { nam

  - `refreshDesignPreview` — Re-render the preview and re-fit it: what every "show me the draft" path wants.

  - `publicationCopy` — Renders every "is my board live" surface from boardStatus() so the badge, banner and share affordances can never contradict each other. One

  - `renderBoardStatus`

  - `renderArchives` — session-only dismissal unavailable */ } banner.hidden = true; }); } if (resend && !resend._wired) { resend._wired = true; let cooldown = 0;

  - `closeOutPeriod`

- $ selector: `a_clear`, `a_go`, `a_label`, `apiAccess`, `applyCustomColors`, `archEmpty`, `archList`, `brandBody`, `brandLock`, `c_a`, `c_b`, `cancelBtn`, `cancelStatus`, `cancelWrap`, `colorPresets`, `colorsReset`, `designPreview`, `discard`, `domainBody`, `domainDisconnectBtn`, `domainGetAuthCodeBtn`, `domainLock`, `domainManageCard`, `domainManageExpiry`, `domainManageLockStatus` (+129)

- data-* refs: `data-buy-domain`, `data-color`, `data-page`, `data-plan`, `data-price`, `data-section`, `data-social`, `data-template`

- dataset refs: `buyDomain`, `color`, `configured`, `device`, `plan`, `price`, `section`, `template`, `width`

- aria-* refs: `aria-busy`, `aria-hidden`, `aria-label`, `aria-live`, `aria-pressed`

- fetch endpoints: `/api/account/payments`, `/api/account/usage`, `/api/auth/resend-verification`, `/api/billing/cancel`, `/api/billing/pending`, `/api/billing/trial`, `/api/domains/purchase`, `/api/domains/search`, `/api/domains/toggle-lock`, `/api/domains/transfer-auth-code`, `/api/site/archive/delete`, `/api/site/archive/restore`, `/api/site/domain/verify`, `/api/site/list`, `/api/site/notify/test`

- Event listeners: click=31, submit=0, change=7


#### `apps/leaderboard/src/assets/dashboard/state.js`

- Exports / purpose:

  - `createDashboardState` — Shared mutable state for the dashboard modules, plus the one change notification path. Modules must not reach into each other to refresh a s

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/states.js`

- Exports / purpose:

  - `UNKNOWN`

  - `STATE_VOCABULARY`

  - `emptyStateHtml`

  - `inlineStateHtml`

  - `renderInlineState`

  - `metricText`

  - `setMetricLoading`

  - `setMetricValue`

  - `setMetricUnknown`

  - `setRowsLoading`

  - `setBlockLoading`

  - `setBlockReady`

  - `renderError`

  - `renderEmpty`

- data-* refs: `data-metric-unavailable`, `data-state`

- aria-* refs: `aria-busy`, `aria-hidden`, `aria-label`

- Event listeners: click=2, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard/utils.js`

- Exports / purpose:

  - `getCsrf`

  - `guardAuth` — E2E-005: Redirect to login on session expiry instead of showing stale "Save failed" AUDIT-B2: keep the current URL in `next` so re-login ret

  - `logError`

  - `showToast`

  - `showLoadError` — "You have nothing yet" and "we couldn't load this" are different facts, and every panel used to conflate them: a failed fetch left the empty

  - `clearLoadError` — Put the panel's own empty copy back, and hide it unless `show`.

  - `hasLoadError` — True while the panel is showing a load failure rather than its empty copy.

  - `showConfirmModal`

  - `showPromptModal`

  - `getViewerTimeZone`

  - `timeZoneOffsetLabel`

  - `timeZoneLabel`

  - `toLocalInput` — Fill a <input type="datetime-local"> with the wall-clock time in `timeZone`.

  - `fromLocalInput`

  - `slugify`

- getElementById: `status`

- $ selector: `f_ends`, `rows`

- data-* refs: `data-driven`, `data-next`, `data-prev`

- dataset refs: `emptyClass`, `emptyHtml`

- aria-* refs: `aria-busy`, `aria-hidden`, `aria-label`

- fetch endpoints: `/api/log`

- Event listeners: click=3, submit=0, change=1


#### `apps/leaderboard/src/assets/dashboard-boot-watchdog.js`

- getElementById: `cr-empty`, `gw-app`, `loading`

- data-* refs: `data-yr-boot-hint`, `data-yr-boot-retry`

- aria-* refs: `aria-hidden`

- Event listeners: click=1, submit=0, change=0


#### `apps/leaderboard/src/assets/dashboard.js`

- getElementById: `rows`, `save`

- $ selector: `a_label`, `dash`, `designPreview`, `f_auto_reset`, `f_auto_reset_clear`, `f_blurb`, `f_casino`, `f_code`, `f_cta`, `f_domain`, `f_ends`, `f_name`, `f_password`, `f_password_enabled`, `f_period`, `f_pool`, `f_rank_by`, `f_starts`, `f_tagline`, `liveLink`, `loading`, `loadingStatus`, `playerSort`, `previewLiveLink`, `pubToggle` (+4)

- data-* refs: `data-page`

- dataset refs: `productLink`

- aria-* refs: `aria-busy`, `aria-hidden`, `aria-live`

- Event listeners: click=1, submit=0, change=6


#### `apps/leaderboard/src/assets/dialog.js`

- aria-* refs: `aria-describedby`, `aria-label`, `aria-labelledby`, `aria-modal`

- Event listeners: click=3, submit=0, change=0


#### `apps/leaderboard/src/assets/games/chunk-PLEH5LTW.js`

- data-* refs: `data-invalid`

- aria-* refs: `aria-busy`, `aria-describedby`, `aria-hidden`, `aria-invalid`, `aria-label`, `aria-live`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/games/games.js`

- getElementById: `gx-root`

- data-* refs: `data-gx-boot`, `data-gx-demo-allowed`, `data-tier`, `data-win`

- aria-* refs: `aria-atomic`, `aria-busy`, `aria-current`, `aria-hidden`, `aria-label`, `aria-live`, `aria-pressed`

- fetch endpoints: `/api/viewer/me`

- Event listeners: click=0, submit=0, change=1


#### `apps/leaderboard/src/assets/giveaways.js`

- Exports / purpose:

  - `enter`

  - `leave`

- $ selector: `btn-create-drop`, `btn-create-pred`, `btn-create-raffle`, `btn-open-event-drawer`, `cd-active-list`, `cd-btn-random`, `cd-cancel`, `cd-code`, `cd-drawer-close`, `cd-expire`, `cd-form`, `cd-max`, `cd-past-list`, `cd-points`, `cd-submit`, `gw-btn-copy-winner`, `gw-btn-export`, `gw-btn-listen`, `gw-btn-reroll`, `gw-btn-reset`, `gw-btn-roll`, `gw-channel-input`, `gw-chat-feed`, `gw-claim-box`, `gw-count-header` (+74)

- data-* refs: `data-code`, `data-field-error`, `data-id`, `data-keep-interactive`, `data-pred-id`, `data-raffle-id`

- dataset refs: `code`, `id`, `removeId`, `tab`, `target`, `username`, `val`

- aria-* refs: `aria-invalid`, `aria-label`, `aria-live`

- Event listeners: click=31, submit=4, change=1


#### `apps/leaderboard/src/assets/invite.js`

- getElementById: `btnAcceptInvite`

- data-* refs: `data-token`

- fetch endpoints: `/api/site/team/accept-invite`

- Event listeners: click=1, submit=0, change=0


#### `apps/leaderboard/src/assets/landing.js`

- getElementById: `boardRows`, `flipClock`, `heroWordSwap`, `liveTickerText`, `navLinksList`, `navPill`, `simChatContainer`, `simDiceResult`, `simFeedbackNote`, `simRedeemBtn`, `simRollDiceBtn`, `simShopItem`, `simViewerBal`, `yr`

- data-* refs: `data-board-filter`, `data-chat-cmd`, `data-community-loop`, `data-hero-settle`, `data-loop-step`, `data-sim-panel`, `data-sim-tab`, `data-spotlight`, `data-tilt`

- dataset refs: `map`

- aria-* refs: `aria-expanded`, `aria-hidden`, `aria-label`, `aria-selected`

- Event listeners: click=7, submit=0, change=0


#### `apps/leaderboard/src/assets/overlay.js`

- getElementById: `ov-config`, `ov-count`, `ov-players`

- data-* refs: `data-name`, `data-ot`, `data-ov-sponsor`, `data-ov-timer`

- dataset refs: `json`, `name`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/shell-nav.js`

- getElementById: `yrThemeToggle`

- data-* refs: `data-auth-workspace`, `data-close-side`, `data-collapse-side`, `data-shell-drawer`, `data-side-collapsed`, `data-theme`

- aria-* refs: `aria-expanded`, `aria-label`, `aria-modal`, `aria-pressed`

- Event listeners: click=7, submit=1, change=0


#### `apps/leaderboard/src/assets/site-shell.js`

- getElementById: `yr-feedback`, `yr-feedback-close`, `yr-feedback-status`, `yr-menu`, `yr-no-match`, `yr-redeem-status`, `yr-scrim`, `yr-search`, `yr-search-status`, `yr-side`, `yr-side-close`

- data-* refs: `data-ends-at`, `data-feedback-open`, `data-load-more`, `data-load-more-status`, `data-open`, `data-player-board`, `data-player-count-badge`, `data-player-name`, `data-position`, `data-redeem`, `data-rows`, `data-tab`, `data-table-wrap`, `data-tabpanel`

- dataset refs: `currency`, `customDomain`, `endsAt`, `overflow`, `playerName`, `rankBy`, `redeem`, `redeemKey`, `rewardCost`, `rewardName`, `slug`, `tab`, `tabpanel`

- aria-* refs: `aria-expanded`, `aria-label`, `aria-modal`, `aria-selected`

- fetch endpoints: `/api/feedback`, `/api/public/`, `/api/viewer/redeem`

- Event listeners: click=9, submit=1, change=0


#### `apps/leaderboard/src/assets/theme.js`

- data-* refs: `data-theme`

- Event listeners: click=0, submit=0, change=0


#### `apps/leaderboard/src/assets/tournaments.js`

- $ selector: `tournament-anti-alt`, `tournament-app`, `tournament-bracket`, `tournament-bracket-card`, `tournament-champion`, `tournament-chat-channel`, `tournament-chat-status`, `tournament-count`, `tournament-empty`, `tournament-entries-empty`, `tournament-entry-cap`, `tournament-entry-list`, `tournament-format`, `tournament-game`, `tournament-game-display`, `tournament-keyword`, `tournament-list-card`, `tournament-message`, `tournament-new`, `tournament-pick-count`, `tournament-pick-count-wrap`, `tournament-primary`, `tournament-reopen`, `tournament-settings`, `tournament-settings-form` (+3)

- data-* refs: `data-entry-action`, `data-entry-id`, `data-match-id`, `data-score-match`, `data-score-player`

- dataset refs: `action`, `entryAction`, `entryId`, `scoreMatch`

- aria-* refs: `aria-label`

- api endpoints: `/api/tournaments`

- Event listeners: click=1, submit=1, change=0


#### `apps/leaderboard/src/assets/verify-email.js`

- $ selector: `err`, `msg`, `resendBtn`, `resendWrap`

- fetch endpoints: `/api/auth/resend-verification`

- Event listeners: click=1, submit=0, change=0


#### `apps/leaderboard/src/assets/viewer-dashboard.js`

- $ selector: `vd-avatar`, `vd-back`, `vd-boards`, `vd-boards-card`, `vd-boards-empty`, `vd-drop-claim`, `vd-drop-claim-btn`, `vd-drop-code`, `vd-earn-hint`, `vd-events-empty`, `vd-identity`, `vd-loading`, `vd-login-card`, `vd-logout`, `vd-nav`, `vd-profile`, `vd-redemptions-empty`, `vd-redemptions-list`, `vd-shop-empty`, `vd-shop-list`, `vd-site-balance`, `vd-site-card`, `vd-site-name`, `vd-site-streamer`, `vd-switch` (+2)

- data-* refs: `data-redeem`, `data-view-site`

- dataset refs: `origText`, `redeem`, `redeemKey`, `viewSite`

- aria-* refs: `aria-busy`

- api endpoints: `GET`, `POST`

- Event listeners: click=6, submit=0, change=0


### 5.2 Bot dashboard view modules


#### `apps/bot/src/dashboard-views/app.ts`

- Links: `${href}`, `/dashboard/leaderboards`, `/dashboard/telegram/bots`


#### `apps/bot/src/dashboard-views/client-script.ts`

Purpose: Client-side dashboard script injected by appHtml

- IDs: `health-`, `health-body-`

- Links: `#offerCreateForm`, `/dashboard/telegram/bots`, `/dashboard/telegram/commands?bot=`, `/dashboard/telegram/offers`, `https://t.me/`


#### `apps/bot/src/dashboard-views/login.ts`

- IDs: `devid`, `loginMsg`, `main-content`

- Links: `#main-content`, `https://fonts.googleapis.com`, `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap`, `https://fonts.gstatic.com`


#### `apps/bot/src/dashboard-views/pages/bots.ts`

Purpose: bots dashboard page panels

- IDs: `botList`, `botPlanState`, `botToken`, `botWelcome`, `connectStatus`, `connectWizard`, `testMsgPanel`, `tmBotName`, `tmChatId`, `tmText`

- Links: `https://t.me/BotFather`, `https://t.me/userinfobot`


#### `apps/bot/src/dashboard-views/pages/broadcasts.ts`

Purpose: broadcasts dashboard page panels

- IDs: `bcAudience`, `bcBody`, `bcBody-error`, `bcBotSelect`, `bcBotSelect-error`, `bcComposer`, `bcConfirmBtn`, `bcDetail`, `bcDetailBody`, `bcDetailTitle`, `bcDraftStatus`, `bcFirstSeen`, `bcFormStatus`, `bcImage`, `bcLang`, `bcList`, `bcMinLastSeen`, `bcPlanState`, `bcPreview`, `bcPreviewBody`, `bcPreviewCount`, `bcPreviewDesc`, `bcPreviewImg`, `bcPreviewScheduleLabel`, `bcPreviewTiming`, `bcPreviewTitle`, `bcReviewBtn`, `bcSchedule`, `bcSetupState`, `bcSummary` (+6)

- Inputs: `bcPreviewWhen`, `bcWhen`

- Links: `/dashboard/telegram/bots`, `https://t.me/userinfobot`


#### `apps/bot/src/dashboard-views/pages/commands.ts`

Purpose: commands dashboard page panels

- IDs: `botSelect`, `cmdBtnLabel`, `cmdBtnUrl`, `cmdButtonList`, `cmdList`, `cmdName`, `cmdPreview`, `cmdPreviewName`, `cmdPreviewResponse`, `cmdResp`, `cmdTestChatId`, `commandsEmptyHint`, `custDisabledNote`, `customizePanel`, `selectedBotName`, `welcomeMsg`

- Links: `/dashboard/telegram/bots`


#### `apps/bot/src/dashboard-views/pages/offers.ts`

Purpose: offers dashboard page panels

- IDs: `oBonus`, `oCasino`, `oCode`, `oLabel`, `oUrl`, `offerCreateForm`, `offerCreatedActions`, `offerPlanState`, `offerPreview`, `offerPreviewText`, `offerPreviewTitle`, `offerPreviewUrl`, `offers`, `postbackStatusOffers`

- Links: `${publicBaseUrl}/dashboard/settings/connections`, `/dashboard/telegram/commands`


#### `apps/bot/src/dashboard-views/pages/overview.ts`

Purpose: overview dashboard page panels

- IDs: `chart`, `chartLabels`, `clicksSub`, `deepLinkExample`, `offersSub`, `ovBots`, `ovOffers`, `ovScope`, `subSources`, `subsNew`, `telegramSetupTitle`, `totClicks`, `totOffers`, `totSubs`, `totUnique`, `uniqueSub`

- Links: `/dashboard/telegram/bots`, `/dashboard/telegram/broadcasts`, `/dashboard/telegram/commands`, `/dashboard/telegram/offers`


#### `apps/bot/src/dashboard-views/shell.ts`


#### `apps/bot/src/dashboard-views/utils.ts`

Purpose: Shared HTML escaping helper


### 5.3 Next.js marketing components


#### `apps/web/src/app/about/page.tsx`

- Exports: `metadata`

- Links: `/demo`, `/signup`


#### `apps/web/src/app/brand/page.tsx`

- Exports: `metadata`

- Links: `/contact`


#### `apps/web/src/app/changelog/page.tsx`

- Exports: `metadata`


#### `apps/web/src/app/credits/page.tsx`

- Exports: `metadata`


#### `apps/web/src/app/faq/page.tsx`

- Exports: `metadata`

- Links: `/help/support`, `/pricing`, `/signup`


#### `apps/web/src/app/games/page.tsx`

- Exports: `metadata`


#### `apps/web/src/app/layout.tsx`

- Exports: `metadata`

- IDs: `yourrank-design-contract`


#### `apps/web/src/app/overlays/page.tsx`

- Exports: `metadata`


#### `apps/web/src/app/page.tsx`

- Exports: `dynamic`, `metadata`


#### `apps/web/src/app/pricing/page.tsx`

- Exports: `metadata`

- Links: `/faq`, `/refund`, `/signup`, `/signup?plan=lifetime`


#### `apps/web/src/app/sites/page.tsx`

- Exports: `metadata`


#### `apps/web/src/app/status/page.tsx`

- Exports: `metadata`


#### `apps/web/src/app/status/status-panel.tsx`

- Exports: `StatusPanel`

- Links: `/help/support`


#### `apps/web/src/app/switch/page.tsx`

- Exports: `metadata`

- Links: `/demo`, `/pricing`, `/signup`


#### `apps/web/src/app/telegram/page.tsx`

- Exports: `metadata`


#### `apps/web/src/components/home/container-scroll-animation.tsx`

- Exports: `WorkspaceScrollReveal`


#### `apps/web/src/components/home/hero.tsx`

- Exports: `Hero`

- Links: `/demo`, `/signup`, `/sites`


#### `apps/web/src/components/home/magnetic-cursor.tsx`

- Exports: `MagneticCursor`


#### `apps/web/src/components/home/motion-footer.tsx`

- Exports: `MotionFooter`

- Links: `/demo`, `/signup`


#### `apps/web/src/components/home/reveal.tsx`

- Exports: `DEVIN_EASE`, `Reveal`, `Stagger`, `StaggerItem`


#### `apps/web/src/components/home/sections.tsx`

- Exports: `ProofMarquee`, `HowItWorks`, `ComparisonSection`, `PricingSnapshot`

- IDs: `loop`

- Links: `/demo`, `/pricing`, `/signup`


#### `apps/web/src/components/home/sticky-scroll-reveal.tsx`

- Exports: `StickyProductStory`

- IDs: `products`


#### `apps/web/src/components/home/workspace-preview.tsx`

- Exports: `WorkspacePreview`


#### `apps/web/src/components/product-page.tsx`

- Exports: `ProductPage`

- Links: `/demo`, `/signup`


#### `apps/web/src/components/site-shell.tsx`

- Exports: `BrandMark`, `SiteHeader`, `SiteFooter`, `MarketingShell`

- IDs: `main-content`, `mobile-navigation`

- Links: `#main-content`, `/`, `/about`, `/brand`, `/changelog`, `/contact`, `/credits`, `/docs`, `/faq`, `/games`, `/login`, `/overlays`, `/pricing`, `/signup`, `/sites`, `/status`, `/switch`, `/telegram`


#### `apps/web/src/lib/session.ts`

- Exports: `getCurrentUser`, `requireCurrentUser`


#### `apps/web/src/middleware.ts`

- Exports: `middleware`, `config`


### 5.4 Shared UI templates


#### `packages/shared/src/avatar.ts`

- IDs: `${gradId}`, `${gradId}_glow`


#### `packages/shared/src/brand-assets.ts`

- IDs: `${glowId}`, `${gradId}`


#### `packages/shared/src/dashboard-chrome.ts`

- IDs: `${esc(groupId)}`, `${esc(opts.subtitleId)}`, `${esc(opts.titleId)}`, `dash`, `lbMenu`, `lbSide`, `lbTopbar`, `main-content`, `status`, `workspace-content`

- data-attrs: `data-area`, `data-auth-workspace`, `data-close-side`, `data-nav`, `data-product-link`, `data-shell-drawer`

- Links: `${esc(c.href)}`, `${esc(item.href)}`, `/dashboard`


#### `packages/shared/src/games-embed.ts`

- IDs: `gx-root`

- data-attrs: `data-gx-boot`, `data-gx-demo-allowed`

- Links: `${esc(boot.earnHref)}`, `/assets/games.css`


#### `packages/shared/src/page-shell.ts`

- IDs: `main-content`

- data-attrs: `data-page`, `data-wide`

- Links: `#main-content`, `${esc(href)}`, `${esc(opts.canonical)}`, `${footerBrandHref}`, `/assets/app.css`, `/assets/dashboard-v4.css`, `/assets/devin-system.css`, `/assets/shell-nav.css`, `/assets/ui.css`, `/contact`, `/privacy`, `/responsible`, `/terms`, `https://fonts.googleapis.com`, `https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@500;700&display=swap`, `https://fonts.gstatic.com`


#### `packages/shared/src/shell-nav.ts`

- IDs: `yrThemeToggle`

- data-attrs: `data-theme`

- Links: `${accountHref}`, `${l.href}`, `/`, `/dashboard`, `/docs`, `/help/support?${helpQuery}`, `/login?next=${next}`, `/pricing`, `/signup`


#### `packages/shared/src/site-render.ts`

- IDs: `main-content`, `yr-feedback`, `yr-feedback-close`, `yr-feedback-status`, `yr-feedback-title`, `yr-menu`, `yr-no-match`, `yr-redeem-status`, `yr-scrim`, `yr-search`, `yr-search-status`, `yr-side`, `yr-side-close`

- data-attrs: `data-currency`, `data-custom-domain`, `data-ends-at`, `data-fill`, `data-player-name`, `data-position`, `data-rank-by`, `data-redeem`, `data-reward-cost`, `data-reward-name`, `data-section`, `data-slug`, `data-template`

- Inputs: `slug`

- Links: `#main-content`, `${boardCreditsHref}`, `${boardHref}`, `${canonicalUrl}`, `${ctaHref}`, `${esc(homeUrl || `, `${fontsHref}`, `${homeUrl}${siteSectionHref(`, `${homeUrl}${siteSectionHref(s, slug, isCustomDomain)}`, `${href}`, `${kickUrl}`, `${meHref}`, `${playerHref(p.name)}`, `${shopHref}`, `${signIn}`, `/api/viewer/auth/discord?returnTo=${encodeURIComponent(returnTo)}`, `/api/viewer/auth/kick?returnTo=${encodeURIComponent(returnTo)}`, `/assets/devin-system.css`, `/assets/site-shell.css`, `/me`


## 6. Backend handler areas


### `apps/leaderboard/src/handlers/account.js`

Overview: Account-level API: postback keys, conversion log, profile data.

| Handler | Purpose |
| --- | --- |
| `handleAccountPostbacks` | GET /api/account/postbacks |
| `handleAccountPostbacksRotate` | POST /api/account/postbacks/rotate |
| `handleAccountPostbacksRevoke` | DELETE /api/account/postbacks |
| `handleAccountPostbacksTest` | POST /api/account/postbacks/test |
| `handleAccountConversions` | GET /api/account/conversions |
| `handleAccountConnectedAccounts` | GET /api/account/connected-accounts |


### `apps/leaderboard/src/handlers/attribution.js`

Overview: Attribution analytics and casino postback endpoint.

| Handler | Purpose |
| --- | --- |
| `handleAttribution` | GET /api/attribution — per-offer clicks, conversions, revenue, and postback URL. |
| `handleAttributionExport` | GET /api/attribution/export — CSV download of the same data. |
| `handleRotatePostbackKey` | POST /api/attribution/rotate-key — create a new postback key and revoke active ones. |
| `handleRevokePostbackKey` | DELETE /api/attribution/postback-key — revoke all active postback keys. |
| `handlePostback` | POST /api/postback — receive casino conversion postbacks. |


### `apps/leaderboard/src/handlers/auth.js`

| Handler | Purpose |
| --- | --- |
| `handleSignup` |  |
| `handleLogin` |  |
| `handleLogout` |  |
| `handleDemoLogin` |  |
| `handleMe` |  |
| `handleForgot` | POST /api/auth/forgot — always answers ok; never reveals whether the account exists. SEC-702: try/catch ensures reset tokens are never logged even if an unexpected error occurs during the email send o |
| `handleReset` | POST /api/auth/reset — { token, password } SEC-702: Wrap in try/catch that redacts the reset token before logging. |
| `handleVerifyEmail` | POST /api/auth/verify — { token } |
| `handleResendVerification` | POST /api/auth/resend-verification — { email } Does not reveal whether the email exists. |


### `apps/leaderboard/src/handlers/backup.js`

Overview: Backup health and verification recording.

| Handler | Purpose |
| --- | --- |
| `handleBackupHealth` |  |
| `handleRecordBackupVerification` |  |
| `handleListBackupVerifications` |  |


### `apps/leaderboard/src/handlers/battlepass.js`

Overview: Seasonal Battle Pass & Viewer Progression Handlers.

| Handler | Purpose |
| --- | --- |
| `handleGetSeason` | GET /api/battlepass/season — Get active season and viewer progress |
| `handleCreateSeason` | POST /api/battlepass/season — Streamer creates or starts a new season |
| `handleClaimTierReward` | POST /api/battlepass/claim — Viewer claims milestone tier reward |
| `handleAwardXp` | POST /api/battlepass/award-xp — Award XP to a viewer and handle automatic level up |


### `apps/leaderboard/src/handlers/billing.js`

Overview: Billing handlers: trial activation

| Handler | Purpose |
| --- | --- |
| `handleTrial` | POST /api/billing/trial — start a free 7-day Pro trial (one-time per user). |


### `apps/leaderboard/src/handlers/contact.js`

Overview: Public contact/support form handler. Stores the message and emails the support inbox when RESEND_API_KEY is set.

| Handler | Purpose |
| --- | --- |
| `handleContact` |  |


### `apps/leaderboard/src/handlers/credits-block.js`

Overview: Block / unblock / flag a viewer for anti-fraud purposes.

| Handler | Purpose |
| --- | --- |
| `handleCreditsBlockViewer` |  |


### `apps/leaderboard/src/handlers/credits.js`

Overview: Dashboard API for the Kick credits / shop system.

| Handler | Purpose |
| --- | --- |
| `handleCreditsStatus` |  |
| `handleCreditsConnect` |  |
| `handleCreditsSaveReward` |  |
| `handleCreditsCreateReward` |  |
| `handleCreditsDeleteReward` |  |
| `handleCreditsSaveShopItem` |  |
| `handleCreditsDeleteShopItem` |  |
| `handleCreditsUpdateRedemption` |  |
| `handleCreditsViewerHistory` | Cross-board viewer history for a streamer: all of their sites where a given Kick viewer has a site_viewer record, with balances and redemption counts. |
| `handleCreditsActivity` |  |
| `handlePublicCredits` | Public viewer endpoints: shop is public, viewer data is session-only. |
| `handleCreditsViewerAuth` |  |
| `handleCreditsAnalytics` |  |
| `handleCreditsAdjustBalance` | Streamer-only: add or remove credits from a site viewer with a ledger row. |
| `handleCreditsReconcile` | Reconcile ledger-derived balance against stored site_viewers.balance. |


### `apps/leaderboard/src/handlers/csp-report.js`

Overview: CSP Violation Report Handler (Phase 8.1) Receives CSP violation reports and logs them for monitoring.

| Handler | Purpose |
| --- | --- |
| `handleCspReport` | POST /api/csp-report Receives CSP violation reports from browsers. Logs structured JSON for monitoring/alerting. |


### `apps/leaderboard/src/handlers/docs.js`

Overview: Public API documentation handlers Serves an OpenAPI 3.1 JSON spec for the public leaderboard API.

| Handler | Purpose |
| --- | --- |
| `handleApiDocs` |  |
| `handleOpenApiJson` |  |


### `apps/leaderboard/src/handlers/domains.js`

Overview: Domain purchase, automated DNS setup, and transfer management API handlers.

| Handler | Purpose |
| --- | --- |
| `handleDomainSearch` | POST /api/domains/search — Search domain availability across popular TLDs with retail pricing |
| `handleDomainPurchase` | POST /api/domains/purchase — Purchase a domain with instant 1-click CNAME DNS & SSL linking |
| `handleGetMyDomain` | GET /api/domains/my-domain — Get active custom domain details & transfer status for current site/user |
| `handleDomainToggleLock` | POST /api/domains/toggle-lock — Enable/disable ICANN registrar transfer lock |
| `handleDomainTransferAuthCode` | POST /api/domains/transfer-auth-code — Retrieve EPP Authorization code to transfer domain out |


### `apps/leaderboard/src/handlers/duels.js`

Overview: Viewer 1v1 Duels & Wager Challenges Handlers.

| Handler | Purpose |
| --- | --- |
| `handleGetDuels` | GET /api/duels/active — List active and recent duels |
| `handleCreateDuel` | POST /api/duels/create — Create a 1v1 duel challenge |
| `handleAcceptDuel` | POST /api/duels/:id/accept — Target accepts duel; execute provably fair roll |
| `handleDeclineDuel` | POST /api/duels/:id/decline — Decline or cancel duel challenge |


### `apps/leaderboard/src/handlers/events.js`

Overview: Community Events Handlers: Raffles (Ticket Draws) & Flash Code Drops.

| Handler | Purpose |
| --- | --- |
| `handleGetRaffles` | GET /api/events/raffles — List raffles for streamer dashboard |
| `handleCreateRaffle` | POST /api/events/raffles — Create a new ticket raffle |
| `handleDrawRaffle` | POST /api/events/raffles/draw — Draw a random winning ticket for an active raffle |
| `handleGetCodeDrops` | GET /api/events/drops — List flash code drops |
| `handleCreateCodeDrop` | POST /api/events/drops — Create a new flash code drop |
| `handleClaimCodeDrop` | POST /api/events/drops/claim — Viewer redeems a flash drop code |


### `apps/leaderboard/src/handlers/exports.js`

Overview: One-Click CSV Data Exports for Streamers.

| Handler | Purpose |
| --- | --- |
| `handleExportRaffleWinnersCsv` | GET /api/export/raffle-winners.csv — Export raffle winners report |
| `handleExportDropClaimsCsv` | GET /api/export/drop-claims.csv — Export flash drop claims report |
| `handleExportPredictionsCsv` | GET /api/export/predictions.csv — Export predictions & payouts report |


### `apps/leaderboard/src/handlers/feedback.js`

Overview: Public viewer feedback handler. Submits feedback tied to the current site and (optionally) signed-in viewer.

| Handler | Purpose |
| --- | --- |
| `handleFeedback` |  |


### `apps/leaderboard/src/handlers/games.js`

Overview: YourRank Originals — viewer-facing games API. Credits are non-cashable, site-specific loyalty points earned from Kick channel-point redemptions. These endpoints let a viewer wager them on provably-fair games. There is no

| Handler | Purpose |
| --- | --- |
| `handleGamesConfig` | GET /api/games/config?slug= |
| `handleGamesBet` | POST /api/games/bet |
| `handleGamesMinesReveal` | POST /api/games/mines/reveal |
| `handleGamesMinesCashout` | POST /api/games/mines/cashout |
| `handleGamesHistory` | GET /api/games/history?slug=&limit= |
| `handleGamesFairness` | GET /api/games/fairness?slug= |
| `handleGamesFairnessRotate` | POST /api/games/fairness/rotate |


### `apps/leaderboard/src/handlers/giveaway.js`

Overview: Handler for Kick Giveaway and Live Chatroom resolution

| Handler | Purpose |
| --- | --- |
| `handleGiveawayChatroom` |  |


### `apps/leaderboard/src/handlers/kick-auth.js`

Overview: Kick OAuth 2.1 flow for streamers linking their Kick channel.

| Handler | Purpose |
| --- | --- |
| `handleKickAuthStart` |  |
| `handleKickAuthCallback` |  |
| `handleKickAuthDisconnect` |  |


### `apps/leaderboard/src/handlers/kick-webhook.js`

Overview: Kick webhook handler for channel-point reward redemptions. Keeps the request thread thin: verify the signature, filter the event, then drop it onto the shared events queue. The consumer durably grants credits.

| Handler | Purpose |
| --- | --- |
| `handleKickWebhook` |  |


### `apps/leaderboard/src/handlers/leads.js`

Overview: Lead submission handler

| Handler | Purpose |
| --- | --- |
| `handleLead` |  |


### `apps/leaderboard/src/handlers/log.js`

Overview: Client-side error / log ingestion endpoint. Dashboard JS posts here so client errors are correlated with server logs, Sentry, and the original request ID.

| Handler | Purpose |
| --- | --- |
| `handleLog` |  |


### `apps/leaderboard/src/handlers/overlays.js`

Overview: OBS Live Overlays & Audio-Visual Alerts Suite.

| Handler | Purpose |
| --- | --- |
| `handleOverlayPredictionPage` | GET /overlay/prediction — Transparent OBS Browser Source for active Prediction HUD |
| `handleOverlayAlertsPage` | GET /overlay/alerts — Transparent OBS Browser Source for Audio-Visual Alerts & Sound effects |
| `handleGetActiveEvents` | GET /api/overlays/active-events — Live events endpoint for OBS overlays |


### `apps/leaderboard/src/handlers/predictions.js`

Overview: Live Predictions & Voting Handlers.

| Handler | Purpose |
| --- | --- |
| `handleGetPredictions` | GET /api/predictions — List predictions for the site |
| `handleCreatePrediction` | POST /api/predictions — Create a new prediction |
| `handleLockPrediction` | POST /api/predictions/:id/lock — Lock betting on prediction |
| `handleSettlePrediction` | POST /api/predictions/:id/settle — Settle prediction and distribute proportional payouts |
| `handleCancelPrediction` | POST /api/predictions/:id/cancel — Cancel prediction and refund all bets |


### `apps/leaderboard/src/handlers/preview.js`

| Handler | Purpose |
| --- | --- |
| `handleDashboardPreview` |  |


### `apps/leaderboard/src/handlers/public.js`

Overview: Public API handlers for leaderboard data access

| Handler | Purpose |
| --- | --- |
| `handlePublicStandings` | Handle GET /api/public/:slug/standings Returns full standings JSON for embedding / Telegram bot queries |
| `handlePublicPlayers` | Handle GET /api/public/:slug/players Returns lightweight players-only endpoint for live polling |
| `handlePublicStream` | Handle GET /api/public/:slug/stream Server-Sent Events for live leaderboard updates (replaces 30s polling). |
| `handlePublicRank` | Handle GET /api/public/:slug/rank?user=X Returns plain-text rank lookup for Nightbot / Streamlabs custom commands |
| `handlePublicData` | Handle GET /api/public/:slug (generic endpoint) Returns the full leaderboard data as JSON |
| `handlePublicStats` | Handle GET /api/public/:slug/stats Public stats page for publishers/streamers to share. Returns summary counts and a 14-day views series. |


### `apps/leaderboard/src/handlers/quests.js`

Overview: Daily Quests & Streaks Engine Handlers.

| Handler | Purpose |
| --- | --- |
| `handleGetDailyQuests` | GET /api/quests/daily — Get today's quests and viewer progress |
| `handleClaimQuestReward` | POST /api/quests/claim — Viewer claims reward for completed quest |
| `handleTrackQuestProgress` | POST /api/quests/progress — Track activity progress for viewer |


### `apps/leaderboard/src/handlers/quick-add.js`

| Handler | Purpose |
| --- | --- |
| `handleQuickAdd` | POST /api/sites/:id/quick-add Takes { name: "Steve", amount: 500 } Updates existing player or creates new one, then saves board. |


### `apps/leaderboard/src/handlers/referrals.js`

Overview: Referral dashboard API: returns the authenticated user's referral link and stats.

| Handler | Purpose |
| --- | --- |
| `handleReferrals` |  |


### `apps/leaderboard/src/handlers/scores.js`

Overview: Score postback handler (authenticated via X-Postback-Key + HMAC-SHA256 signature)

| Handler | Purpose |
| --- | --- |
| `handleScores` | POST /api/scores — authenticated by X-Postback-Key header + X-Postback-Signature HMAC. Validates key against sites table, checks Pro plan gate, replaces player list. |


### `apps/leaderboard/src/handlers/security.js`

Overview: Security center handlers: password change, active sessions, and GDPR/CCPA export.

| Handler | Purpose |
| --- | --- |
| `handleChangePassword` |  |
| `handleListSessions` |  |
| `handleRevokeOtherSessions` |  |
| `handleExportData` |  |
| `handleCreateExportJob` |  |
| `handleExportJobStatus` |  |
| `handleExportJobDownload` |  |


### `apps/leaderboard/src/handlers/sites.js`

Overview: Site handlers: get, put, list, create, archive, stats, heatmap, notifications, custom domain

| Handler | Purpose |
| --- | --- |
| `handleStats` |  |
| `handleExportStats` |  |
| `handleExportPlayers` |  |
| `handleHeatmap` |  |
| `handleTrackCopy` |  |
| `handleTrackScroll` |  |
| `handleGetSite` |  |
| `handleListBoards` |  |
| `handleCreateBoard` |  |
| `handleArchive` | POST /api/site/archive — { label?, clear: "wagers"\|"players"\|"none" } |
| `handleArchiveDelete` | POST /api/site/archive/delete — { id, siteId? } |
| `handleRestoreArchive` | POST /api/site/archive/restore — { archiveId, siteId? } |
| `handlePutSite` |  |
| `handleFinishSetup` | POST /api/site/finish — mark the wizard-created board as finished. |
| `handlePutTheme` |  |
| `handleDeleteSite` | DELETE /api/site — { siteId } |
| `handleSetActive` | POST /api/site/active — { siteId } |
| `handleDuplicateBoard` | POST /api/site/duplicate — { siteId } |
| `handleNotifyTest` | POST /api/site/notify/test — send a test Discord or Telegram notification. |
| `handleDomainVerify` | POST /api/site/domain/verify — verify custom domain CNAME and provision TLS via Cloudflare for SaaS custom hostnames. Pro/Agency only. |
| `handlePostSiteSections` | POST /api/site/sections — toggle public viewer sections (shop, credits, games). |
| `handleGetSiteGameSettings` | GET /api/site/games/settings |
| `handlePostSiteGameSettings` | POST /api/site/games/settings |


### `apps/leaderboard/src/handlers/team.js`

Overview: YourRank — TEAM & MODERATOR HANDLERS API endpoints for inviting, managing, and accepting moderator & manager roles

| Handler | Purpose |
| --- | --- |
| `handleTeamList` | GET /api/site/team?siteId=... List members and pending invites for a site. |
| `handleTeamInvite` | POST /api/site/team/invite Send or generate an invite for a mod or manager. |
| `handleTeamRevokeInvite` | POST /api/site/team/invite/revoke Cancel an active invitation. |
| `handleTeamRemoveMember` | POST /api/site/team/remove Remove a member from the site. |
| `handleTeamUpdateRole` | POST /api/site/team/role Update role of a member (e.g. moderator <-> manager). |
| `handleTeamAcceptInvite` | POST /api/site/team/accept-invite Accept an invite for the current user. |
| `handleGetInviteInfo` | GET /api/site/team/invite-info?token=... Fetch public metadata about an invite. |


### `apps/leaderboard/src/handlers/telegram-link.js`

Overview: Telegram identity linking handler (Phase 5.1) Allows users to link their Telegram account to their existing email/password account. After linking, the bot dashboard can use the main session.

| Handler | Purpose |
| --- | --- |
| `handleTelegramLink` | POST /api/auth/telegram/link Link a Telegram identity to the current user's account. Body: { id, first_name, last_name, username, photo_url, auth_date, hash } Verifies the Telegram Login widget payloa |
| `handleTelegramUnlink` | POST /api/auth/telegram/unlink Unlink Telegram identity from the current user's account. |
| `handleTelegramStatus` | GET /api/auth/telegram/status Check if the current user has a linked Telegram account. |


### `apps/leaderboard/src/handlers/tournaments.js`

Overview: Tournament & Elimination Brackets Handlers.

| Handler | Purpose |
| --- | --- |
| `handleGetTournaments` | GET /api/tournaments — List tournaments for site |
| `handleCreateTournament` | POST /api/tournaments — Streamer creates a single-elimination tournament bracket |
| `handleOpenTournamentSignups` |  |
| `handleLockTournamentSignups` |  |
| `handleUpdateTournamentSettings` | POST /api/tournaments/:id/settings — Update the quiet tournament options. |
| `handleListTournamentEntries` | GET /api/tournaments/:id/entries — Private, rate-limited streamer entry list. |
| `handleAddTournamentEntry` | POST /api/tournaments/:id/entries — Add one streamer-sourced entry. |
| `handleRemoveTournamentEntry` |  |
| `handleBlockTournamentEntry` |  |
| `handleRestoreTournamentEntry` |  |
| `handleRandomPickTournamentEntries` |  |
| `handleUpdateMatchScore` | POST /api/tournaments/:id/score — Streamer updates match score & advances winner |
| `handleGetBracket` | GET /api/tournaments/:id/bracket — Get bracket tree for viewer & streamer |


### `apps/leaderboard/src/handlers/viewer-auth.js`

Overview: Viewer OAuth login: Kick and Discord. Separate from streamer OAuth so viewers get their own /me dashboard.

| Handler | Purpose |
| --- | --- |
| `handleKickViewerAuthStart` | --- Kick --- |
| `handleKickViewerAuthCallback` |  |
| `handleKickViewerAuthHandoff` |  |
| `handleDiscordViewerAuthStart` | --- Discord --- |
| `handleDiscordViewerAuthCallback` |  |
| `handleViewerLogout` | --- Logout --- |


### `apps/leaderboard/src/handlers/viewer-dashboard.js`

Overview: Viewer-facing dashboard API: cross-board credits, per-board shop, and redeem.

| Handler | Purpose |
| --- | --- |
| `handleViewerMe` |  |
| `handleViewerSite` |  |
| `handleViewerRedeem` |  |


### `apps/leaderboard/src/handlers/viewer-export.js`

| Handler | Purpose |
| --- | --- |
| `handleCreateViewerExportJob` |  |
| `handleViewerExportStatus` |  |
| `handleViewerExportDownload` |  |


### `apps/leaderboard/src/handlers/wheel.js`

Overview: Lucky Wheel Interactive Game Handlers.

| Handler | Purpose |
| --- | --- |
| `handleGetWheelConfig` | GET /api/games/wheel/config — Get wheel config for site |
| `handleUpdateWheelConfig` | POST /api/games/wheel/config — Streamer updates wheel config |
| `handleSpinWheel` | POST /api/games/wheel/spin — Viewer spins the wheel |


## 7. Navigation structure

- **Public marketing nav** (`packages/shared/src/shell-nav.ts`): Home, Pricing, Docs, Telegram, Login, theme toggle, mobile hamburger.

- **Authenticated dashboard chrome** (`packages/shared/src/dashboard-chrome.ts`): collapsible rail, topbar, site switcher, profile menu, breadcrumbs, publish/draft status.

- **Dashboard editor tabs** (`assets/dashboard/routes.js`): setup / players / design / share / history for Leaderboard; activity / referrals / events for Analytics.

- **Public site shell** (`assets/site-shell.js` + `assets/shell-nav.js`): mobile section drawer, standings tabs, player search, pagination, feedback dialog, shop redeem, countdown.

- **Bot dashboard chrome** (`apps/bot/src/dashboard-views/app.ts` + `shell.ts`): Telegram tabs (Overview / Bots / Commands / Offers / Broadcasts) inside shared chrome.


## 8. Modals, drawers, tooltips, dialogs, hidden UI

- `YRDialog` (`assets/dialog.js`): shared modal/confirm system with `open({title, body, confirmText, cancelText, onClose, render})`.

- Unsaved-changes modal (`chooseDirtyAction`) in `assets/dashboard/shell.js` with Save / Discard / Cancel.

- Account delete confirmation modal; invite-team-member modal.

- Dashboard mobile drawer (`lbSide`, `lb-menu`, `lb-backdrop`) with focus trap.

- Public site mobile drawer (`yr-side`, `yr-scrim`, `yr-menu`, `yr-side-close`).

- Feedback `<dialog id='yr-feedback'>` with `yr-feedback-close`, `yr-feedback-status`.

- Admin 2FA setup QR code (`tfaQr`) and recovery-code list.

- `hidden` attribute toggled for dynamic section containers, tab panels, conditional form blocks, feature-gated controls.

- `data-egroup` toggles editor sub-sections (setup, players, design, share, history).

- `data-tab` / `data-tabpanel` controls public leaderboard standings tabs.


## 9. API calls and data flow summary

- Leaderboard dashboard: `jsonReq()` in `assets/dashboard/request.js` for CSRF-protected `POST/PUT/DELETE` to `/api/*`.

- Public viewer pages: `fetch()` to `/api/public/*`, `/api/viewer/*`, `/api/feedback`.

- Bot dashboard: `api()` helper against `/bot/dash/api/*` and Telegram Login Widget.

- Viewer auth: Kick/Discord OAuth at `/api/viewer/auth/*` and `/api/auth/kick` for streamers.

- Telegram updates: `/hook/:secret` handled by `apps/bot/src/botEngine.ts`.

- Postbacks: signed `POST /pb`; legacy `/pb/:key` still accepted.

- Analytics writes: `createQueueProducer` → `yourrank-events` → `apps/consumer`.


## 10. Cross-check checklist for UI/UX changes

- [ ] All marketing pages in §2.8 still render.
- [ ] All Leaderboard page routes in §2.2 still route correctly.
- [ ] All Leaderboard API routes in §2.1 still respond with correct methods.
- [ ] All Bot Worker routes in §2.5 still respond.
- [ ] Monitor Worker routes in §2.7 still work.
- [ ] Dashboard rail nav items in §3.3 are present and link correctly.
- [ ] Core SPA sections in §3.1 load without 404s.
- [ ] Dynamic sections in §3.2 load via `/dashboard/_content` fragments.
- [ ] State keys in §4.1 are read/written as before.
- [ ] Every `id` referenced by client JS still exists in rendered HTML.
- [ ] Every `data-*` attribute used by JS still exists in rendered HTML.
- [ ] All forms, buttons, inputs, and selects listed in §5 are still present.
- [ ] All `fetch`/`jsonReq`/`api` endpoints listed in §5 still match backend routes.
- [ ] Modal/drawer open, close, focus-trap, and Escape behavior still work.
- [ ] Hidden/conditional panels are reachable when their conditions are met.
- [ ] Mobile hamburger menu opens/closes and inert background is restored.
- [ ] Public site player search, tabs, load-more, and feedback dialog still work.
- [ ] Viewer `/me` shop redeem flow still works and idempotency key is preserved.
- [ ] Kick connection card copy and reconnect action still appear when expected.
- [ ] Account Team GET/mutation site scoping from Phase 7 still works.
- [ ] Tournament score transaction rollback from Phase 6 still works.
