// app/api/contacts/[waId]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getConversation } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ waId: string }> }) {
  const { waId } = await ctx.params;
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") || 0);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const inboxId = url.searchParams.get("inbox_id") || undefined;

  const data = await getConversation(waId, offset, limit);

  // Aplicar filtro por inbox_id si viene en la query
  const filteredMessages = inboxId
    ? data.messages.filter((m) => m.inbox_id === inboxId)
    : data.messages;

  return NextResponse.json({
    ok: true,
    messages: filteredMessages,
    nextOffset: data.nextOffset,
  });
}
