import { NextResponse } from "next/server";

type FirebaseConfigEnv = {
  FIREBASE_API_KEY?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
};

export async function GET() {
  const runtime = process.env as FirebaseConfigEnv;
  const config = {
    apiKey: clean(runtime.FIREBASE_API_KEY),
    appId: clean(runtime.FIREBASE_APP_ID),
    authDomain: clean(runtime.FIREBASE_AUTH_DOMAIN),
    projectId: clean(runtime.FIREBASE_PROJECT_ID),
  };
  const enabled = Object.values(config).every(Boolean);
  return NextResponse.json(
    enabled ? { enabled: true, config } : { enabled: false },
    { headers: { "cache-control": "no-store" } },
  );
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
