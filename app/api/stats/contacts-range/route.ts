export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const TZ = "America/Argentina/Buenos_Aires";

function toLocalDateBA(ts: number) {
  return new Date(ts).toLocaleDateString("es-AR", { timeZone: TZ });
}

function isWithinRange(ts: number, from: Date, to: Date): boolean {
  return ts >= from.getTime() && ts <= to.getTime();
}

// Normaliza phone id
const norm = (s: string) => String(s || "").replace(/[^\d]/g, "");

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const now = new Date();
    const start = fromParam ? new Date(fromParam) : new Date(now.setHours(0, 0, 0, 0));
    const end = toParam ? new Date(toParam) : new Date();

    // Trae todos los contactos desde KV
    const keys = await kv.keys("contact:*").catch(() => []);
    if (!keys.length) {
      return NextResponse.json(
        { ok: true, total: 0, hoy: 0, ayer: 0, tz: TZ },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    let total = 0;
    let enRango = 0;

    for (const key of keys) {
      const contact = await kv.get<any>(key).catch(() => null);
      if (!contact) continue;
      total++;

      // buscamos fecha de último mensaje
      const ts = Number(contact.lastMessageAt ?? 0);
      if (!ts) continue;

      const d = new Date(
        new Date(ts).toLocaleString("en-US", { timeZone: TZ })
      );

      if (isWithinRange(d.getTime(), start, end)) {
        enRango++;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        total,
        enRango,
        from: start,
        to: end,
        tz: TZ,
      },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "CONTACTS_RANGE_ERROR" },
      { status: 500 }
    );
  }
}
