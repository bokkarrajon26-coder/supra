// app/api/kv/peek/[...keyparts]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { db1, db2 } from "@/lib/db";

// 👉 Elegí cuál base usar:
const db = db1;   // base original
// const db = db2; // base nueva

export async function GET(_: Request, ctx: any) {
  const parts = ctx?.params?.keyparts ?? [];
  const key = Array.isArray(parts) ? parts.join(":") : String(parts || "");
  if (!key) return NextResponse.json({ ok:false, error:"MISSING_KEY" }, { status:400 });

  const raw = await db.lrange<string>(key, 0, -1);

  return NextResponse.json({
    ok:true,
    key,
    count: raw.length,
    head: raw.slice(0, 3),
  });
}
