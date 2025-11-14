// app/api/contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listContacts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const inboxId = url.searchParams.get("inbox_id") || "ventas";
  const since = Number(url.searchParams.get("since") || 0); // ms epoch (inicio de hoy)

  // vamos paginando hasta que encontremos mensajes más viejos que "since"
  let cursor = 0;
  const pageSize = 100;
  const out: any[] = [];

  while (true) {
    const { contacts, nextCursor } = await listContacts(cursor, pageSize);

    // filtrar por inbox + fecha mínima
    const batch = contacts.filter((c) => {
      const ts = Number(c.lastMessageAt || 0);
      return c.inbox_id === inboxId && (!since || ts >= since);
    });

    out.push(...batch);

    // cortar si:
    // - no hay más páginas
    // - o el último de la página ya es más viejo que "since"
    const last = contacts[contacts.length - 1];
    const lastTs = last ? Number(last.lastMessageAt || 0) : 0;

    if (!nextCursor || (since && lastTs < since)) break;

    cursor = nextCursor;
  }

  return NextResponse.json({ ok: true, contacts: out });
}
