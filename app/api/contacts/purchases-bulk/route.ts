// app/api/contacts/purchases-bulk/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const norm = (s: string) => String(s || "").replace(/[^\d]/g, "");

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { waIds?: string[] };
    const waIds = Array.isArray(body.waIds) ? body.waIds : [];

    if (!waIds.length) {
      return NextResponse.json({ ok: true, result: {} }, { headers: CORS_HEADERS });
    }

    const result: Record<string, boolean> = {};

    await Promise.all(
      waIds.map(async (rawId) => {
        const waId = norm(rawId);
        if (!waId) {
          result[rawId] = false;
          return;
        }

        const listKey = `purchases:${waId}`;
        // con solo saber si hay 1 ya alcanza, no hace falta traer 50
        const first = await kv.lindex(listKey, 0).catch(() => null);
        result[waId] = !!first;
      })
    );

    return NextResponse.json({ ok: true, result }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "BULK_FAILED" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
