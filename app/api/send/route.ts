// app/api/send/route.ts
import { NextResponse } from "next/server";
import { saveMessage, normalizeId } from "@/lib/db";
import crypto from "crypto";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
  try {
    // puede venir text vacío, lo vamos a corregir
    let { to, text, inbox_id = "ventas", media_url } = await req.json();

    if (!to) {
      return NextResponse.json({ ok: false, error: "Falta 'to'" }, { status: 400 });
    }

    const creds = TWILIO_CREDENTIALS[inbox_id];
    if (!creds) {
      return NextResponse.json(
        { ok: false, error: `Inbox '${inbox_id}' no válido o sin credenciales.` },
        { status: 400 }
      );
    }

    // si no hay texto ni media, mandamos un espacio para que Twilio no falle
    const hasText = typeof text === "string" && text.trim().length > 0;
    if (!hasText && !media_url) {
      text = " "; // 👈 fuerza un body
    }

    const { sid, token, from } = creds;

    // Normalizar número destino
    let toNorm = String(to).trim().replace(/\s+/g, "");
    if (!toNorm.startsWith("whatsapp:")) {
      if (!toNorm.startsWith("+")) toNorm = `+${toNorm}`;
      toNorm = `whatsapp:${toNorm}`;
    }

    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const body = new URLSearchParams();
    body.set("From", from);
    body.set("To", toNorm);

    if (media_url) {
      body.set("MediaUrl", media_url);
      if (hasText) body.set("Body", text.trim());
      else body.set("Body", " "); // caption vacío
    } else {
      body.set("Body", (text || " ").toString());
    }

    console.log("[API/SEND] Enviando mensaje a Twilio:", {
      inbox_id,
      from,
      to: toNorm,
      hasMedia: !!media_url,
      media_url,
    });

    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}` },
        body,
      }
    );

    const tw = await resp.json();

    if (!resp.ok) {
      console.error("[API/SEND] Error desde Twilio:", tw);
      return NextResponse.json({ ok: false, error: `Twilio: ${JSON.stringify(tw)}` }, { status: 400 });
    }

    const waId = normalizeId(toNorm);

    // intentar deducir tipo de media
    const media_type =
      media_url?.endsWith(".pdf")
        ? "pdf"
        : media_url?.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        ? "image"
        : undefined;

    // 👇 si tu Msg no tiene media_url en el tipo TS, podés castear a any
    await saveMessage(
      waId,
      {
        id: tw?.sid || crypto.randomUUID(),
        from,
        to: toNorm,
        text: text || "",
        timestamp: Date.now(),
        direction: "out",
        inbox_id,
        ...(media_url ? { media_url, media_type } : {}),
      } as any,
      undefined,
      tw?.sid
    );

    return NextResponse.json({ ok: true, sid: tw?.sid });
  } catch (e: any) {
    console.error("[API/SEND] Error general:", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "Error inesperado" }, { status: 500 });
  }
}
