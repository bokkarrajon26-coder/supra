// app/api/webhook/zapier/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = String(body.customer_code || "").trim().toUpperCase();

    if (!code || code.length !== 8) {
      return NextResponse.json({ ok: false, error: "INVALID_CUSTOMER_CODE" }, { status: 400 });
    }

    // Buscar contacto con ese customer_code
    const keys = await kv.keys("contact:*");
    let matchKey = null;

    for (const key of keys) {
      const data = await kv.hgetall<Record<string, any>>(key);
      if (data?.customer_code?.toUpperCase() === code) {
        matchKey = key;
        break;
      }
    }

    if (!matchKey) {
      return NextResponse.json({ ok: false, error: "CONTACT_NOT_FOUND" }, { status: 404 });
    }

    // Guardar la etiqueta "Tracked"
    await kv.hset(matchKey, { tag: "Tracked" });

    return NextResponse.json({ ok: true, contact: matchKey });
  } catch (err) {
    console.error("Zapier Webhook Error:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
