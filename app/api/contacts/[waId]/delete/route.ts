// app/api/contacts/[waId]/purchases/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db1, db2 } from "@/lib/db";

/* ─────────── elegir base de datos ─────────── */
// Usá la misma que en purchases y webhook de Twilio
const db = db1; 
// const db = db2;

/* ─────────── helpers ─────────── */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const norm = (s: string) => String(s || "").replace(/[^\d]/g, "");

async function getWaId(context: any): Promise<string> {
  const p = context?.params;
  if (p && typeof p.then === "function") {
    const r = await p; // Next 15
    return norm(r?.waId);
  }
  return norm(p?.waId); // Next 14
}

/* ─────────── OPTIONS ─────────── */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_req: NextRequest, context: any) {
  const waId = await getWaId(context);
  if (!waId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_WAID" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const listKey = `purchases:${waId}`;
  const raw = await db.lrange<string>(listKey, 0, 50).catch(() => []); // 👈 db en vez de kv
  let errors = 0;

  // parse robusto: acepta string JSON o ya-objeto; si falla, conserva _raw
  const purchases = raw.map((r) => {
    try {
      if (typeof r === "string") return JSON.parse(r);
      if (r && typeof r === "object") return r;
      errors++;
      return { _raw: String(r) };
    } catch (e) {
      errors++;
      return { _raw: r };
    }
  });

  const len = await db.llen(listKey).catch(() => 0); // 👈 db en vez de kv

  // Devolvemos una muestra de los primeros 2 tal cual están en KV para ver formato real
  const debug = {
    waId,
    listKey,
    len,
    parseErrors: errors,
    sampleRaw: raw.slice(0, 2),
    sampleParsed: purchases.slice(0, 2),
  };

  return NextResponse.json(
    { ok: true, debug, purchases },
    { headers: CORS_HEADERS }
  );
}

