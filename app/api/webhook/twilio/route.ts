// app/api/webhook/twilio/route.ts
import { NextResponse } from "next/server";
import { saveMessage, normalizeId, db1, db2 } from "@/lib/db";
import crypto from "crypto";
import { INBOX_NUMBERS } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 👇 ELEGÍ ACÁ QUÉ BASE USAR
const db = db1; // usa la base principal
// const db = db2; // si querés que este webhook escriba en la segunda base

const pick = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);



const resolveClidFromParams = (p: URLSearchParams) =>
  pick(
    p.get("ReferralCtwaClid") ||
      p.get("ReferralCtwClid") ||
      p.get("ctwa_clid") ||
      p.get("ctw_clid") ||
      p.get("clid")
  );

function extractCustomerCode(body: string): string | null {
  if (!body) return null;

  const upper = body.toUpperCase();

  // Español: "código de bonus es: XXXXXXXX"
  const es = upper.match(/CÓDIGO DE BONUS\s*ES[:\s]*([A-Z0-9]{8})/);
  if (es?.[1]) return es[1];

  // Inglés: "My code is: XXXXXXXX"
  const en = upper.match(/MY CODE IS[:\s]*([A-Z0-9]{8})/);
  if (en?.[1]) return en[1];

  // Fallback: cualquier palabra suelta de 8 caracteres A-Z0-9
  const any = upper.match(/\b([A-Z0-9]{8})\b/);
  if (any?.[1]) return any[1];

  return null;
}


function parseAdIdsFromReferral(urlStr?: string | null) {
  const out = {
    campaign_id: null as string | null,
    adset_id: null as string | null,
    ad_id: null as string | null,
  };
  if (!urlStr) return out;
  try {
    const u = new URL(urlStr);
    const sp = u.searchParams;
    out.campaign_id = pick(sp.get("campaign_id"));
    out.adset_id = pick(sp.get("adset_id"));
    out.ad_id = pick(sp.get("ad_id"));
  } catch {}
  return out;
}

export async function POST(req: Request) {
  // Twilio manda form-urlencoded
  const raw = await req.text();
  const p = new URLSearchParams(raw);

  const from = p.get("From") || "";
  const to = p.get("To") || "";
  const body = p.get("Body") || "";
  const customerCode = extractCustomerCode(body);
  // 1) detectar inbox por el número que recibió
  let inbox_id = "ventas";
  for (const [key, num] of Object.entries(INBOX_NUMBERS)) {
    if (to.includes(num)) {
      inbox_id = key;
      break;
    }
  }

  const sourceUrl = pick(p.get("ReferralSourceUrl"));
  const { campaign_id, adset_id, ad_id } = parseAdIdsFromReferral(sourceUrl);

  // 2) media que viene de Twilio
  const numMedia = parseInt(p.get("NumMedia") || "0", 10);
  const mediaUrl = numMedia > 0 ? p.get("MediaUrl0") : null;
  const mediaContentType = numMedia > 0 ? p.get("MediaContentType0") : null;

  // ids varios
  const waIdRaw = p.get("WaId") || from;
  const waId = normalizeId
    ? normalizeId(waIdRaw)
    : String(waIdRaw || "").replace(/^whatsapp:\+?/, "").replace(/[^\d]/g, "");
  const messageSid = p.get("MessageSid") || p.get("SmsMessageSid") || null;

  const profileName = pick(p.get("ProfileName"));
  const sourceTypeRef = pick(p.get("ReferralSourceType"));
  const clid = resolveClidFromParams(p);

  // 👇 AHORA USA db EN VEZ DE kv
  const existing = await db
    .hgetall<Record<string, any>>(`contact:${waId}`)
    .catch(() => null);
  const wasAd = existing?.source_type === "ad" || !!existing?.ctwa_clid;

  // contacto
   const contactPatch: Record<string, any> = {
    wa_id: waId,
    lastText: body || (mediaUrl ? "[media]" : ""),
    lastMessageAt: Date.now(),
    inbox_id,
  };

  if (profileName) contactPatch.name = profileName;
  if (sourceUrl) contactPatch.source_url = sourceUrl;
  if (campaign_id) contactPatch.campaign_id = campaign_id;
  if (adset_id) contactPatch.adset_id = adset_id;
  if (ad_id) contactPatch.ad_id = ad_id;

  // 👇 NUEVO: si encontramos código, lo guardamos
  if (customerCode) {
    contactPatch.customer_code = customerCode;
  }

  if (clid) {
    contactPatch.ctwa_clid = clid;
    contactPatch.source_type = "ad";
  } else if (!wasAd && !existing?.source_type) {
    contactPatch.source_type = "organic";
  }

  // ======================
  //   MEDIA: descarga + upload
  // ======================
  let uploadedMediaUrl: string | null = null;
  let uploadedMediaType: "image" | "pdf" | null = null;

  if (mediaUrl && mediaContentType) {
    try {
      const TWILIO_CREDS: Record<string, { sid?: string | null; token?: string | null }> = {
        ventas: {
          sid: process.env.TWILIO_ACCOUNT_SID_VENTAS,
          token: process.env.TWILIO_AUTH_TOKEN_VENTAS,
        },
        soporte: {
          sid: process.env.TWILIO_ACCOUNT_SID_SOPORTE,
          token: process.env.TWILIO_AUTH_TOKEN_SOPORTE,
        },
      };

      const creds = TWILIO_CREDS[inbox_id];
      if (!creds?.sid || !creds?.token) {
        throw new Error(`No Twilio credentials for inbox: ${inbox_id}`);
      }

      // 1️⃣ Descargar el archivo real desde Twilio
      const auth = "Basic " + Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
      const twilioRes = await fetch(mediaUrl, { headers: { Authorization: auth } });

      if (!twilioRes.ok) throw new Error(`Twilio returned ${twilioRes.status}`);
      const arrayBuffer = await twilioRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const isPdf = mediaContentType.toLowerCase().includes("pdf");
      const { v2: cloudinary } = await import("cloudinary");
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
        api_key: process.env.CLOUDINARY_API_KEY!,
        api_secret: process.env.CLOUDINARY_API_SECRET!,
        secure: true,
      });

      // 2️⃣ Subir a Cloudinary usando el tipo correcto
      const uploadResult: any = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "whatsapp",
            resource_type: isPdf ? "raw" : "image",
            public_id: crypto.randomUUID(),
            use_filename: false,
            unique_filename: true,
            format: isPdf ? "pdf" : undefined,
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        stream.end(buffer);
      });

      if (!uploadResult?.secure_url) throw new Error("Cloudinary failed to return secure_url");

      uploadedMediaUrl = uploadResult.secure_url;
      uploadedMediaType = isPdf ? "pdf" : "image";
      console.log("✅ Subido a Cloudinary:", uploadedMediaUrl);
    } catch (err) {
      console.error("❌ Error subiendo media autenticada:", err);
      uploadedMediaUrl = mediaUrl; // fallback Twilio URL
      uploadedMediaType = mediaContentType.includes("pdf") ? "pdf" : "image";
    }
  }

  // mensaje final
  const msg = {
    id: messageSid || crypto.randomUUID(),
    from,
    to,
    text: body || "",
    timestamp: Date.now(),
    direction: "in" as const,
    ...(uploadedMediaUrl ? { media_url: uploadedMediaUrl } : {}),
    ...(uploadedMediaType ? { media_type: uploadedMediaType } : {}),
    inbox_id,
  };

  await saveMessage(waId, msg, contactPatch, messageSid);

   // webhook zapier (mandamos también el customer_code)
  const zapierWebhookUrl = process.env.ZAPIER_WEBHOOK_URL;
  const finalCustomerCode =
    contactPatch.customer_code || existing?.customer_code || null;

  // Solo disparamos si hay contacto previo O si vino un customer_code nuevo
  if (zapierWebhookUrl && (existing || finalCustomerCode)) {
    try {
      await fetch(zapierWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa_id: waId,
          name: profileName || null,
          from,
          to,
          message: body,
          timestamp: Date.now(),
          source_type: contactPatch.source_type || null,
          source_url: sourceUrl || null,
          campaign_id: campaign_id || null,
          adset_id: adset_id || null,
          ad_id: ad_id || null,
          ctwa_clid: clid || null,
          customer_code: finalCustomerCode,
          inbox_id,
        }),
      });
    } catch (err) {
      console.error("Error al enviar webhook a Zapier:", err);
    }
  }

  // meta extra
  try {
    await db.hset(`message_meta:${msg.id}`, {
      ctwa_clid: clid || "",
      source_type: clid
        ? "ad"
        : (sourceTypeRef || existing?.source_type || "") || "",
      source_url: sourceUrl || "",
      campaign_id: campaign_id || "",
      adset_id: adset_id || "",
      ad_id: ad_id || "",
    });
  } catch (err) {
    console.error("Error guardando message_meta:", err);
  }

  return new Response(null, { status: 204 });
}

