// proxycheck.io v3 lookups for giveaway VPN/proxy detection. Every failure is
// ok:false AND logged — eligibility treats an unavailable check as its own
// rejection reason so the streamer learns about it instead of silently
// letting anonymous networks through.

const ANONYMOUS_FLAGS = ["anonymous", "vpn", "proxy", "tor", "hosting"];

export async function checkAnonymousIp(ip, env, fetchImpl = fetch) {
  const fail = (error) => {
    // Never log the key or the client IP.
    console.error("[giveaway] vpn_check_failed:", error);
    return { ok: false, error };
  };
  if (!env?.PROXYCHECK_API_KEY) return fail("proxycheck_not_configured");
  if (!ip) return fail("ip_unavailable");
  let data;
  try {
    const res = await fetchImpl(
      `https://proxycheck.io/v3/${encodeURIComponent(ip)}?key=${encodeURIComponent(env.PROXYCHECK_API_KEY)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return fail(`proxycheck_http_${res.status}`);
    data = await res.json();
  } catch (err) {
    const reason = err?.name === "TimeoutError" || err?.name === "AbortError" ? "proxycheck_timeout" : `proxycheck_request_failed`;
    return fail(reason);
  }
  if (data?.status !== "ok" && data?.status !== "warning") {
    return fail(`proxycheck_status_${data?.status || "unknown"}`);
  }
  const detections = data?.[ip]?.detections;
  if (!detections || typeof detections !== "object") return fail("proxycheck_missing_detections");
  const types = ANONYMOUS_FLAGS.filter((flag) => detections[flag] === true);
  return { ok: true, anonymous: types.length > 0, types };
}
