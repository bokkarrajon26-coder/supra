// app/api/send-template/route.ts
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mapa de cuentas Twilio
const TWILIO_ACCOUNTS: Record<
  string,
  { sid: string; token: string; numberVentas: string; numberSoporte: string }
> = {
  main: {
    sid: process.env.TWILIO_ACCOUNT_SID_MAIN || "",
    token: process.env.TWILIO_AUTH_TOKEN_MAIN || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_MAIN || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_MAIN || "",
  },
  tribet: {
    sid: process.env.TWILIO_ACCOUNT_SID_TRIBET || "",
    token: process.env.TWILIO_AUTH_TOKEN_TRIBET || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_TRIBET || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_TRIBET || "",
  },
  casinoX: {
    sid: process.env.TWILIO_ACCOUNT_SID_CASINOX || "",
    token: process.env.TWILIO_AUTH_TOKEN_CASINOX || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_CASINOX || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_CASINOX || "",
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      toNumbers,
      inbox_id,
      content_sid,
      variables,
      accountKey = "main",
    } = body;

    if (!Array.isArray(toNumbers) || toNumbers.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Faltan números destino" },
        { status: 400 }
      );
    }

    if (!content_sid) {
      return NextResponse.json(
        { ok: false, error: "Falta content_sid" },
        { status: 400 }
      );
    }

    const config = TWILIO_ACCOUNTS[accountKey] || TWILIO_ACCOUNTS["main"];

    if (!config?.sid || !config?.token) {
      return NextResponse.json(
        { ok: false, error: `Config Twilio inválida para cuenta ${accountKey}` },
        { status: 500 }
      );
    }

    const client = twilio(config.sid, config.token);

    const fromNumber =
      inbox_id === "soporte" ? config.numberSoporte : config.numberVentas;

    const results = await Promise.all(
      toNumbers.map(async (to: string) => {
        try {
          const msg = await client.messages.create({
            from: `whatsapp:${fromNumber}`,
            to: `whatsapp:${to}`,
            contentSid: content_sid,
            contentVariables: JSON.stringify(variables || {}),
          });

          return { to, ok: true, sid: msg.sid };
        } catch (err: any) {
          return {
            to,
            ok: false,
            error: err?.message || "Error Twilio",
          };
        }
      })
    );

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error inesperado" },
      { status: 500 }
    );
  }
}
