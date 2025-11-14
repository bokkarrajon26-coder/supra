// app/api/debug/clear-kv/route.ts
import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

export async function GET() {
  const keys = await kv.keys("contact:*");
  for (const k of keys) {
    await kv.del(k);
  }
  return NextResponse.json({ ok: true, deleted: keys.length });
}
