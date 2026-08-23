import { NextResponse } from "next/server";
import { queryOne } from "@/lib/server/database";
import { objectStore } from "@/lib/server/object-store";
import { campusAccessMode } from "@/lib/server/campus-access-policy";

export async function GET() {
  try {
    const database = await queryOne<{ ok: number }>("SELECT 1 AS ok");
    const store = objectStore();
    return NextResponse.json({
      ok: database?.ok === 1,
      database: process.env.DATABASE_URL?.trim().match(/^postgres(?:ql)?:\/\//i) ? "postgresql" : "sqlite",
      pdfStorage: store.kind,
      directPdfTransfer: Boolean(store.createDirectUpload && store.createDirectDownload),
      campusAccess: campusAccessMode(),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
