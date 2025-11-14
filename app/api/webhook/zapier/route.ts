// app/api/webhook/zapier/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db1, db2 } from "@/lib/db"; // 👈 usar tu BBDD real

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 👇 ELEGÍ AQUÍ QUÉ BASE USAR
const db = db1;  
// const db = db2;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = String(body.customer_code || "").trim().toUpperCase();

    if (!code || code.length !== 8) {
      return NextResponse.json({ ok: false, error: "INVALID_CUSTOMER_CODE" }, { status: 400 });
    }

    // Buscar contacto con ese customer_code
    const keys = await db.keys("contact:*");   // 👈 ahora usa la base correcta
    let matchKey: string | null = null;

    for (const key of keys) {
      const data = await db.hgetall<Record<string, any>>(key);  // 👈 también acá
      if (data?.customer_code?.toUpperCase() === code) {
        matchKey = key;
        break;
      }
    }

    if (!matchKey) {
      return NextResponse.json({ ok: false, error: "CONTACT_NOT_FOUND" }, { status: 404 });
    }

    // Guardar la etiqueta "Tracked"
    await db.hset(matchKey, { tag: "Tracked" }); // 👈 y acá

    return NextResponse.json({ ok: true, contact: matchKey });
  } catch (err) {
    console.error("Zapier Webhook Error:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
