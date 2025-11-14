// app/api/stats/cargas/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const TZ = "America/Argentina/Buenos_Aires";

// convierte ts (segundos o ms) a ms
function normalizeTs(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

// fecha BA en formato estable YYYY-MM-DD
function formatBA(ts: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts)); // ej: 2025-11-09
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from"); // YYYY-MM-DD
    const toParam = url.searchParams.get("to");     // YYYY-MM-DD

    // ¿estamos en modo "rango"?
    const isRange = !!(fromParam || toParam);

    // preparamos "hoy" y "ayer" en BA para el modo normal
    const now = Date.now();
    const todayBA = formatBA(now);
    const yesterdayBA = formatBA(now - 24 * 60 * 60 * 1000);

    // para el modo rango: si no pasan to → usamos from, si no pasan from → hoy
    const rangeFrom = fromParam || toParam || todayBA;
    const rangeTo = toParam || fromParam || todayBA;

    // traemos todas las claves de compras
    const keys = await kv.keys("purchases:*").catch(() => []);

    if (!keys || !keys.length) {
      // si pidieron rango → devolvemos solo cargas del rango
      if (isRange) {
        return NextResponse.json(
          { ok: true, cargas: 0, tz: TZ, from: rangeFrom, to: rangeTo },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
      // modo normal
      return NextResponse.json(
        {
          ok: true,
          total: 0,
          conCargas: 0,
          conversion: 0,
          hoy: 0,
          ayer: 0,
          tz: TZ,
        },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    let conCargas = 0;
    let todayCount = 0;
    let yesterdayCount = 0;
    let rangeCount = 0;

    // recorremos cada waId
    for (const key of keys) {
      // cada key tiene una lista de compras
      const list = await kv.lrange(key, 0, 100).catch(() => []);
      if (!list || !list.length) continue;

      let hasAnyForThisKey = false;

      for (const raw of list) {
        // parsear
        let p: any = raw;
        if (typeof raw === "string") {
          try {
            p = JSON.parse(raw);
          } catch {
            p = { _raw: raw };
          }
        }

        let ts: number | null = null;
        if (p?.createdAt) {
          const parsed = Date.parse(p.createdAt);
          ts = Number.isFinite(parsed) ? parsed : null;
        } else if (p?.ts !== undefined) {
          ts = normalizeTs(p.ts);
        }

        if (!ts) continue;

        const dBA = formatBA(ts);

        // modo normal: contamos hoy y ayer
        if (!isRange) {
          if (dBA === todayBA) todayCount++;
          if (dBA === yesterdayBA) yesterdayCount++;
        } else {
          // modo rango: comparación inclusiva por string YYYY-MM-DD
          if (dBA >= rangeFrom && dBA <= rangeTo) {
            rangeCount++;
          }
        }

        hasAnyForThisKey = true;
      }

      if (hasAnyForThisKey) {
        conCargas++;
      }
    }

    // si es rango → devolvemos solo las cargas del rango
    if (isRange) {
      return NextResponse.json(
        {
          ok: true,
          cargas: rangeCount,
          from: rangeFrom,
          to: rangeTo,
          tz: TZ,
        },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // modo normal → como lo usabas al principio
    const totalKeys = keys.length;
    const conversion =
      totalKeys > 0 ? Math.round((conCargas / totalKeys) * 100) : 0;

    return NextResponse.json(
      {
        ok: true,
        total: totalKeys,
        conCargas,
        conversion,
        hoy: todayCount,
        ayer: yesterdayCount,
        tz: TZ,
      },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "STATS_ERROR" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}

