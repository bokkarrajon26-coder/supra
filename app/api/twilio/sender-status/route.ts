// app/api/twilio/sender-status/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

const TWILIO_CREDENTIALS: Record<string, { sid: string; token: string; from: string }> = {
  ventas: {
    sid: process.env.TWILIO_ACCOUNT_SID_VENTAS!,
    token: process.env.TWILIO_AUTH_TOKEN_VENTAS!,
    from: process.env.TWILIO_NUMBER_VENTAS!,
  },
  soporte: {
    sid: process.env.TWILIO_ACCOUNT_SID_SOPORTE!,
    token: process.env.TWILIO_AUTH_TOKEN_SOPORTE!,
    from: process.env.TWILIO_NUMBER_SOPORTE!,
  },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const inbox_id = searchParams.get("inbox_id") || "ventas";

  const creds = TWILIO_CREDENTIALS[inbox_id];
  if (!creds) {
    return NextResponse.json({ ok: false, error: `No hay credenciales para inbox "${inbox_id}"` }, { status: 400 });
  }

  const { sid, token, from: RAW } = creds;

  const res = await fetch("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp", {
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  const items: any[] = data?.senders || data?.items || [];

  const online = items.find(x => (x.status || "").toUpperCase() === "ONLINE");
  const selected = online || items[0] || null;

  const payload: any = {
    ok: true,
    number: RAW.replace(/^whatsapp:/i, ""),
    status: selected?.status?.toLowerCase() || "",
    quality_rating: selected?.properties?.quality_rating ?? null,
    messaging_limit: selected?.properties?.messaging_limit ?? null,
  };

  payload.debug = {
    total: items.length,
    onlineCount: items.filter(x => (x.status || "").toUpperCase() === "ONLINE").length,
    sample: items.map(s => ({
      sid: s.sid,
      status: s.status,
      address: s.address,
      phoneNumber: s.phoneNumber
    }))
  };

  return NextResponse.json(payload);
}

