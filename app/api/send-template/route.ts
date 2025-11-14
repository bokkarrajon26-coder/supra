// app/api/send-template/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWILIO_CREDENTIALS: Record<
  string,
  { sid: string; token: string; from: string }
> = {
  ventas: {
    sid: process.env.TWILIO_ACCOUNT_SID_VENTAS!,
    token: process.env.TWILIO_AUTH_TOKEN_VENTAS!,
    from: process.env.TWILIO_NUMBER_VENTAS!,   // ej: "whatsapp:+54911..."
  },
  soporte: {
    sid: process.env.TWILIO_ACCOUNT_SID_SOPORTE!,
    token: process.env.TWILIO_AUTH_TOKEN_SOPORTE!,
    from: process.env.TWILIO_NUMBER_SOPORTE!,
  },
};

// normaliza destino a "whatsapp:+54911..."
function normalizeToWhatsApp(num: string) {
  let n = String(num || "").trim();
  if (!n) return null;
  n = n.replace(/\s+/g, "");

  if (!n.startsWith("whatsapp:")) {
    if (!n.startsWith("+")) n = `+${n}`;
    n = `whatsapp:${n}`;
  }
  return n;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      toNumbers,            // array de números
      inbox_id = "ventas",  // "ventas" o "soporte"
      content_sid,          // SID del template (HX...)
      variables = {},       // objeto { "1": "valor", "2": "valor" }
    } = body || {};

    if (!Array.isArray(toNumbers) || toNumbers.length === 0) {
      return NextResponse.json(
        { ok: false, error: "toNumbers debe ser un array con números destino" },
        { status: 400 }
      );
    }
    if (!content_sid) {
      return NextResponse.json(
        { ok: false, error: "Falta content_sid (SID del template de Twilio)" },
        { status: 400 }
      );
    }

    const creds = TWILIO_CREDENTIALS[inbox_id];
    if (!creds) {
      return NextResponse.json(
        { ok: false, error: `Inbox '${inbox_id}' no válido` },
        { status: 400 }
      );
    }

    const { sid, token, from } = creds;
    if (!sid || !token || !from) {
      return NextResponse.json(
        { ok: false, error: `Faltan credenciales Twilio para inbox '${inbox_id}'` },
        { status: 500 }
      );
    }

    const auth = Buffer.from(`${sid}:${token}`).toString("base64");

    const results: any[] = [];

    // Enviar uno por uno (para listas cortas va perfecto)
    for (const raw of toNumbers) {
      const toNorm = normalizeToWhatsApp(raw);
      if (!toNorm) {
        results.push({ to: raw, ok: false, error: "número vacío o inválido" });
        continue;
      }

      const params = new URLSearchParams();
      params.set("From", from);
      params.set("To", toNorm);
      params.set("ContentSid", content_sid);
      params.set("ContentVariables", JSON.stringify(variables)); // {"1":"...","2":"..."}

      try {
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
            },
            body: params,
          }
        );

        const tw = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          console.error("Twilio error template:", tw);
          results.push({
            to: raw,
            ok: false,
            error: tw?.message || JSON.stringify(tw),
          });
        } else {
          results.push({
            to: raw,
            ok: true,
            sid: tw.sid,
          });
        }
      } catch (err: any) {
        console.error("Error llamando Twilio:", err);
        results.push({
          to: raw,
          ok: false,
          error: err?.message || "Error de red",
        });
      }
    }

    const allOk = results.every((r) => r.ok);
    return NextResponse.json({ ok: allOk, results });
  } catch (e: any) {
    console.error("send-template error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Error inesperado" },
      { status: 500 }
    );
  }
}
