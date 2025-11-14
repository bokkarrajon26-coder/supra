// app/api/[waId]/events/purchase/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db1, db2 } from "@/lib/db";
import crypto from "crypto";

/* ─────────── elegir base de datos ─────────── */
// 👇 elegí con cuál querés trabajar
const db = db1; 
// const db = db2;

/* ─────────── utils ─────────── */
const norm = (s: string) => String(s || "").replace(/[^\d]/g, "");
const sha256 = (s: string) =>
  crypto.createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

async function getWaId(context: any): Promise<string> {
  const p = context?.params;
  if (p && typeof p.then === "function") {
    const r = await p; // Next 15
    return norm(r?.waId);
  }
  return norm(p?.waId); // Next 14
}

function uuid() {
  return (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/** Busca ctwa_clid/clid en contact:{waId} o en los últimos mensajes */
async function resolveClid(waId: string) {
  const id = norm(waId);
  const contact = await db.hgetall<Record<string, any>>(`contact:${id}`).catch(() => null);

  let clid =
    contact?.ctwa_clid ??
    contact?.clid ??
    contact?.ctw_clid ??
    null;

  if (!clid) {
    const raw = await db.lrange<string>(`messages:${id}`, 0, 10);
    for (const r of raw) {
      let m: any; try { m = JSON.parse(r); } catch { continue; }
      clid =
        m?.ctwa_clid ??
        m?.clid ??
        m?.ctw_clid ??
        m?.meta?.ctwa_clid ??
        m?.meta?.clid ??
        m?.meta?.ctw_clid ??
        null;
      if (typeof clid === "string" && clid.trim()) break;
    }
  }
  return (typeof clid === "string" && clid.trim()) ? clid : null;
}

/* ─────────── CORS ─────────── */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/* ─────────── tipos ─────────── */
type Purchase = {
  id: string;
  waId: string;
  amount: number;
  currency?: string;
  source?: string;
  createdAt: string; // ISO
  meta?: Record<string, any>;
  capiStatus?: "pending" | "ok" | "error";
  capiLastError?: string | null;
};

/* ─────────── OPTIONS ─────────── */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/* ─────────── GET (ping) ─────────── */
export async function GET(_req: NextRequest, context: any) {
  const waId = await getWaId(context);
  return NextResponse.json({ ok: true, route: "purchase", waId }, { headers: CORS_HEADERS });
}

/* ─────────── POST (crear compra) ─────────── */
export async function POST(req: NextRequest, context: any) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const waIdFromRoute = await getWaId(context);
    const waId = norm(waIdFromRoute || body.waId || body.From || body.from || body.wa_id);

    const amount = Number(body.amount);
    const currency = typeof body.currency === "string" ? body.currency : "ARS";
    const source = typeof body.source === "string" ? body.source : "manual";
    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};

    if (!waId) {
      return NextResponse.json({ ok: false, error: "MISSING_WAID" }, { status: 400, headers: CORS_HEADERS });
    }
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ ok: false, error: "INVALID_AMOUNT" }, { status: 400, headers: CORS_HEADERS });
    }

    const purchase: Purchase = {
      id: uuid(),
      waId,
      amount,
      currency,
      source,
      createdAt: new Date().toISOString(),
      meta,
      capiStatus: "pending",
      capiLastError: null,
    };

    const listKey = `purchases:${waId}`;
    await db.lpush(listKey, JSON.stringify(purchase));

    // Obtener customer_code del contacto
    const contact = await db.hgetall<Record<string, any>>(`contact:${waId}`).catch(() => null);
    const customerCode = contact?.customer_code;
    const contactName = contact?.name;

    // Enviar webhook a Zapier (no bloqueante)
    notifyZapier(purchase, customerCode, contactName);

    // 🔻 COMENTADO: Envío a Meta CAPI
    /*
    const bodyClid = typeof body?.clid === "string" && body.clid.trim() ? body.clid : null;
    const clid = bodyClid || (await resolveClid(waId));
    sendToMetaCapi({
      id: purchase.id,
      waId: purchase.waId,
      amount: purchase.amount,
      currency: purchase.currency,
      createdAt: purchase.createdAt,
      clid,
    })
      .then(async (rtn) => {
        purchase.capiStatus = "ok";
        purchase.capiLastError = null;
        (purchase as any).capiResult = rtn;
        (purchase as any).ctwa_clid = clid || null;
        await db.lset(listKey, 0, JSON.stringify(purchase)).catch(() => {});
      })
      .catch(async (err) => {
        purchase.capiStatus = "error";
        purchase.capiLastError = String(err?.message ?? err);
        (purchase as any).ctwa_clid = clid || null;
        await db.lset(listKey, 0, JSON.stringify(purchase)).catch(() => {});
        console.error("CAPI error:", err);
      });
    */

    return NextResponse.json({ ok: true, purchase }, { headers: CORS_HEADERS });
  } catch (err: any) {
    console.error("Error creating purchase:", err?.message || err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500, headers: CORS_HEADERS });
  }
}

/* ─────────── Webhook hacia Zapier ─────────── */
async function notifyZapier(purchase: Purchase, customerCode?: string, contactName?: string) {
  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("ZAPIER_WEBHOOK_URL is not defined");
    return;
  }

  const payload = {
    waId: purchase.waId,
    amount: purchase.amount,
    currency: purchase.currency,
    timestamp: purchase.createdAt,
    customer_code: customerCode || null,
    name: contactName || null,
  };

  console.log("Sending to Zapier:", payload);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    console.log("Zapier response:", responseText);
  } catch (err) {
    console.warn("Zapier webhook failed:", err);
  }
}
