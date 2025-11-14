// app/api/tools/assign-inbox/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function POST(req: NextRequest) {
  const { waId, inboxNumber } = await req.json();
  if (!waId || !inboxNumber) {
    return NextResponse.json({ ok: false, error: "Faltan parámetros" }, { status: 400 });
  }

  const key = `contact:${waId}`;
  await kv.hset(key, { inbox_id: inboxNumber });
  return NextResponse.json({ ok: true });
}
