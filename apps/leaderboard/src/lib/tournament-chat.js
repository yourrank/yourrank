// Posts a tournament message into the streamer's Kick chat with the Kick
// authorization that proves the tournament site's channel. Callers own throttling and wording; this owns token refresh and
// failure logging, and never throws for Kick-side failures.
import { query } from "@yourrank/shared/db";
import {
  getValidKickAccessToken,
  isDefinitiveKickAuthorizationFailure,
  postKickChatMessage,
} from "@yourrank/shared/kick-oauth";
import {
  loadChannelAuthorization,
  storeChannelAuthorizationTokens,
} from "@yourrank/shared/provider-connections";

const replyFailed = (tournamentId, status, reason) =>
  console.error(JSON.stringify({ event: "tournament_chat_reply_failed", tournamentId, status, reason }));

export async function sendTournamentChatMessage(env, {
  tournamentId,
  siteId,
  broadcasterUserId = null,
  content,
  replyToMessageId = null,
}, {
  postChatMessage = postKickChatMessage,
  getAccessToken = getValidKickAccessToken,
  loadAuthorization = loadChannelAuthorization,
  storeTokens = storeChannelAuthorizationTokens,
  dbRun = (sql, params) => query(sql, params),
} = {}) {
  const connection = await loadAuthorization(dbRun, siteId, "kick");
  if (!connection?.accessTokenEnc) {
    replyFailed(tournamentId, null, "reconnect_kick_for_chat_write");
    return false;
  }
  let tokenSet;
  try {
    tokenSet = await getAccessToken(
      env,
      connection.accessTokenEnc,
      connection.refreshTokenEnc || null,
      connection.tokenExpiresAt
    );
  } catch (err) {
    replyFailed(
      tournamentId,
      null,
      isDefinitiveKickAuthorizationFailure(err)
        ? "reconnect_kick_for_chat_write"
        : "token_refresh_failed"
    );
    return false;
  }
  await storeTokens(dbRun, connection, {
    accessTokenEnc: tokenSet.accessEnc,
    refreshTokenEnc: tokenSet.refreshEnc,
    tokenExpiresAt: tokenSet.expiresAt,
  });
  try {
    await postChatMessage(tokenSet.accessToken, {
      broadcasterUserId: broadcasterUserId || connection.externalChannelId,
      content,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    });
    return true;
  } catch (err) {
    const status = Number(/\b(\d{3})\b/.exec(String(err?.message || err))?.[1]) || null;
    replyFailed(
      tournamentId,
      status,
      status === 401 || status === 403
        ? "reconnect_kick_for_chat_write"
        : String(err?.message || err).slice(0, 200)
    );
    return false;
  }
}

const listNames = (names, total) => {
  const shown = names.slice(0, 3);
  const rest = total - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
};

// "@nova You're in for Friday Cup! 5 players so far." — or, when other joins
// were not confirmed individually (replies throttled), they ride along:
// "@nova You're in for Friday Cup, along with kai, lux and 5 others. 12 players so far."
export function joinConfirmationText({ senderUsername, title, others = [], othersTotal = 0, playerCount = 0 }) {
  const forTitle = title ? ` for ${title}` : "";
  const count = playerCount > 0 ? ` ${playerCount} ${playerCount === 1 ? "player" : "players"} so far.` : "";
  const total = Math.max(othersTotal, others.length);
  if (total > 0 && others.length > 0) {
    return `@${senderUsername} You're in${forTitle}, along with ${listNames(others, total)}.${count}`;
  }
  return `@${senderUsername} You're in${forTitle}!${count}`;
}

export function championAnnouncementText({ title, champion, runnerUp, scores }) {
  const where = title ? ` of ${title}` : "";
  const versus = runnerUp
    ? scores ? ` Final: ${champion} ${scores[0]}–${scores[1]} ${runnerUp}.` : ` They beat ${runnerUp} in the final.`
    : "";
  return `🏆 ${champion} is the champion${where}!${versus} GG everyone.`;
}
