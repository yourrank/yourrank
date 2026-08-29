// Aggregator: per-page modules re-exported as PAGES

import { loginPage } from "./pages/login.jsx";
import { forgotPage } from "./pages/forgot.js";
import { resetPage } from "./pages/reset.js";
import { signupPage } from "./pages/signup.js";
import { dashboardPage, dashboardNotFoundPage } from "./pages/dashboard.jsx";
import { adminPage } from "./pages/admin.js";
import { admin2faPage } from "./pages/admin-2fa.js";
import { overlayPage } from "./pages/overlay.js";
import { termsPage } from "./pages/terms.js";
import { privacyPage } from "./pages/privacy.js";
import { responsiblePage } from "./pages/responsible.js";
import { refundPage } from "./pages/refund.js";
import { cookiesPage } from "./pages/cookies.js";
import { helpHubPage, helpSupportPage, helpFeedbackPage } from "./pages/help.js";
import {
  rewardsChannelPage,
  rewardsOverviewPage,
  rewardsRulesPage,
  rewardsShopPage,
  rewardsRedemptionsPage,
  rewardsHistoryPage,
} from "./pages/rewards.jsx";
import { audienceMembersPage } from "./pages/audience.jsx";
import { settingsUnifiedPage } from "./pages/account.jsx";
import { reviewsPage } from "./pages/reviews.js";
import { invitePage } from "./pages/invite.jsx";
import { giveawaysPage } from "./pages/giveaways.jsx";
import { activitiesPage } from "./pages/activities.jsx";

export const PAGES = {
  login: loginPage,
  forgot: forgotPage,
  reset: resetPage,
  signup: signupPage,
  dashboard: dashboardPage,
  dashboardNotFound: dashboardNotFoundPage,
  giveaways: giveawaysPage,
  activities: activitiesPage,
  admin: adminPage,
  admin2fa: admin2faPage,
  overlay: overlayPage,
  terms: termsPage,
  privacy: privacyPage,
  responsible: responsiblePage,
  refund: refundPage,
  cookies: cookiesPage,
  helpSupport: helpSupportPage,
  helpFeedback: helpFeedbackPage,
  helpHub: helpHubPage,
  rewardsChannel: rewardsChannelPage,
  rewardsOverview: rewardsOverviewPage,
  rewardsRules: rewardsRulesPage,
  rewardsShop: rewardsShopPage,
  audienceMembers: audienceMembersPage,
  rewardsRedemptions: rewardsRedemptionsPage,
  rewardsHistory: rewardsHistoryPage,
  settingsUnified: settingsUnifiedPage,
  reviews: reviewsPage,
  invite: invitePage,
};
