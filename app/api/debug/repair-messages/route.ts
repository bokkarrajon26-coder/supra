import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

async function repair() {
  const keys = await kv.keys("messages:*");
  const report: any[] = [];

  for (const key of keys) {
    const items = await kv.lrange<any>(key, 0, -1);
    const keep: string[] = [];
    let fixed = 0, removed = 0;

    for (const it of items) {
      if (typeof it === "string") {
        try { JSON.parse(it); keep.push(it); } catch { removed++; }
      } else if (it && typeof it === "object") {
        try { keep.push(JSON.stringify(it)); fixed++; } catch { removed++; }
      } else removed++;
    }

    await kv.del(key);
    if (keep.length) await kv.rpush(key, ...keep);
    report.push({ key, total: items.length, kept: keep.length, fixed, removed });
  }

  return NextResponse.json({ ok: true, report });
}

export async function POST() { return repair(); }
export async function GET() { return repair(); } // bórralo luego
