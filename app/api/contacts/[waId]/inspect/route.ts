export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const norm = (s:string|undefined|null)=> String(s??"").replace(/[^\d]/g,"");

async function getContact(waId:string){
  try {
    // contacto como hash u objeto
    const contact = await kv.hgetall<Record<string, any>>(`contact:${waId}`);
    return contact || null;
  } catch { return null; }
}

async function getLastMessages(waId:string, n=10){
  // asumiendo lista messages:${waId} en formato JSON por item
  const raw = await kv.lrange<string>(`messages:${waId}`, 0, n-1);
  return raw.map(r=>{ try { return JSON.parse(r); } catch { return r; } });
}

function pickClid(sources: Record<string, any>){
  // heurística: chequea variantes comunes
  const candidates: Array<{key:string, val:any}> = [];
  for (const [k, v] of Object.entries(sources)) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    const kL = k.toLowerCase();
    if (
      kL.includes("ctwa_clid") ||
      kL === "clid" ||
      kL.includes("ctw_clid") ||
      kL.includes("wa_click_id") ||
      kL.includes("wa_ad_click") ||
      kL.includes("whatsapp_click_id")
    ) {
      candidates.push({ key: k, val: v });
    }
  }
  // preferimos ctwa_clid > clid > ctw_clid
  const pref = ["ctwa_clid", "clid", "ctw_clid"];
  for (const p of pref) {
    const hit = candidates.find(c => c.key.toLowerCase() === p);
    if (hit) return hit;
  }
  // si no hay exactos, devolvés el primero encontrado
  return candidates[0] || null;
}

export async function GET(_: Request, ctx:any){
  const params = (await ctx?.params) || ctx?.params || {};
  const waId = norm(params.waId);
  const out:any = { waId, sources: {}, chosen: null, messagesScanned: 0 };

  // 1) contacto
  const contact = await getContact(waId);
  if (contact) out.sources.contact = contact;

  // 2) últimos mensajes
  const msgs = await getLastMessages(waId, 20);
  out.messagesScanned = msgs.length;
  // aplanamos posibles metas de mensaje
  const msgSources: Record<string, any> = {};
  msgs.forEach((m, i) => {
    if (m && typeof m === "object") {
      for (const [k, v] of Object.entries(m)) {
        // guardamos la última ocurrencia
        msgSources[`msg[${i}].${k}`] = v as any;
      }
      if (m.meta && typeof m.meta === "object") {
        for (const [k, v] of Object.entries(m.meta)) {
          msgSources[`msg[${i}].meta.${k}`] = v as any;
        }
      }
    }
  });
  out.sources.messages = msgSources;

  // 3) query de todas las fuentes conocidas
  const pool: Record<string, any> = {
    ...(contact || {}),
    ...msgSources,
  };
  const picked = pickClid(pool);
  out.chosen = picked;

  return NextResponse.json({ ok:true, debug: { keyContact:`contact:${waId}`, keyMessages:`messages:${waId}` }, result: out });
}
