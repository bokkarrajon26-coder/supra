// app/api/contacts/[waId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContactWithMessages } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ waId: string }> }) {
  const { waId } = await ctx.params;

  const url = new URL(req.url);
  const inboxId = url.searchParams.get("inbox_id") || undefined;
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 100)), 200);

  const data = await getContactWithMessages(waId, offset, limit, inboxId);
  if (!data) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }

  const contact = {
    ...data.contact,
    lastMessageAt: Number(data.contact.lastMessageAt ?? 0),
  };

  console.log("contacts/[waId] ->", { waId, msgs: data.messages.length, offset, limit });

  return NextResponse.json({
    ok: true,
    contact,
    messages: data.messages,
    nextOffset: data.nextOffset,
  });
}
