export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const env = {
      KV_URL: !!process.env.KV_URL,
      KV_REST_API_URL: !!process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    };

    // usar una key nueva para no chocar con datos viejos
    const key = `kv:test:${Date.now()}`;
    const value = { now: Date.now() };
    // SIEMPRE stringify al escribir
    await kv.lpush(key, JSON.stringify(value));
    const raw = await kv.lrange<string>(key, 0, -1);

    // Parse “tolerante”: si no es JSON válido, devolvemos el string tal cual
    const parsed = raw.map((r) => {
      try { return JSON.parse(r); } catch { return r; }
    });

    return NextResponse.json({ ok: true, env, key, size: raw.length, sample: parsed[0] });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
