// lib/db.ts
import { kv } from "@vercel/kv";

/** ====== Tipos ====== */
export type Msg = {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  direction: "in" | "out";
  inbox_id: string;
  media_url?: string;
  media_type?: "image" | "pdf" | string;
};

export type Contact = {
  wa_id: string;
  name?: string | null;
  ctw_clid?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  lastMessageAt: number;
  lastText: string;
  inbox_id?: string;
};

export const normalizeId = (s: string) => s.replace(/^whatsapp:\+?/, "");

/** ====== Helpers seguros ====== */
function safeParse<T>(v: unknown): T | null {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  if (v && typeof v === "object") return v as T;
  return null;
}

/** ====== Contactos ====== */
export async function upsertContact(waId: string, patch: Partial<Contact>) {
  const key = `contact:${waId}`;
  const prev = (await kv.hgetall<Contact>(key)) || ({} as any);
  const next: Contact = {
    wa_id: waId,
    lastMessageAt: prev.lastMessageAt ?? 0,
    lastText: prev.lastText ?? "",
    ...prev,
    ...patch,
  };
  await kv.hset(key, next as any);
  await kv.zadd("idx:contacts", { score: next.lastMessageAt || 0, member: waId });
  return next;
}

/** ====== Mensajes ====== */
export async function saveMessage(
  rawId: string,
  msg: Msg,
  meta?: Partial<Contact>,
  dedupeId?: string | null
) {
  const waId = normalizeId(rawId);

  if (dedupeId) {
    const added = await kv.sadd("dedupe:msg", dedupeId);
    if (!added) return;
  }

  await kv.lpush(`messages:${waId}`, JSON.stringify(msg));

  const base: Partial<Contact> = {
    wa_id: waId,
    lastMessageAt: msg.timestamp,
    lastText: msg.text,
  };

  const inbox_id = msg.inbox_id || (msg.direction === "in" ? msg.to : "ventas");

  await upsertContact(waId, {
    ...base,
    inbox_id,
    ...meta,
  });
}

/** ====== Lecturas con paginación ====== */
export async function listContacts(
  cursor = 0,
  limit = 30
): Promise<{ contacts: Contact[]; nextCursor: number | null }> {
  const members = await kv.zrange(
    "idx:contacts",
    cursor,
    cursor + limit - 1,
    { rev: true }
  );

  const out: Contact[] = [];
  for (const waId of members as string[]) {
    const c = await kv.hgetall<Contact>(`contact:${waId}`);
    if (c) out.push(c);
  }

  const nextCursor = (members as string[]).length < limit ? null : cursor + limit;
  return { contacts: out, nextCursor };
}

/**
 * ⬇️ AQUÍ EL CAMBIO IMPORTANTE
 * si limit es null → traer TODO el historial
 */
export async function getConversation(
  waId: string,
  offset = 0,
  limit: number | null = 50
): Promise<{ messages: Msg[]; nextOffset: number | null }> {
  let raw: unknown[];

  if (limit === null) {
    // todo
    raw = await kv.lrange<unknown>(`messages:${waId}`, 0, -1);
  } else {
    raw = await kv.lrange<unknown>(`messages:${waId}`, offset, offset + limit - 1);
  }

  const parsed: Msg[] = [];
  for (const r of raw) {
    const m = safeParse<Msg>(r);
    if (m && m.id && m.timestamp && m.text != null) parsed.push(m);
  }

  parsed.sort((a, b) => a.timestamp - b.timestamp);

  // si pedimos todo no hay next
  const nextOffset =
    limit === null
      ? null
      : (() => {
          // mismo cálculo que antes
          // (esto es para compatibilidad si alguien sigue paginando)
          return parsed.length < limit ? null : offset + limit;
        })();

  return { messages: parsed, nextOffset };
}

export async function getContactWithMessages(
  waId: string,
  offset = 0,
  limit: number | null = 50,
  inboxId?: string
) {
  const c = await kv.hgetall<Contact>(`contact:${waId}`);
  if (!c) return null;

  const { messages, nextOffset } = await getConversation(waId, offset, limit);
  const filtered = inboxId ? messages.filter((m) => m.inbox_id === inboxId) : messages;
  return { contact: c, messages: filtered, nextOffset };
}


