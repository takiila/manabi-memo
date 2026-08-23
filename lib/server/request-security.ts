import "server-only";

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
  const requestUrl = new URL(request.url);
  const allowed = new Set([requestUrl.origin]);
  const host = request.headers.get("host");
  if (host) allowed.add(`${requestUrl.protocol}//${host}`);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (forwardedHost) allowed.add(`${forwardedProtocol || requestUrl.protocol.replace(":", "")}://${forwardedHost}`);
  return allowed.has(origin);
}
