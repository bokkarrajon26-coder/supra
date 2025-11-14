import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "America/Argentina/Buenos_Aires";

// convierte ts (segundos o ms) a fecha local BA (ej: "9/11/2025")
function localDateString(ts: number) {
  const ms = ts < 1e12 ? ts * 1000 : ts; // si vino en segundos -> ms
  return new Date(ms).toLocaleDateString("es-AR", { timeZone: TZ });
}

export async function GET(req: Request) {
  try {
    // 👇 sacamos el origin real de la request
    const origin = new URL(req.url).origin;

    // ahora sí podemos llamar a nuestra propia API
    const [ventasRes, soporteRes] = await Promise.all([
      fetch(`${origin}/api/contacts?limit=all&inbox_id=ventas`, { cache: "no-store" }),
      fetch(`${origin}/api/contacts?limit=all&inbox_id=soporte`, { cache: "no-store" }),
    ]);

    const ventasJson = await ventasRes.json().catch(() => ({ contacts: [] }));
    const soporteJson = await soporteRes.json().catch(() => ({ contacts: [] }));

    const all = [
      ...(ventasJson.contacts || []),
      ...(soporteJson.contacts || []),
    ];

    const total = all.length;

    // fechas de referencia en BA
    const hoyStr = localDateString(Date.now());
    const ayerStr = localDateString(Date.now() - 24 * 60 * 60 * 1000);

    let hoy = 0;
    let ayer = 0;

    for (const c of all) {
      const ts = Number(c.lastMessageAt || 0);
      if (!ts) continue;
      const dStr = localDateString(ts);
      if (dStr === hoyStr) hoy++;
      else if (dStr === ayerStr) ayer++;
    }

    return NextResponse.json(
      {
        ok: true,
        total,
        hoy,
        ayer,
        tz: TZ,
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("contacts-today error", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
