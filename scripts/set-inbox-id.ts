// scripts/set-inbox-id.ts
import { kv } from "@vercel/kv";

async function actualizarInboxId() {
  const waId = "5491121555734"; // sin "whatsapp:", solo el número plano
  const inboxNumber = "whatsapp:+15077065642"; // el número del inbox que querés asignar

  const key = `contact:${waId}`;
  await kv.hset(key, { inbox_id: inboxNumber });
  console.log(`✅ Asignado inbox_id=${inboxNumber} al contacto ${waId}`);
}

actualizarInboxId().catch(console.error);
