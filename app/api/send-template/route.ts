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
  difusionA: {
    sid: process.env.TWILIO_ACCOUNT_SID_DIFUSION_A || "",
    token: process.env.TWILIO_AUTH_TOKEN_DIFUSION_A || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_DIFUSION_A || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_DIFUSION_A || "",
  },
  difusionB: {
    sid: process.env.TWILIO_ACCOUNT_SID_DIFUSION_B || "",
    token: process.env.TWILIO_AUTH_TOKEN_DIFUSION_B || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_DIFUSION_B || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_DIFUSION_B || "",
  },
  difusionC: {
    sid: process.env.TWILIO_ACCOUNT_SID_DIFUSION_C || "",
    token: process.env.TWILIO_AUTH_TOKEN_DIFUSION_C || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_DIFUSION_C || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_DIFUSION_C || "",
  },
  difusionD: {
    sid: process.env.TWILIO_ACCOUNT_SID_DIFUSION_D || "",
    token: process.env.TWILIO_AUTH_TOKEN_DIFUSION_D || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_DIFUSION_D || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_DIFUSION_D || "",
  },
  difusionE: {
    sid: process.env.TWILIO_ACCOUNT_SID_DIFUSION_E || "",
    token: process.env.TWILIO_AUTH_TOKEN_DIFUSION_E || "",
    numberVentas: process.env.TWILIO_NUMBER_VENTAS_DIFUSION_E || "",
    numberSoporte: process.env.TWILIO_NUMBER_SOPORTE_DIFUSION_E || "",
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
      accountKey = "difusionA",
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

    const config = TWILIO_ACCOUNTS[accountKey] || TWILIO_ACCOUNTS["difusionA"];

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
