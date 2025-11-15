// app/api/contacts/[waId]/delete/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db1, db2 } from "@/lib/db";  // 👈 usamos tus BDs

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 👇 elegí acá cuál base querés que borre
const db = db1;
// const db = db2;

const norm = (s: string | null | undefined) =>
  String(s ?? "").replace(/[^\d]/g, "");

async function doDelete(waId: string) {
  const keys = [
    `contact:${waId}`,
    `messages:${waId}`,
    `purchases:${waId}`,
  ];

  // Borrado en paralelo en la BD elegida
  await Promise.all(
    keys.map((k) => db.del(k).catch(() => null))  // 👈 db en vez de kv
  );

  return keys;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request, ctx: any) {
  const p = (await ctx?.params) || ctx?.params || {};
  const waId = norm(p.waId);
  if (!waId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_WAID" },
      { status: 400, headers: CORS }
    );
  }
  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm");

  const keys = [`contact:${waId}`, `messages:${waId}`, `purchases:${waId}`];

  if (confirm === "1") {
    const deleted = await doDelete(waId);
    return NextResponse.json({ ok: true, deleted }, { headers: CORS });
  }

  // Solo previsualiza
  return NextResponse.json(
    {
      ok: true,
      preview: keys,
      hint: `Para borrar vía navegador usá ?confirm=1, o hacé POST a esta ruta.`,
      example_get_confirm: `/api/contacts/${waId}/delete?confirm=1`,
    },
    { headers: CORS }
  );
}

export async function POST(_req: Request, ctx: any) {
  const p = (await ctx?.params) || ctx?.params || {};
  const waId = norm(p.waId);
  if (!waId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_WAID" },
      { status: 400, headers: CORS }
    );
  }
  const deleted = await doDelete(waId);
  return NextResponse.json({ ok: true, deleted }, { headers: CORS });
}

