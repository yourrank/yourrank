// Route table: maps HTTP paths and methods to handler functions.
// Consumed by router.js, which registers each entry on the Hono app.
// (:slug/:id are Hono path params, read via c.req.param() in router.js.)

// withHandler wraps every route in a safety-net try/catch so an unexpected
// throw never kills the Worker invocation without a response.
import { withHandler } from "./middleware/handler.js";

import {
  handleSignup, handleLogin, handleLogout, handleMe, handleForgot, handleReset,
  handleVerifyEmail, handleResendVerification, handleDemoLogin
} from "./handlers/auth.js";
import {
  handleChangePassword, handleListSessions, handleRevokeOtherSessions,
  handleCreateExportJob, handleExportJobStatus, handleExportJobDownload
} from "./handlers/security.js";
import {
  handleTelegramLink, handleTelegramUnlink, handleTelegramStatus
} from "./handlers/telegram-link.js";
import {
  handleStats, handleHeatmap, handleTrackCopy, handleTrackScroll, handleGetSite, handleListBoards,
  handleCreateBoard, handleDuplicateBoard, handleArchive, handleArchiveDelete, handleRestoreArchive, handlePutSite,
  handleFinishSetup, handlePutTheme, handleDeleteSite, handleSetActive, handleNotifyTest, handleDomainVerify, handleExportStats,
  handleExportPlayers, handlePostSiteSections, handleGetSiteGameSettings, handlePostSiteGameSettings
} from "./handlers/sites.js";
import {
  handleTeamList,
  handleTeamInvite,
  handleTeamRevokeInvite,
  handleTeamRemoveMember,
  handleTeamAcceptInvite,
  handleGetInviteInfo,
} from "./handlers/team.js";
import { handleTrial } from "./handlers/billing.js";
import { handleReferrals } from "./handlers/referrals.js";
import { handleLead } from "./handlers/leads.js";
import { handleAttribution, handleAttributionExport, handlePostback, handleRotatePostbackKey, handleRevokePostbackKey } from "./handlers/attribution.js";
import {
  handleAccountPostbacks,
  handleAccountPostbacksRotate,
  handleAccountPostbacksRevoke,
  handleAccountPostbacksTest,
  handleAccountConversions,
  handleAccountConnectedAccounts,
} from "./handlers/account.js";
import { handleInsights } from "./handlers/insights.js";
import { handleContact } from "./handlers/contact.js";
import { handleFeedback } from "./handlers/feedback.js";
import { handleCspReport } from "./handlers/csp-report.js";
import { handleLog } from "./handlers/log.js";
import { handleScores } from "./handlers/scores.js";
import { handleQuickAdd } from "./handlers/quick-add.js";
import { handleKickWebhook } from "./handlers/kick-webhook.js";
import { handleGiveawayChatroom } from "./handlers/giveaway.js";
import { handleGetActivities } from "./handlers/activities.js";
import {
  handleDomainSearch,
  handleDomainPurchase,
  handleGetMyDomain,
  handleDomainToggleLock,
  handleDomainTransferAuthCode,
} from "./handlers/domains.js";
import {
  handleGetRaffles,
  handleCreateRaffle,
  handleDrawRaffle,
  handleGetCodeDrops,
  handleCreateCodeDrop,
  handleClaimCodeDrop,
} from "./handlers/events.js";
import {
  handleGetPredictions,
  handleCreatePrediction,
  handleLockPrediction,
  handleSettlePrediction,
  handleCancelPrediction,
} from "./handlers/predictions.js";
import {
  handleGetWheelConfig,
  handleUpdateWheelConfig,
  handleSpinWheel,
} from "./handlers/wheel.js";
import {
  handleGetSeason,
  handleCreateSeason,
  handleClaimTierReward,
  handleAwardXp,
} from "./handlers/battlepass.js";
import {
  handleOverlayPredictionPage,
  handleOverlayAlertsPage,
  handleGetActiveEvents,
} from "./handlers/overlays.js";
import {
  handleGetDailyQuests,
  handleClaimQuestReward,
  handleTrackQuestProgress,
} from "./handlers/quests.js";
import {
  handleGetDuels,
  handleCreateDuel,
  handleAcceptDuel,
  handleDeclineDuel,
} from "./handlers/duels.js";
import {
  handleGetTournaments,
  handleCreateTournament,
  handleUpdateMatchScore,
  handleGetBracket,
  handleOpenTournamentSignups,
  handleLockTournamentSignups,
  handleUpdateTournamentSettings,
  handleListTournamentEntries,
  handleAddTournamentEntry,
  handleRemoveTournamentEntry,
  handleBlockTournamentEntry,
  handleRestoreTournamentEntry,
  handleRandomPickTournamentEntries,
} from "./handlers/tournaments.js";
import {
  handleExportRaffleWinnersCsv,
  handleExportDropClaimsCsv,
  handleExportPredictionsCsv,
} from "./handlers/exports.js";
import {
  handleKickAuthStart,
  handleKickAuthCallback,
  handleKickAuthDisconnect,
} from "./handlers/kick-auth.js";
import {
  handleCreditsStatus,
  handleCreditsConnect,
  handleCreditsSaveReward,
  handleCreditsCreateReward,
  handleCreditsDeleteReward,
  handleCreditsSaveShopItem,
  handleCreditsDeleteShopItem,
  handleCreditsUpdateRedemption,
  handleCreditsAnalytics,
  handleCreditsViewerHistory,
  handleCreditsActivity,
  handleCreditsAdjustBalance,
  handleCreditsReconcile,
  handlePublicCredits,
  handleCreditsViewerAuth,
} from "./handlers/credits.js";
import { handleCreditsBlockViewer } from "./handlers/credits-block.js";
import {
  handleCreatorClaimDetail,
  handleCreatorClaimTransition,
  handleCreatorClaims,
  handleViewerClaimDetail,
  handleViewerClaims,
} from "./handlers/claims.js";
import {
  handlePeopleMemberDetail,
  handlePeopleMembers,
} from "./handlers/people.js";
import {
  handlePeopleReviewDecision,
  handlePeopleReviewDetail,
  handlePeopleReviews,
} from "./handlers/people-reviews.js";
import {
  handleKickViewerAuthStart,
  handleKickViewerAuthCallback,
  handleKickViewerAuthHandoff,
  handleDiscordViewerAuthStart,
  handleDiscordViewerAuthCallback,
  handleViewerLogout,
} from "./handlers/viewer-auth.js";
import {
  handleViewerMe,
  handleViewerJoin,
  handleViewerRedeem,
} from "./handlers/viewer-dashboard.js";
import {
  handleGamesConfig,
  handleGamesBet,
  handleGamesMinesReveal,
  handleGamesMinesCashout,
  handleGamesHistory,
  handleGamesFairness,
  handleGamesFairnessRotate,
} from "./handlers/games.js";
import {
  handleCreateViewerExportJob,
  handleViewerExportStatus,
  handleViewerExportDownload,
} from "./handlers/viewer-export.js";
import { handleApiDocs, handleOpenApiJson } from "./handlers/docs.js";
import { handleBillingUnavailable, handleUserPayments, handleAccountUsage } from "./billing.js";
import {
  handleOverview, handleUsers, handleLeads, handlePayments, handleAction,
  handleSupportMessages, handleSupportReply, handleAudit,
  handle2faEnable, handle2faVerify, handle2faRecovery, handle2faStatus, handle2faDisable,
  handleFeatureFlags, handleFeatureFlagOverride,
  handleGetIdentity, handleUpdateIdentity
} from "./admin.js";
import {
  handleBackupHealth, handleRecordBackupVerification, handleListBackupVerifications
} from "./handlers/backup.js";
import {
  handlePublicStandings, handlePublicPlayers, handlePublicStream, handlePublicRank, handlePublicData, handlePublicStats
} from "./handlers/public.js";

export const ROUTES = [
  // Auth routes (CSRF-exempt: callers may not have a CSRF cookie yet)
  { path: "/auth/demo", method: "GET", handler: withHandler(handleDemoLogin) },
  { path: "/api/auth/signup", method: "POST", handler: withHandler(handleSignup) },
  { path: "/api/auth/login", method: "POST", handler: withHandler(handleLogin) },
  { path: "/api/auth/me", method: "GET", handler: withHandler(handleMe) },
  { path: "/api/auth/forgot", method: "POST", handler: withHandler(handleForgot) },
  { path: "/api/auth/reset", method: "POST", handler: withHandler(handleReset) },
  { path: "/api/auth/verify", method: "POST", handler: withHandler(handleVerifyEmail) },
  { path: "/api/auth/resend-verification", method: "POST", handler: withHandler(handleResendVerification) },
  
  // Authenticated auth routes (CSRF required)
  { path: "/api/auth/logout", method: "POST", handler: withHandler(handleLogout) },
  { path: "/api/auth/change-password", method: "POST", handler: withHandler(handleChangePassword) },
  { path: "/api/auth/sessions", method: "GET", handler: withHandler(handleListSessions) },
  { path: "/api/auth/sessions/revoke-others", method: "POST", handler: withHandler(handleRevokeOtherSessions) },

  // Data export
  { path: "/api/account/export", method: "POST", handler: withHandler(handleCreateExportJob) },
  { path: "/api/account/export/:id/status", method: "GET", handler: withHandler(handleExportJobStatus) },
  { path: "/api/account/export/:id/download", method: "GET", handler: withHandler(handleExportJobDownload) },
  
  // Telegram identity linking
  { path: "/api/auth/telegram/link", method: "POST", handler: withHandler(handleTelegramLink) },
  { path: "/api/auth/telegram/unlink", method: "POST", handler: withHandler(handleTelegramUnlink) },
  { path: "/api/auth/telegram/status", method: "GET", handler: withHandler(handleTelegramStatus) },
  
  // Site routes
  { path: "/api/site", method: "GET", handler: withHandler(handleGetSite) },
  { path: "/api/site", method: "PUT", handler: withHandler(handlePutSite) },
  { path: "/api/site/sections", method: "POST", handler: withHandler(handlePostSiteSections) },
  { path: "/api/site/games/settings", method: "GET", handler: withHandler(handleGetSiteGameSettings) },
  { path: "/api/site/games/settings", method: "POST", handler: withHandler(handlePostSiteGameSettings) },
  { path: "/api/site/finish", method: "POST", handler: withHandler(handleFinishSetup) },
  { path: "/api/site/theme", method: "POST", handler: withHandler(handlePutTheme) },
  { path: "/api/site", method: "DELETE", handler: withHandler(handleDeleteSite) },
  { path: "/api/site/list", method: "GET", handler: withHandler(handleListBoards) },
  { path: "/api/site/create", method: "POST", handler: withHandler(handleCreateBoard) },
  { path: "/api/site/duplicate", method: "POST", handler: withHandler(handleDuplicateBoard) },
  { path: "/api/site/archive", method: "POST", handler: withHandler(handleArchive) },
  { path: "/api/sites/:id/quick-add", method: "POST", handler: withHandler(handleQuickAdd) },
  { path: "/api/site/archive/delete", method: "POST", handler: withHandler(handleArchiveDelete) },
  { path: "/api/site/archive/restore", method: "POST", handler: withHandler(handleRestoreArchive) },
  { path: "/api/site/active", method: "POST", handler: withHandler(handleSetActive) },
  { path: "/api/site/stats/export", method: "GET", handler: withHandler(handleExportStats) },
  { path: "/api/site/players/export", method: "GET", handler: withHandler(handleExportPlayers) },
  { path: "/api/site/stats", method: "GET", handler: withHandler(handleStats) },
  { path: "/api/site/stats/heatmap", method: "GET", handler: withHandler(handleHeatmap) },
  { path: "/api/site/notify/test", method: "POST", handler: withHandler(handleNotifyTest) },
  { path: "/api/site/domain/verify", method: "POST", handler: withHandler(handleDomainVerify) },

  // Domain search, purchase, and transfer routes
  { path: "/api/domains/search", method: "POST", handler: withHandler(handleDomainSearch) },
  { path: "/api/domains/purchase", method: "POST", handler: withHandler(handleDomainPurchase) },
  { path: "/api/domains/my-domain", method: "GET", handler: withHandler(handleGetMyDomain) },
  { path: "/api/domains/toggle-lock", method: "POST", handler: withHandler(handleDomainToggleLock) },
  { path: "/api/domains/transfer-auth-code", method: "POST", handler: withHandler(handleDomainTransferAuthCode) },

  // Team & moderator routes
  { path: "/api/site/team", method: "GET", handler: withHandler(handleTeamList) },
  { path: "/api/site/team/invite", method: "POST", handler: withHandler(handleTeamInvite) },
  { path: "/api/site/team/invite/revoke", method: "POST", handler: withHandler(handleTeamRevokeInvite) },
  { path: "/api/site/team/remove", method: "POST", handler: withHandler(handleTeamRemoveMember) },
  { path: "/api/site/team/accept-invite", method: "POST", handler: withHandler(handleTeamAcceptInvite) },
  { path: "/api/site/team/invite-info", method: "GET", handler: withHandler(handleGetInviteInfo) },
  
  // Public routes (CSRF-exempt)
  { path: "/api/lead", method: "POST", handler: withHandler(handleLead) },
  { path: "/api/contact", method: "POST", handler: withHandler(handleContact) },
  { path: "/api/feedback", method: "POST", handler: withHandler(handleFeedback) },
  { path: "/api/track/copy", method: "POST", handler: withHandler(handleTrackCopy) },
  { path: "/api/track/scroll", method: "POST", handler: withHandler(handleTrackScroll) },
  { path: "/api/scores", method: "POST", handler: withHandler(handleScores) },
  
  // Kick integration webhooks (CSRF-exempt)
  { path: "/webhooks/kick", method: "POST", handler: withHandler(handleKickWebhook) },

  // Kick OAuth
  { path: "/auth/kick", method: "GET", handler: withHandler(handleKickAuthStart) },
  { path: "/auth/kick/callback", method: "GET", handler: withHandler(handleKickAuthCallback) },
  { path: "/api/kick/disconnect", method: "POST", handler: withHandler(handleKickAuthDisconnect) },
  { path: "/api/giveaways/chatroom", method: "GET", handler: withHandler(handleGiveawayChatroom) },

  // Safe Activities foundation (existing free-workflow adapters only)
  { path: "/api/activities", method: "GET", handler: withHandler(handleGetActivities) },
  
  // Community Events: Raffles & Flash Code Drops
  { path: "/api/events/raffles", method: "GET", handler: withHandler(handleGetRaffles) },
  { path: "/api/events/raffles", method: "POST", handler: withHandler(handleCreateRaffle) },
  { path: "/api/events/raffles/draw", method: "POST", handler: withHandler(handleDrawRaffle) },
  { path: "/api/events/drops", method: "GET", handler: withHandler(handleGetCodeDrops) },
  { path: "/api/events/drops", method: "POST", handler: withHandler(handleCreateCodeDrop) },
  { path: "/api/events/drops/claim", method: "POST", handler: withHandler(handleClaimCodeDrop) },

  // Live Predictions & Betting
  { path: "/api/predictions", method: "GET", handler: withHandler(handleGetPredictions) },
  { path: "/api/predictions", method: "POST", handler: withHandler(handleCreatePrediction) },
  { path: "/api/predictions/:id/lock", method: "POST", handler: withHandler(handleLockPrediction) },
  { path: "/api/predictions/:id/settle", method: "POST", handler: withHandler(handleSettlePrediction) },
  { path: "/api/predictions/:id/cancel", method: "POST", handler: withHandler(handleCancelPrediction) },

  // Lucky Wheel Game
  { path: "/api/games/wheel/config", method: "GET", handler: withHandler(handleGetWheelConfig) },
  { path: "/api/games/wheel/config", method: "POST", handler: withHandler(handleUpdateWheelConfig) },
  { path: "/api/games/wheel/spin", method: "POST", handler: withHandler(handleSpinWheel) },

  // Seasonal Battle Pass & Progression
  { path: "/api/battlepass/season", method: "GET", handler: withHandler(handleGetSeason) },
  { path: "/api/battlepass/season", method: "POST", handler: withHandler(handleCreateSeason) },
  { path: "/api/battlepass/claim", method: "POST", handler: withHandler(handleClaimTierReward) },
  { path: "/api/battlepass/award-xp", method: "POST", handler: withHandler(handleAwardXp) },

  // OBS Live Stream Overlays & Alerts
  { path: "/overlay/prediction", method: "GET", handler: withHandler(handleOverlayPredictionPage) },
  { path: "/overlay/alerts", method: "GET", handler: withHandler(handleOverlayAlertsPage) },
  { path: "/api/overlays/active-events", method: "GET", handler: withHandler(handleGetActiveEvents) },

  // Daily Quests & Streaks
  { path: "/api/quests/daily", method: "GET", handler: withHandler(handleGetDailyQuests) },
  { path: "/api/quests/claim", method: "POST", handler: withHandler(handleClaimQuestReward) },
  { path: "/api/quests/progress", method: "POST", handler: withHandler(handleTrackQuestProgress) },

  // Viewer 1v1 Duels
  { path: "/api/duels/active", method: "GET", handler: withHandler(handleGetDuels) },
  { path: "/api/duels/create", method: "POST", handler: withHandler(handleCreateDuel) },
  { path: "/api/duels/:id/accept", method: "POST", handler: withHandler(handleAcceptDuel) },
  { path: "/api/duels/:id/decline", method: "POST", handler: withHandler(handleDeclineDuel) },

  // Tournaments & Elimination Brackets
  { path: "/api/tournaments", method: "GET", handler: withHandler(handleGetTournaments) },
  { path: "/api/tournaments", method: "POST", handler: withHandler(handleCreateTournament) },
  { path: "/api/tournaments/:id/score", method: "POST", handler: withHandler(handleUpdateMatchScore) },
  { path: "/api/tournaments/:id/bracket", method: "GET", handler: withHandler(handleGetBracket) },
  { path: "/api/tournaments/:id/signups/open", method: "POST", handler: withHandler(handleOpenTournamentSignups) },
  { path: "/api/tournaments/:id/signups/lock", method: "POST", handler: withHandler(handleLockTournamentSignups) },
  { path: "/api/tournaments/:id/settings", method: "POST", handler: withHandler(handleUpdateTournamentSettings) },
  { path: "/api/tournaments/:id/entries", method: "GET", handler: withHandler(handleListTournamentEntries) },
  { path: "/api/tournaments/:id/entries", method: "POST", handler: withHandler(handleAddTournamentEntry) },
  { path: "/api/tournaments/:id/entries/:entryId/remove", method: "POST", handler: withHandler(handleRemoveTournamentEntry) },
  { path: "/api/tournaments/:id/entries/:entryId/block", method: "POST", handler: withHandler(handleBlockTournamentEntry) },
  { path: "/api/tournaments/:id/entries/:entryId/restore", method: "POST", handler: withHandler(handleRestoreTournamentEntry) },
  { path: "/api/tournaments/:id/entries/random-pick", method: "POST", handler: withHandler(handleRandomPickTournamentEntries) },

  // One-Click CSV Data Exports
  { path: "/api/export/raffle-winners.csv", method: "GET", handler: withHandler(handleExportRaffleWinnersCsv) },
  { path: "/api/export/drop-claims.csv", method: "GET", handler: withHandler(handleExportDropClaimsCsv) },
  { path: "/api/export/predictions.csv", method: "GET", handler: withHandler(handleExportPredictionsCsv) },

  // Credits / shop dashboard API
  { path: "/api/credits/status", method: "GET", handler: withHandler(handleCreditsStatus) },
  { path: "/api/credits/connect", method: "POST", handler: withHandler(handleCreditsConnect) },
  { path: "/api/credits/rewards/create", method: "POST", handler: withHandler(handleCreditsCreateReward) },
  { path: "/api/credits/rewards", method: "POST", handler: withHandler(handleCreditsSaveReward) },
  { path: "/api/credits/rewards/:id", method: "DELETE", handler: withHandler(handleCreditsDeleteReward) },
  { path: "/api/credits/shop", method: "POST", handler: withHandler(handleCreditsSaveShopItem) },
  { path: "/api/credits/shop/:id", method: "DELETE", handler: withHandler(handleCreditsDeleteShopItem) },
  { path: "/api/credits/redemptions/:id", method: "POST", handler: withHandler(handleCreditsUpdateRedemption) },
  { path: "/api/credits/analytics", method: "GET", handler: withHandler(handleCreditsAnalytics) },
  { path: "/api/credits/viewer/history", method: "GET", handler: withHandler(handleCreditsViewerHistory) },
  { path: "/api/credits/activity", method: "GET", handler: withHandler(handleCreditsActivity) },
  { path: "/api/credits/viewers/:id/balance", method: "POST", handler: withHandler(handleCreditsAdjustBalance) },
  { path: "/api/credits/tip", method: "POST", handler: withHandler(handleCreditsAdjustBalance) },
  { path: "/api/credits/reconcile", method: "GET", handler: withHandler(handleCreditsReconcile) },
  { path: "/api/credits/viewers/:id/block", method: "POST", handler: withHandler(handleCreditsBlockViewer) },

  // Canonical Claims API adapts safe Rewards redemptions without adding a new
  // persistence source or public fulfillment data surface.
  { path: "/api/claims", method: "GET", handler: withHandler(handleCreatorClaims) },
  { path: "/api/claims/:id", method: "GET", handler: withHandler(handleCreatorClaimDetail) },
  { path: "/api/claims/:id/transition", method: "POST", handler: withHandler(handleCreatorClaimTransition) },

  // People uses the current site_viewers relationship without exposing the
  // broader Credits configuration or raw external identity identifiers.
  { path: "/api/people/members", method: "GET", handler: withHandler(handlePeopleMembers) },
  { path: "/api/people/members/:id", method: "GET", handler: withHandler(handlePeopleMemberDetail) },
  { path: "/api/people/reviews", method: "GET", handler: withHandler(handlePeopleReviews) },
  { path: "/api/people/reviews/:id", method: "GET", handler: withHandler(handlePeopleReviewDetail) },
  { path: "/api/people/reviews/:id/decision", method: "POST", handler: withHandler(handlePeopleReviewDecision) },

  // Public credits / shop API (CSRF-exempt, read-only balance lookup)
  { path: "/api/public/credits", method: "GET", handler: withHandler(handlePublicCredits) },

  // Viewer auth (Kick / Discord)
  { path: "/api/viewer/auth/kick", method: "GET", handler: withHandler(handleKickViewerAuthStart) },
  { path: "/api/viewer/auth/kick/callback", method: "GET", handler: withHandler(handleKickViewerAuthCallback) },
  { path: "/api/viewer/auth/kick/handoff", method: "GET", handler: withHandler(handleKickViewerAuthHandoff) },
  { path: "/api/viewer/auth/discord", method: "GET", handler: withHandler(handleDiscordViewerAuthStart) },
  { path: "/api/viewer/auth/discord/callback", method: "GET", handler: withHandler(handleDiscordViewerAuthCallback) },
  { path: "/api/viewer/logout", method: "POST", handler: withHandler(handleViewerLogout) },

  // Viewer dashboard API
  { path: "/api/viewer/me", method: "GET", handler: withHandler(handleViewerMe) },
  { path: "/api/viewer/membership/join", method: "POST", handler: withHandler(handleViewerJoin) },
  { path: "/api/viewer/claims", method: "GET", handler: withHandler(handleViewerClaims) },
  { path: "/api/viewer/claims/:id", method: "GET", handler: withHandler(handleViewerClaimDetail) },
  { path: "/api/viewer/redeem", method: "POST", handler: withHandler(handleViewerRedeem) },
  { path: "/api/viewer/export", method: "POST", handler: withHandler(handleCreateViewerExportJob) },
  { path: "/api/viewer/export/:id/status", method: "GET", handler: withHandler(handleViewerExportStatus) },
  { path: "/api/viewer/export/:id/download", method: "GET", handler: withHandler(handleViewerExportDownload) },

  // Streamer viewer-auth toggles
  { path: "/api/credits/viewer-auth", method: "POST", handler: withHandler(handleCreditsViewerAuth) },

  // Originals games (viewer-facing; POSTs are CSRF-protected by router.js)
  { path: "/api/games/config", method: "GET", handler: withHandler(handleGamesConfig) },
  { path: "/api/games/bet", method: "POST", handler: withHandler(handleGamesBet) },
  { path: "/api/games/mines/reveal", method: "POST", handler: withHandler(handleGamesMinesReveal) },
  { path: "/api/games/mines/cashout", method: "POST", handler: withHandler(handleGamesMinesCashout) },
  { path: "/api/games/history", method: "GET", handler: withHandler(handleGamesHistory) },
  { path: "/api/games/fairness", method: "GET", handler: withHandler(handleGamesFairness) },
  { path: "/api/games/fairness/rotate", method: "POST", handler: withHandler(handleGamesFairnessRotate) },

  // Public API routes (CSRF-exempt)
  { path: "/api/docs", method: "GET", handler: withHandler(handleApiDocs) },
  { path: "/api/openapi.json", method: "GET", handler: withHandler(handleOpenApiJson) },
  { path: "/api/public/:slug/standings", method: "GET", handler: withHandler(handlePublicStandings) },
  { path: "/api/public/:slug/players", method: "GET", handler: withHandler(handlePublicPlayers) },
  { path: "/api/public/:slug/stream", method: "GET", handler: withHandler(handlePublicStream) },
  { path: "/api/public/:slug/rank", method: "GET", handler: withHandler(handlePublicRank) },
  { path: "/api/public/:slug/stats", method: "GET", handler: withHandler(handlePublicStats) },
  { path: "/api/public/:slug", method: "GET", handler: withHandler(handlePublicData) },
  
  // Referrals
  { path: "/api/referrals", method: "GET", handler: withHandler(handleReferrals) },

  // Billing routes
  { path: "/api/billing/checkout", method: "POST", handler: withHandler(handleBillingUnavailable) },
  { path: "/api/billing/trial", method: "POST", handler: withHandler(handleTrial) },
  { path: "/api/account/payments", method: "GET", handler: withHandler(handleUserPayments) },
  { path: "/api/account/usage", method: "GET", handler: withHandler(handleAccountUsage) },
  
  // Bot lifecycle is owned by the bot Worker; obsolete leaderboard routes removed (C-06).

  // Account
  { path: "/api/account/postbacks", method: "GET", handler: withHandler(handleAccountPostbacks) },
  { path: "/api/account/postbacks/rotate", method: "POST", handler: withHandler(handleAccountPostbacksRotate) },
  { path: "/api/account/postbacks", method: "DELETE", handler: withHandler(handleAccountPostbacksRevoke) },
  { path: "/api/account/postbacks/test", method: "POST", handler: withHandler(handleAccountPostbacksTest) },
  { path: "/api/account/conversions", method: "GET", handler: withHandler(handleAccountConversions) },
  { path: "/api/account/connected-accounts", method: "GET", handler: withHandler(handleAccountConnectedAccounts) },
  { path: "/api/insights", method: "GET", handler: withHandler(handleInsights) },

  // Attribution
  { path: "/api/attribution", method: "GET", handler: withHandler(handleAttribution) },
  { path: "/api/attribution/export", method: "GET", handler: withHandler(handleAttributionExport) },
  { path: "/api/attribution/rotate-key", method: "POST", handler: withHandler(handleRotatePostbackKey) },
  { path: "/api/attribution/postback-key", method: "DELETE", handler: withHandler(handleRevokePostbackKey) },
  { path: "/api/postback", method: "POST", handler: withHandler(handlePostback) },
  
  // CSP violation reporting
  { path: "/api/csp-report", method: "POST", handler: withHandler(handleCspReport) },

  // Client-side error reporting
  { path: "/api/log", method: "POST", handler: withHandler(handleLog) },

  // Backup health (public canary for monitor)
  { path: "/api/health/backup", method: "GET", handler: withHandler(handleBackupHealth) },

  // Admin routes
  { path: "/api/admin/backup-verifications", method: "GET", handler: withHandler(handleListBackupVerifications) },
  { path: "/api/admin/backup-verifications", method: "POST", handler: withHandler(handleRecordBackupVerification) },
  { path: "/api/admin/overview", method: "GET", handler: withHandler(handleOverview) },
  { path: "/api/admin/users", method: "GET", handler: withHandler(handleUsers) },
  { path: "/api/admin/leads", method: "GET", handler: withHandler(handleLeads) },
  { path: "/api/admin/payments", method: "GET", handler: withHandler(handlePayments) },
  { path: "/api/admin/support", method: "GET", handler: withHandler(handleSupportMessages) },
  { path: "/api/admin/support/reply", method: "POST", handler: withHandler(handleSupportReply) },
  { path: "/api/admin/audit", method: "GET", handler: withHandler(handleAudit) },
  { path: "/api/admin/action", method: "POST", handler: withHandler(handleAction) },
  { path: "/api/admin/features", method: "GET", handler: withHandler(handleFeatureFlags) },
  { path: "/api/admin/features", method: "POST", handler: withHandler(handleFeatureFlags) },
  { path: "/api/admin/features/override", method: "POST", handler: withHandler(handleFeatureFlagOverride) },
  { path: "/api/admin/identity", method: "GET", handler: withHandler(handleGetIdentity) },
  { path: "/api/admin/identity", method: "PUT", handler: withHandler(handleUpdateIdentity) },
  { path: "/api/admin/2fa/enable", method: "POST", handler: withHandler(handle2faEnable) },
  { path: "/api/admin/2fa/verify", method: "POST", handler: withHandler(handle2faVerify) },
  { path: "/api/admin/2fa/recovery", method: "POST", handler: withHandler(handle2faRecovery) },
  { path: "/api/admin/2fa/status", method: "GET", handler: withHandler(handle2faStatus) },
  { path: "/api/admin/2fa/disable", method: "POST", handler: withHandler(handle2faDisable) },
];
