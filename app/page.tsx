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
    <span className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-neutral-900/80 border border-neutral-700/80">
      <span
        className={`h-2 w-2 rounded-full ${
          online ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-neutral-500"
        }`}
      />
      <span className="opacity-70">Número:</span>
      <span className="font-semibold">{label}</span>
    </span>
  );
}

function CopyMini({ text, title = "Copiar" }: { text?: string | null; title?: string }) {
  if (!text) return null;
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text)}
      className="text-[10px] underline opacity-60 hover:opacity-100"
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

function Tag({
  children,
  color = "neutral",
}: {
  children: React.ReactNode;
  color?: "neutral" | "green" | "blue" | "red";
}) {
  const base = "text-[10px] px-2 py-0.5 rounded-full border";
  const cls =
    color === "green"
      ? "bg-emerald-800/20 border-emerald-500/40 text-emerald-200"
      : color === "blue"
      ? "bg-sky-900/30 border-sky-500/40 text-sky-200"
      : color === "red"
      ? "bg-rose-900/30 border-rose-500/40 text-rose-200"
      : "bg-neutral-800/80 border-neutral-600/80 text-neutral-200";
  return <span className={`${base} ${cls}`}>{children}</span>;
}

const BA_TZ = "America/Argentina/Buenos_Aires";

function formatDateBA(ts: number | string) {
  if (!ts) return "-";
  let t = Number(ts);
  if (t < 1e12) t *= 1000;
  const date = new Date(t);
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Estado del sender
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

  // Cargar contactos
  useEffect(() => {
    let t: any;

    function startOfTodayMs() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
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
    t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [inboxId, selected]);

  // Completar info de compras
  useEffect(() => {
    let abort = false;

    async function fillHasBuy() {
      if (!contacts.length) return;

      const waIds = contacts.map((c) => normWaId(c.wa_id)).filter(Boolean);
      const missing = waIds.filter((id) => hasBuy[id] === undefined);
      if (!missing.length) return;

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
          // ignorar fallos de tanda
        }
      }
    }

    fillHasBuy();
    return () => {
      abort = true;
    };
  }, [contacts, hasBuy]);

  // Cargar thread
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
  
          // 👇 NUEVO: marcar también en el mapa de hasBuy
          setHasBuy(prev => ({
            ...prev,
            [selected]: true,   // selected ya es waId normalizado
          }));
        } else if (!abort) {
          setLastPurchase(null);
  
          // 👇 Si NO tiene compras, aseguramos que figure como false
          setHasBuy(prev => ({
            ...prev,
            [selected]: false,
          }));
        }
      } catch {
        if (!abort) {
          setLastPurchase(null);
        }
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
          id: globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : Math.random().toString(36).slice(2),
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
    <div className="h-dvh w-dvw flex flex-col bg-gradient-to-br from-neutral-950 via-black to-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-neutral-900/80 bg-black/70 backdrop-blur flex items-center justify-between px-5 h-14">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-300 text-xs font-bold">
            CRM
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-wide">Ignite</span>
            <span className="text-[11px] text-neutral-400">
              Panel en tiempo real · WhatsApp & Cargas
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-xs">
            <div className="px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 flex flex-col leading-tight">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wide">
                Contactos de hoy
              </span>
              <span className="text-xs font-semibold">{totalContacts}</span>
            </div>
            <div className="px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800 flex flex-col leading-tight">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wide">
                Conversion a carga
              </span>
              <span className="text-xs font-semibold">{conversion}%</span>
            </div>
          </div>

          <NumberStatus status={senderStatus} />

          <select
            value={inboxId}
            onChange={(e) => setInboxId(e.target.value)}
            className="text-xs bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/70"
          >
            <option value="ventas">📞 Ventas</option>
            <option value="soporte">🛠 Soporte</option>
          </select>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 min-h-0 px-3 pb-3 pt-2">
        <div className="h-full w-full rounded-2xl border border-neutral-900 bg-neutral-950/80 backdrop-blur-sm shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden grid grid-cols-[320px_1fr]">
          {/* Sidebar contactos */}
          <aside className="h-full border-r border-neutral-900/80 bg-gradient-to-b from-neutral-950 via-neutral-950 to-black overflow-y-auto scrollbar-dark">
            <div className="p-3 border-b border-neutral-900/80 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold tracking-wide uppercase text-neutral-400">
                    Contactos
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {totalCargas}/{totalContacts} cargaron · {conversion}%
                  </div>
                </div>
              </div>
              <div className="relative">
                <input
                  className="w-full bg-neutral-900/90 border border-neutral-800 rounded-full text-xs px-3 py-1.5 pr-7 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                  placeholder="Buscar por nombre o número…"
                  // (solo UI por ahora – sin lógica de filtrado)
                  readOnly
                />
                <span className="absolute right-2 top-1.5 text-neutral-600 text-xs">🔍</span>
              </div>
            </div>

            {contacts.length === 0 && (
              <div className="p-4 text-sm opacity-60">Sin contactos aún.</div>
            )}

            <ul className="p-2 flex flex-col gap-1">
              {contacts.map((c) => {
                const wa = normWaId(c.wa_id);
                const isSelected = selected === wa;
                const hasPurchase = !!hasBuy[wa];

                return (
                  <li key={c.wa_id}>
                    <button
                      onClick={() => setSelected(wa)}
                      className={`w-full text-left rounded-xl px-3 py-2.5 transition-all duration-150
                        ${
                          isSelected
                            ? "bg-emerald-600/10 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                            : "bg-neutral-900/70 border border-neutral-900 hover:border-neutral-700 hover:bg-neutral-900"
                        }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-neutral-800 flex items-center justify-center text-[11px] font-semibold text-neutral-200">
                            {nameOrPhone(c).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-semibold">
                              {nameOrPhone(c)}
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              {formatDateBA(c.lastMessageAt)}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex gap-1">
                            {hasPurchase && <Tag color="green">Cargó</Tag>}
                            {c.source_type === "ad" && <Tag color="blue">Ad</Tag>}
                          </div>
                          {c.customer_code && (
                            <span className="text-[10px] text-neutral-500 font-mono">
                              {c.customer_code}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] mt-1.5 text-neutral-400 line-clamp-1">
                        {c.lastText}
                      </div>

                      {c.campaign_id || c.adset_id || c.ad_id ? (
                        <div className="mt-1 text-[10px] text-neutral-500 flex flex-wrap gap-x-2 gap-y-0.5">
                          <span>Camp {shortId(c.campaign_id)}</span>
                          <span>Adset {shortId(c.adset_id)}</span>
                          <span>Ad {shortId(c.ad_id)}</span>
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Panel de conversación */}
          <section className="min-h-0 h-full flex flex-col bg-neutral-950/90">
            {/* Header conversación */}
            <div className="px-4 py-3 border-b border-neutral-900/80 flex items-center justify-between bg-gradient-to-r from-neutral-950 via-neutral-950 to-black/80">
              {selected ? (
                <>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-neutral-400">Chat con</span>
                      <span className="text-sm font-semibold tracking-wide">
                        {selectedContact ? nameOrPhone(selectedContact) : selected}
                      </span>
                      {selectedContact?.tag === "Tracked" && (
                        <Tag color="green">Tracked</Tag>
                      )}
                      {hasBuy[selected] && <Tag color="green">Cargó</Tag>}
                    </div>

                    {selectedContact && (
                      <>
                        {(selectedContact.campaign_id ||
                          selectedContact.adset_id ||
                          selectedContact.ad_id) && (
                          <div className="text-[11px] opacity-80 flex flex-wrap items-center gap-2">
                            <span className="text-neutral-400">Origen:</span>
                            <span>
                              Campaña{" "}
                              <span className="font-mono">
                                {selectedContact.campaign_id || "-"}
                              </span>
                            </span>
                            <CopyMini
                              text={selectedContact.campaign_id}
                              title="Copiar campaign_id"
                            />
                            <span>
                              · Adset{" "}
                              <span className="font-mono">
                                {selectedContact.adset_id || "-"}
                              </span>
                            </span>
                            <CopyMini
                              text={selectedContact.adset_id}
                              title="Copiar adset_id"
                            />
                            <span>
                              · Ad{" "}
                              <span className="font-mono">
                                {selectedContact.ad_id || "-"}
                              </span>
                            </span>
                            <CopyMini
                              text={selectedContact.ad_id}
                              title="Copiar ad_id"
                            />
                            {selectedContact.ctwa_clid ||
                            selectedContact.ctw_clid ? (
                              <>
                                <span>
                                  · CTWA CLID{" "}
                                  <span className="font-mono">
                                    {selectedContact.ctwa_clid ||
                                      selectedContact.ctw_clid}
                                  </span>
                                </span>
                                <CopyMini
                                  text={
                                    selectedContact.ctwa_clid ||
                                    selectedContact.ctw_clid
                                  }
                                  title="Copiar ctwa_clid"
                                />
                              </>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {lastPurchase && (
                      <div className="hidden md:flex flex-col items-end rounded-xl bg-emerald-900/20 border border-emerald-500/40 px-3 py-1.5 text-[11px] text-emerald-100">
                        <span className="font-semibold">
                          Última carga: {lastPurchase.value}{" "}
                          {lastPurchase.currency}
                        </span>
                        <span className="text-[10px] opacity-80">
                          {formatDateBA(lastPurchase.ts)}
                        </span>
                      </div>
                    )}

                    <button
                      className="text-xs bg-emerald-600/90 hover:bg-emerald-500 px-3 py-1.5 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)] disabled:opacity-40 disabled:shadow-none transition"
                      disabled={!selected || sendingPurchase}
                      onClick={async () => {
                        if (!selected || sendingPurchase) return;

                        const raw = window.prompt(
                          "Importe de la carga (ej: 2000):",
                          "0"
                        );
                        if (raw == null) return;

                        const value = Number(raw);
                        if (!Number.isFinite(value) || value <= 0) {
                          alert("Importe inválido");
                          return;
                        }

                        const currency = "ARS";

                        try {
                          setSendingPurchase(true);
                          const waId = normWaId(selected);
                          const r = await fetch(`/api/${waId}/events/purchase`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              amount: value,
                              currency,
                              source: "manual",
                            }),
                          });

                          const textResp = await r.text();
                          const j = textResp ? JSON.parse(textResp) : null;

                          if (!r.ok || !j?.ok) {
                            throw new Error(j?.error || `HTTP ${r.status}`);
                          }

                          setPurchaseToast(
                            `Compra ${value} ${currency} registrada${
                              j?.events_received ? " y enviada a Meta" : ""
                            }`
                          );
                          setTimeout(() => setPurchaseToast(null), 3000);

                          try {
                            const pr = await fetch(
                              `/api/contacts/${waId}/purchases`,
                              { cache: "no-store" }
                            );
                            const pj = await pr
                              .json()
                              .catch(() => ({}));
                            const has =
                              !!(pj?.ok &&
                              Array.isArray(pj.purchases) &&
                              pj.purchases.length);
                            setHasBuy((prev) => ({ ...prev, [waId]: has }));
                          } catch {}
                        } catch (e: any) {
                          alert(
                            "Error al registrar carga: " +
                              (e?.message || "desconocido")
                          );
                        } finally {
                          setSendingPurchase(false);
                        }
                      }}
                    >
                      {sendingPurchase ? "Marcando…" : "Marcar Carga"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-sm opacity-60">
                  Seleccioná un contacto en la columna izquierda.
                </div>
              )}
            </div>

            {purchaseToast && (
              <div className="px-4 py-2 text-xs bg-emerald-900/40 border-b border-emerald-800 text-emerald-50">
                {purchaseToast}
              </div>
            )}

            {/* Mensajes */}
            <div
              ref={scrollerRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-neutral-950 scrollbar-dark"
              style={{ scrollbarGutter: "stable" as any }}
            >
              <div className="px-4 pt-4 pb-2 flex flex-col gap-3">
                {!selected && (
                  <div className="opacity-60 text-sm">
                    Elegí un contacto de la izquierda para ver la conversación.
                  </div>
                )}

                {selected && messages.length === 0 && (
                  <div className="opacity-60 text-sm">
                    Sin mensajes todavía. Envía el primer mensaje.
                  </div>
                )}

                {selected &&
                  messages.map((m) => {
                    const isOut = m.direction === "out";
                    return (
                      <div
                        key={m.id}
                        className={`flex ${
                          isOut ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[72%] rounded-2xl px-3 py-2.5 border text-sm shadow-sm ${
                            isOut
                              ? "bg-emerald-600 text-white border-emerald-500/60 shadow-[0_0_18px_rgba(16,185,129,0.4)]"
                              : "bg-neutral-900 text-neutral-100 border-neutral-800"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="text-[11px] opacity-80">
                              {isOut ? "Tú" : "Contacto"}
                            </div>
                            <div className="text-[10px] opacity-70">
                              {formatDateBA(Number(m.timestamp))}
                            </div>
                          </div>

                          {m.text && m.text.trim().length > 0 && (
                            <div className="whitespace-pre-wrap break-words mb-1.5">
                              {m.text}
                            </div>
                          )}

                          {m.media_type === "image" && m.media_url && (
                            <img
                              src={m.media_url}
                              alt="Imagen"
                              className="rounded-lg mt-1 max-w-xs shadow"
                            />
                          )}

                          {m.media_type === "pdf" && m.media_url && (
                            <a
                              href={m.media_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs underline mt-1 inline-block"
                            >
                              Ver PDF adjunto
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Composer */}
            <div className="p-3 border-t border-neutral-900/80 bg-black/70 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500/80 mr-1" />
                <span>Responde en menos de 5 minutos para mejorar las ventas.</span>
              </div>

              <div className="flex gap-2 items-center">
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
                  className="h-10 w-10 flex items-center justify-center rounded-full bg-neutral-900 border border-neutral-800 text-lg hover:bg-neutral-800 disabled:opacity-40"
                  disabled={!selected || uploading}
                  title="Adjuntar archivo"
                >
                  {uploading ? "…" : "📎"}
                </button>

                {mediaUrl && (
                  <span className="text-[11px] bg-neutral-900 px-2 py-1 rounded-full border border-neutral-700 text-neutral-200">
                    Archivo listo ✅
                  </span>
                )}

                <input
                  className="flex-1 bg-neutral-900/90 text-neutral-100 px-3 py-2.5 rounded-full text-sm border border-neutral-800 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 disabled:opacity-50"
                  placeholder={
                    selected ? "Escribir mensaje…" : "Seleccioná un contacto"
                  }
                  disabled={!selected}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => (e.key === "Enter" ? send() : undefined)}
                />

                <button
                  onClick={send}
                  disabled={!selected || (!text.trim() && !mediaUrl)}
                  className="px-4 h-10 rounded-full bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold flex items-center gap-1 disabled:opacity-40 disabled:hover:bg-emerald-600/80 transition"
                >
                  <span>Enviar</span>
                  <span>➤</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <audio ref={audioRef} src="/notify.mp3" preload="auto" />
    </div>
  );
}
