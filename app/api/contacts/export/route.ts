// app/api/contacts/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { listContacts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normWaId = (s: string) => String(s || "").replace(/[^\d]/g, "");

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const inboxId = url.searchParams.get("inbox_id") || undefined;

  const all: any[] = [];
  let cursor = 0;
  const pageSize = 200; // puedes subir / bajar esto

  while (true) {
    const { contacts, nextCursor } = await listContacts(cursor, pageSize);

    // si quieres filtrar por inbox:
    const filtered = inboxId
      ? contacts.filter((c) => c.inbox_id === inboxId)
      : contacts;

    all.push(
      ...filtered.map((c) => ({
        wa_id: normWaId(c.wa_id),
      }))
    );

    if (nextCursor == null) break;
    cursor = nextCursor;
  }

  return NextResponse.json({ ok: true, contacts: all });
}
