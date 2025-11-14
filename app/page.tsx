// app/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";

const INBOX_NUMBERS: Record<string, string> = {
  ventas: process.env.NEXT_PUBLIC_TWILIO_NUMBER_VENTAS || "",
  soporte: process.env.NEXT_PUBLIC_TWILIO_NUMBER_SOPORTE || "",
};

function NumberStatus({ status }: { status?: string | null }) {
  const s = (status || "").toLowerCase();
  const online = s === "online";
  const label = online ? "Activo" : s ? "Inactivo" : "Desconocido";
  return (
    <span className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-neutral-800 border border-neutral-700">
      <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-neutral-500"}`} />
      <span className="opacity-80">Estado de número:</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}

function CopyMini({ text, title = "Copiar" }: { text?: string | null; title?: string }) {
  if (!text) return null;
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text)}
      className="text-[10px] underline opacity-70 hover:opacity-100"
      title={title}
    >
      copiar
    </button>
  );
}
const shortId = (v?: string | null) => (v ? (v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v) : "-");

type Contact = {
  wa_id: string;
  name?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  ctwa_clid?: string | null;
  ctw_clid?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  lastMessageAt: number;
  lastText: string;
  customer_code?: string;
  tag?: string;
  inbox_id: string;
};

type Msg = {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  direction: "in" | "out";
  media_url?: string;
  media_type?: "image" | "pdf";
  inbox_id: string;
};

type PurchaseUI = { id: string; value: number; currency: string; ts: number };

const normWaId = (s: string) => String(s || "").replace(/[^\d]/g, "");

function Tag({ children, color = "neutral" }: { children: React.ReactNode; color?: "neutral" | "green" }) {
  const base = "text-[10px] px-2 py-0.5 rounded border";
  const cls =
    color === "green"
      ? "bg-emerald-700/20 border-emerald-700/40 text-emerald-300"
      : "bg-neutral-800 border-neutral-700 text-neutral-300";
  return <span className={`${base} ${cls}`}>{children}</span>;
}

const BA_TZ = "America/Argentina/Buenos_Aires";

function formatDateBA(ts: number | string) {
  if (!ts) return "-";

  // Convertir a número y asegurar milisegundos
  let t = Number(ts);
  if (t < 1e12) t *= 1000; // si viene en segundos → convertir a ms

  const date = new Date(t);

  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}



export default function Page() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sendingPurchase, setSendingPurchase] = useState(false);
  const [purchaseToast, setPurchaseToast] = useState<string | null>(null);
  const [lastPurchase, setLastPurchase] = useState<PurchaseUI | null>(null);
  const [senderStatus, setSenderStatus] = useState<string | null>(null);
  const [inboxId, setInboxId] = useState<string>("ventas");
  const [hasBuy, setHasBuy] = useState<Record<string, boolean>>({});
  
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- 🔔 NUEVO: refs de sonido, deben ir ACÁ ---
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);               // para el chat abierto
  const lastContactTsRef = useRef<Record<string, number>>({});    // para otros contactos
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    let t: any;
    async function pull() {
      try {
        const r = await fetch("/api/twilio/sender-status", { cache: "no-store" });
        const j = await r.json();
        setSenderStatus(j?.status || null);
      } catch {
        setSenderStatus(null);
      }
    }
    pull();
    t = setInterval(pull, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
  let t: any;

  function startOfTodayMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0); // inicio del día local
    return d.getTime();
  }

  async function load() {
    const since = startOfTodayMs();
    const r = await fetch(`/api/contacts?inbox_id=${inboxId}&since=${since}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (j?.ok) {
      const list = (j.contacts || []).map((c: any) => ({
        ...c,
        lastMessageAt: Number(c.lastMessageAt ?? 0),
      }));
      setContacts(list);
      if (!selected && list.length > 0) setSelected(normWaId(list[0].wa_id));
    }
  }

  load();
  t = setInterval(load, 30000); // podés dejar 30s; ya es liviano
  return () => clearInterval(t);
}, [inboxId, selected]);


  useEffect(() => {
  let abort = false;

  async function fillHasBuy() {
    if (!contacts.length) return;

    // normalizamos todos los waId
    const waIds = contacts.map((c) => normWaId(c.wa_id)).filter(Boolean);

    // solo los que todavía no sabemos
    const missing = waIds.filter((id) => hasBuy[id] === undefined);
    if (!missing.length) return;

    // mandamos en bloques para no matar el server
    const chunkSize = 50;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);

      try {
        const r = await fetch("/api/contacts/purchases-bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ waIds: chunk }),
        });
        const j = await r.json().catch(() => ({}));

        if (!abort && j?.ok && j.result) {
          setHasBuy((prev) => ({
            ...prev,
            ...j.result,
          }));
        }
      } catch {
        // si falla una tanda, seguimos con la otra
      }
    }
  }

  fillHasBuy();

  return () => {
    abort = true;
  };
}, [contacts]); // 👈 AHORA solo depende de contacts


  useEffect(() => {
    if (!selected) return;
    let t: any;
    async function loadThread() {
      const r = await fetch(`/api/contacts/${selected}?limit=100&inbox_id=${inboxId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setMessages(j.messages || []);
    }
    loadThread();
    t = setInterval(loadThread, 3000);
    return () => clearInterval(t);
  }, [selected, inboxId]);

   


  useEffect(() => {
    let abort = false;
    async function loadLastPurchase() {
      if (!selected) {
        setLastPurchase(null);
        return;
      }
      try {
        const r = await fetch(`/api/contacts/${selected}/purchases`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!abort && j?.ok && Array.isArray(j.purchases) && j.purchases.length) {
          const p = j.purchases[0];
          const ui: PurchaseUI = {
            id: p.id,
            value: Number(p.amount ?? p.value ?? 0),
            currency: String(p.currency ?? "ARS"),
            ts: p.createdAt ? Date.parse(p.createdAt) : Number(p.ts ?? Date.now()),
          };
            setLastPurchase(ui);
        } else if (!abort) {
          setLastPurchase(null);
        }
      } catch {
        if (!abort) setLastPurchase(null);
      }
    }
    loadLastPurchase();
    return () => {
      abort = true;
    };
  }, [selected]);

  async function send() {
    if (!selected) return;
    if (!text.trim() && !mediaUrl) return;

    const to = selected;
    const payload: any = { to, inbox_id: inboxId };
    if (text.trim()) payload.text = text.trim();
    if (mediaUrl) payload.media_url = mediaUrl;

    const r = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      const sentMediaUrl = mediaUrl;
      setText("");
      setMediaUrl(null);

      setMessages((prev) => [
        ...prev,
        {
          id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2),
          from: "me",
          to,
          text: payload.text || "",
          timestamp: Date.now(),
          direction: "out",
          inbox_id: inboxId,
          media_url: sentMediaUrl || undefined,
          media_type: sentMediaUrl ? "image" : undefined,
        },
      ]);
    }
  }

  function nameOrPhone(c: Contact) {
    return c.name?.trim() || c.wa_id;
  }

  const selectedContact = selected ? contacts.find((x) => normWaId(x.wa_id) === selected) : null;
  const totalContacts = contacts.length;
    const totalCargas = contacts.reduce((acc, c) => {
      const wa = normWaId(c.wa_id);
      return hasBuy[wa] ? acc + 1 : acc;
    }, 0);
    const conversion = totalContacts > 0 ? Math.round((totalCargas / totalContacts) * 100) : 0;
  return (
    <div className="h-dvh w-dvw flex flex-col bg-black text-neutral-100">
      {/* HEADER GLOBAL */}
      <header className="sticky top-0 z-50 h-12 px-4 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur flex items-center">
        <div className="flex-1" />
        <NumberStatus status={senderStatus} />
        <select
          value={inboxId}
          onChange={(e) => setInboxId(e.target.value)}
          className="text-xs bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-white"
        >
          <option value="ventas">📞 Ventas</option>
          <option value="soporte">🛠 Soporte</option>
        </select>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr]">
        {/* Sidebar contactos */}
        <aside className="h-full border-r border-neutral-800 overflow-y-auto scrollbar-dark">
          <div className="p-3 border-b border-neutral-800 flex items-center justify-between gap-3">
            <div className="text-sm opacity-70">Contactos</div>
            <div className="text-right">
              <div className="text-[10px] opacity-50">
                {totalCargas}/{totalContacts} cargaron
              </div>
              <div className="text-xs font-semibold">
                {conversion}%
              </div>
            </div>
          </div>

          {contacts.length === 0 && <div className="p-4 text-sm opacity-60">Sin contactos aún.</div>}

          <ul>
            {contacts.map((c) => {
              const wa = normWaId(c.wa_id);
              return (
                <li key={c.wa_id}>
                  <button
                    onClick={() => setSelected(wa)}
                    className={`w-full text-left px-3 py-2 hover:bg-neutral-900 ${selected === wa ? "bg-neutral-900" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{nameOrPhone(c)}</div>
                      <div className="flex items-center gap-2">
                        {hasBuy[wa] ? <Tag color="green">Cargó</Tag> : null}
                        {c.source_type === "ad" ? <Tag>Ad</Tag> : null}
                      </div>
                    </div>
                    <div className="text-xs opacity-60 line-clamp-1">{c.lastText}</div>
                    {c.campaign_id || c.adset_id || c.ad_id ? (
                      <div className="text-[10px] opacity-50 mt-0.5">
                        Campaña {shortId(c.campaign_id)} · Adset {shortId(c.adset_id)} · Ad {shortId(c.ad_id)}
                      </div>
                    ) : null}
                    {c.lastMessageAt ? (
                      <div className="text-[10px] opacity-50 mt-0.5">{formatDateBA(Number(c.lastMessageAt))}</div>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Panel de conversación */}
        <section className="min-h-0 h-full flex flex-col bg-neutral-950 text-neutral-100">
          {/* Header del panel */}
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
            {selected ? (
              <>
                <div className="text-sm opacity-80 flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <span>
                      Chat con <span className="font-semibold">{selected}</span>
                    </span>
                    {selectedContact ? (
                      <>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700">
                          {selectedContact.ctwa_clid || selectedContact.ctw_clid ? " • ctwa_clid" : ""}
                        </span>
                        {selectedContact.customer_code && <Tag color="neutral">{selectedContact.customer_code}</Tag>}
                        {selectedContact.tag === "Tracked" && <Tag color="green">Tracked</Tag>}
                      </>
                    ) : null}
                    {hasBuy[selected] ? <Tag color="green">Cargó</Tag> : null}
                  </div>

                  {selectedContact && (selectedContact.campaign_id || selectedContact.adset_id || selectedContact.ad_id) ? (
                    <div className="text-[11px] opacity-70 flex flex-wrap items-center gap-2">
                      <span>Origen:</span>
                      <span>
                        Campaña <span className="font-mono">{selectedContact.campaign_id || "-"}</span>
                      </span>
                      <CopyMini text={selectedContact.campaign_id} title="Copiar campaign_id" />
                      <span>
                        · Adset <span className="font-mono">{selectedContact.adset_id || "-"}</span>
                      </span>
                      <CopyMini text={selectedContact.adset_id} title="Copiar adset_id" />
                      <span>
                        · Ad <span className="font-mono">{selectedContact.ad_id || "-"}</span>
                      </span>
                      <CopyMini text={selectedContact.ad_id} title="Copiar ad_id" />
                      {selectedContact.ctwa_clid || selectedContact.ctw_clid ? (
                        <>
                          <span>
                            · CTWA CLID <span className="font-mono">{selectedContact.ctwa_clid || selectedContact.ctw_clid}</span>
                          </span>
                          <CopyMini text={selectedContact.ctwa_clid || selectedContact.ctw_clid} title="Copiar ctwa_clid" />
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="text-sm opacity-60">Seleccioná un contacto…</div>
            )}

           <button
              className="text-xs bg-emerald-600/80 hover:bg-emerald-600 px-3 py-1.5 rounded-lg disabled:opacity-40"
              disabled={!selected || sendingPurchase}
              onClick={async () => {
                if (!selected || sendingPurchase) return;
            
                const raw = window.prompt("Importe de la carga (ej: 2000):", "0");
                if (raw == null) return;
              
                const value = Number(raw);
                if (!Number.isFinite(value) || value <= 0) {
                  alert("Importe inválido");
                  return;
                }
            
                const currency = "ARS"; // 👈 siempre ARS
            
                try {
                  setSendingPurchase(true);
            
                  const waId = normWaId(selected);
            
                  const r = await fetch(`/api/${waId}/events/purchase`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount: value, currency, source: "manual" }),
                  });
            
                  const textResp = await r.text();
                  const j = textResp ? JSON.parse(textResp) : null;
            
                  if (!r.ok || !j?.ok) {
                    throw new Error(j?.error || `HTTP ${r.status}`);
                  }
            
                  setPurchaseToast(
                    `Compra ${value} ${currency} registrada${j?.events_received ? " y enviada a Meta" : ""}`
                  );
                  setTimeout(() => setPurchaseToast(null), 3000);
            
                  // refrescar marca de compra
                  try {
                    const pr = await fetch(`/api/contacts/${waId}/purchases`, { cache: "no-store" });
                    const pj = await pr.json().catch(() => ({}));
                    const has = !!(pj?.ok && Array.isArray(pj.purchases) && pj.purchases.length);
                    setHasBuy(prev => ({ ...prev, [waId]: has }));
                  } catch {}
                } catch (e: any) {
                  alert("Error al registrar carga: " + (e?.message || "desconocido"));
                } finally {
                  setSendingPurchase(false);
                }
              }}
            >
              {sendingPurchase ? "Marcando..." : "Marcar Carga"}
            </button>

          </div>

          {purchaseToast && (
            <div className="px-4 py-2 text-xs bg-emerald-700/30 border-b border-neutral-800">{purchaseToast}</div>
          )}

          <div
            ref={scrollerRef}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-neutral-950 scrollbar-dark"
            style={{ scrollbarGutter: "stable" as any }}
          >
            <div className="px-4 pt-4 pb-2 flex flex-col gap-2">
              {!selected && <div className="opacity-60 text-sm">Elegí un contacto de la izquierda.</div>}

              {selected && messages.length === 0 && <div className="opacity-60 text-sm">Sin mensajes todavía.</div>}

              {selected &&
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[72%] rounded-2xl px-3 py-2 ${
                        m.direction === "out" ? "bg-emerald-600 text-white" : "bg-neutral-800"
                      }`}
                    >
                      <div className="text-xs opacity-70 mb-1">{m.direction === "out" ? "Tú" : "Contacto"}</div>
                      {m.text && m.text.trim().length > 0 && (
                        <div className="whitespace-pre-wrap break-words mb-1">{m.text}</div>
                      )}
                      {m.media_type === "image" && m.media_url && (
                        <img src={m.media_url} alt="Imagen" className="rounded mt-2 max-w-xs shadow" />
                      )}

                      {m.media_type === "pdf" && m.media_url && (
                        <a
                          href={m.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline text-sm block mt-2"
                        >
                          Ver PDF
                        </a>
                      )}

                      <div className="text-[10px] opacity-60 mt-1">
                        {formatDateBA(Number(m.timestamp))}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Composer */}
          <div className="p-3 border-t border-neutral-800 flex gap-2 items-center">
            <input
              type="file"
              accept="image/*,application/pdf"
              ref={fileInputRef}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                const fd = new FormData();
                fd.append("file", file);
                const res = await fetch("/api/upload", {
                  method: "POST",
                  body: fd,
                });
                const json = await res.json();
                setUploading(false);
                if (json?.ok && json.url) {
                  setMediaUrl(json.url);
                } else {
                  alert("Error subiendo archivo");
                }
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 bg-neutral-800 rounded-lg text-sm"
              disabled={!selected || uploading}
            >
              {uploading ? "Subiendo..." : "📎"}
            </button>

            {mediaUrl && (
              <span className="text-[10px] bg-neutral-800 px-2 py-1 rounded border border-neutral-700">
                Imagen lista ✅
              </span>
            )}

            <input
              className="flex-1 bg-neutral-900 text-neutral-100 px-3 py-2 rounded-lg outline-none disabled:opacity-50"
              placeholder={selected ? "Escribir mensaje…" : "Seleccioná un contacto"}
              disabled={!selected}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? send() : undefined)}
            />

            <button
              onClick={send}
              disabled={!selected || (!text.trim() && !mediaUrl)}
              className="px-4 py-2 rounded-lg bg-emerald-600 disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
          
        </section>
      </div>
      <audio ref={audioRef} src="/notify.mp3" preload="auto" />
    </div>
  );
}
