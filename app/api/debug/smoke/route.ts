// app/api/debug/smoke/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const r: any = { ok: true, checks: {} };

  // 1) Variables KV
  r.checks.env = {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
  };

  // 2) Keys mínimas
  const keys = await kv.keys("*");
  r.checks.keysCount = keys.length;
  r.checks.someKeys = keys.slice(0, 20);

  // 3) Contacts index
  const contactsIdx = (await kv.zrange("idx:contacts", 0, 50, { rev: true })) as string[];
  r.checks.contactsIdx = contactsIdx;

  // 4) Primer contacto (si hay)
  if (contactsIdx.length) {
    const waId = contactsIdx[0];
    const c = await kv.hgetall(`contact:${waId}`);
    const listLen = await kv.llen(`messages:${waId}`);
    const items = await kv.lrange(`messages:${waId}`, 0, Math.min(listLen - 1, 4));
    r.sample = { waId, contact: c, listLen, rawItems: items };

    // intentar parsear
    const parsed: any[] = [];
    for (const it of items) {
      try { parsed.push(JSON.parse(it as string)); }
      catch { parsed.push({ _raw: it, _err: "NO_JSON" }); }
    }
    r.sample.parsed = parsed;
  } else {
    r.sample = { note: "No hay contactos indexados en idx:contacts" };
  }

  return NextResponse.json(r);
}
