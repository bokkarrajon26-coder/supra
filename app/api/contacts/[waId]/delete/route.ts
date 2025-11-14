// app/api/contacts/[waId]/delete/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { db1, db2 } from "@/lib/db";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// mismo norm que usabas
const norm = (s: string | null | undefined) =>
  String(s ?? "").replace(/[^\d]/g, "");

// 👇 elegí la misma BD que usa tu CRM
const db = db1;
// const db = db2;

async function resolveStoredWaId(waIdNumeric: string): Promise<string | null> {
  // leemos todos los miembros del índice y buscamos el que matchee numéricamente
  const members = await db.zrange<string>("idx:contacts", 0, -1).catch(() => []);
  for (const m of members) {
    if (norm(m) === waIdNumeric) {
      return m; // este es el waId REAL que se usó al guardar (ej: "+54911...")
    }
  }
  // si no está en el índice, igual probamos con el numérico tal cual
  return waIdNumeric || null;
}

async function doDelete(waIdNumeric: string) {
  const storedWaId = await resolveStoredWaId(waIdNumeric);
  if (!storedWaId) return { keys: [], removedFromIndex: false };

  const keys = [
    `contact:${storedWaId}`,
    `messages:${storedWaId}`,
    `purchases:${storedWaId}`,
    // por las dudas, también las variantes numéricas:
    `contact:${waIdNumeric}`,
    `messages:${waIdNumeric}`,
    `purchases:${waIdNumeric}`,
  ];

  // Borrado en paralelo de las claves principales
  await Promise.all(keys.map((k) => db.del(k).catch(() => null)));

  // Sacamos TODAS las variantes que matcheen ese waId del índice
  const members = await db.zrange<string>("idx:contacts", 0, -1).catch(() => []);
  const toRemove = members.filter((m) => norm(m) === waIdNumeric);
  if (toRemove.length > 0) {
    await db.zrem("idx:contacts", ...toRemove).catch(() => null);
  }

  return { keys, removedFromIndex: toRemove };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request, ctx: any) {
  const p = (await ctx?.params) || ctx?.params || {};
  const waIdNumeric = norm(p.waId);
  if (!waIdNumeric) {
    return NextResponse.json(
      { ok: false, error: "MISSING_WAID" },
      { status: 400, headers: CORS }
    );
  }

  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm");

  const storedWaId = await resolveStoredWaId(waIdNumeric);
  const keysPreview = storedWaId
    ? [
        `contact:${storedWaId}`,
        `messages:${storedWaId}`,
        `purchases:${storedWaId}`,
        `contact:${waIdNumeric}`,
        `messages:${waIdNumeric}`,
        `purchases:${waIdNumeric}`,
      ]
    : [];

  if (confirm === "1") {
    const deleted = await doDelete(waIdNumeric);
    return NextResponse.json({ ok: true, deleted }, { headers: CORS });
  }

  // Solo previsualiza
  return NextResponse.json(
    {
      ok: true,
      waIdNumeric,
      storedWaId,
      preview: keysPreview,
      hint: `Para borrar vía navegador usá ?confirm=1, o hacé POST a esta ruta.`,
      example_get_confirm: `/api/contacts/${waIdNumeric}/delete?confirm=1`,
    },
    { headers: CORS }
  );
}

export async function POST(_req: Request, ctx: any) {
  const p = (await ctx?.params) || ctx?.params || {};
  const waIdNumeric = norm(p.waId);
  if (!waIdNumeric) {
    return NextResponse.json(
      { ok: false, error: "MISSING_WAID" },
      { status: 400, headers: CORS }
    );
  }
  const deleted = await doDelete(waIdNumeric);
  return NextResponse.json({ ok: true, deleted }, { headers: CORS });
}

