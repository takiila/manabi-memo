import { NextResponse } from "next/server";
import { getLegacyChatGPTAccountIdentity } from "../../account-server";
import { accountForRequest } from "../../server-auth-response";
import { queryOne } from "@/lib/server/database";

export async function GET(request: Request) {
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const account = auth.account;
  const membership = account ? await queryOne<{ activated_at: number }>(
    "SELECT activated_at FROM campus_memberships WHERE user_id = ? AND revoked_at IS NULL",
    [account.id],
  ) : null;
  const legacy = account.provider !== "chatgpt" ? await getLegacyChatGPTAccountIdentity() : null;
  return NextResponse.json({
    authenticated: true,
    account,
    campusBeta: Boolean(membership),
    legacyLinkAvailable: Boolean(legacy && legacy.id !== account.id),
  }, { headers: { "cache-control": "no-store" } });
}
