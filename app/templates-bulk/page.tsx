// app/templates-bulk/page.tsx
"use client";

import { useState, FormEvent } from "react";

type SendResult = {
  to: string;
  ok: boolean;
  sid?: string;
  error?: string;
};

const MAX_NUMBERS = 5000;
const normWaId = (s: string) => String(s || "").replace(/[^\d]/g, "");

export default function TemplatesBulkPage() {
  const [inboxId, setInboxId] = useState<"ventas" | "soporte">("ventas");
  const [contentSid, setContentSid] = useState("");
  const [var1, setVar1] = useState("");
  const [var2, setVar2] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountKey, setAccountKey] = useState("main");
  // numeros
  const [rawNumbers, setRawNumbers] = useState("");
  const [numbers, setNumbers] = useState<string[]>([]);
  const [loadingCRM, setLoadingCRM] = useState(false);

  // ---- helpers internos ----
  const validateNumbers = (input: string) => {
    const lines = input
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const valid = lines.filter((n) => /^[0-9]{10,15}$/.test(n)); // solo dígitos 10–15
    setNumbers(valid);
  };

  const loadFromCRM = async () => {
    try {
      setLoadingCRM(true);

      const res = await fetch("/api/contacts/export?inbox_id=ventas", {
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));

      if (!j?.ok) {
        alert("Error cargando contactos desde CRM");
        return;
      }

      const unique = Array.from(
        new Set(
          (j.contacts || [])
            .map((c: any) => normWaId(c.wa_id))
            .filter(Boolean)
        )
      );

      const text = unique.join("\n");
      setRawNumbers(text);
      validateNumbers(text);
    } catch (e: any) {
      alert("Error cargando CRM: " + (e?.message || "desconocido"));
    } finally {
      setLoadingCRM(false);
    }
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);

    if (numbers.length === 0) {
      setError("Tenés que poner al menos un número de destino");
      return;
    }
    if (numbers.length > MAX_NUMBERS) {
      setError(`Máximo permitido: ${MAX_NUMBERS} números`);
      return;
    }
    if (!contentSid.trim()) {
      setError("Falta el Content SID del template (HX...)");
      return;
    }

    const payload = {
      toNumbers: numbers,          // 👉 ahora usamos los números validados
      inbox_id: inboxId,
      content_sid: contentSid.trim(),
      variables: {
        "1": var1,
        "2": var2,
        accountKey, // 👈 clave de cuenta Twilio
        
      },
    };

    setSending(true);
    try {
      const res = await fetch("/api/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Error enviando templates");
      }
      setResults(json?.results || null);
    } catch (err: any) {
      setError(err?.message || "Error de red");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex justify-center px-4 py-10">
      <div className="w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-2xl font-bold mb-4">
          Enviar template de WhatsApp (Twilio)
        </h1>
        <p className="text-sm opacity-70 mb-6">
          Pegá una lista de números, el Content SID del template (HX...) y las
          variables. Esto envía <span className="font-semibold">un mensaje por número</span> usando Twilio.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Números destino */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm opacity-80">
                Números destino (uno por línea, con código de país)
              </label>

              <button
                type="button"
                onClick={loadFromCRM}
                disabled={loadingCRM}
                className="text-xs px-2 py-1 rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 disabled:opacity-40"
              >
                {loadingCRM ? "Cargando..." : "Cargar desde CRM"}
              </button>
            </div>

            <textarea
              className="w-full h-40 bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-sm"
              placeholder={"Ej:\n549112345678\n549113334455"}
              value={rawNumbers}
              onChange={(e) => {
                setRawNumbers(e.target.value);
                validateNumbers(e.target.value);
              }}
            />

            <div className="text-xs mt-1">
              <span
                className={
                  numbers.length > MAX_NUMBERS
                    ? "text-red-400"
                    : "text-emerald-400"
                }
              >
                {numbers.length}
              </span>{" "}
              de {MAX_NUMBERS} números válidos
            </div>
            {numbers.length > MAX_NUMBERS && (
              <div className="text-xs text-red-400 mt-1">
                ❌ Máximo permitido: {MAX_NUMBERS} números
              </div>
            )}
          </div>

          {/* Inbox & Content SID & Cuenta Twilio */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm mb-1">Inbox / línea</label>
              <select
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                value={inboxId}
                onChange={(e) =>
                  setInboxId(e.target.value as "ventas" | "soporte")
                }
              >
                <option value="ventas">📞 Ventas</option>
                <option value="soporte">🛠 Soporte</option>
              </select>
            </div>
          
            <div className="flex-1">
              <label className="block text-sm mb-1">Content SID (template)</label>
              <input
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={contentSid}
                onChange={(e) => setContentSid(e.target.value)}
              />
            </div>
          
            <div className="flex-1">
              <label className="block text-sm mb-1">Cuenta de Twilio</label>
              <select
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                value={accountKey}
                onChange={(e) => setAccountKey(e.target.value)}
              >
                <option value="main">Cuenta principal</option>
                <option value="tribet">Tribet</option>
                <option value="casinoX">Casino X</option>
                {/* agregas más cuentas según tu .env */}
              </select>
              <p className="text-[11px] opacity-60 mt-1">
                El SID y el Token reales se configuran en el backend (.env) para cada cuenta.
              </p>
            </div>
          </div>

          {/* Variables */}
          <div>
            <label className="block text-sm mb-1">Variables del template</label>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1">
                <div className="text-[11px] opacity-70 mb-1">
                  Variable {"{{1}}"}
                </div>
                <input
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ej: Nombre del cliente"
                  value={var1}
                  onChange={(e) => setVar1(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <div className="text-[11px] opacity-70 mb-1">
                  Variable {"{{2}}"} (opcional)
                </div>
                <input
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ej: enlace a reserva"
                  value={var2}
                  onChange={(e) => setVar2(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[11px] opacity-60 mt-1">
              Asegurate de que tu template en Twilio tenga{" "}
              <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, etc.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-700/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Botón enviar */}
          <button
            type="submit"
            disabled={sending}
            className="mt-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-medium"
          >
            {sending ? "Enviando templates..." : "Enviar templates"}
          </button>
        </form>

        {/* Resultados */}
        {results && (
          <div className="mt-6 text-sm">
            <h2 className="font-semibold mb-2">Resultados</h2>
            <div className="space-y-1 max-h-64 overflow-y-auto border border-neutral-800 rounded-lg p-3 bg-neutral-950/60">
              {results.map((r, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center text-xs border-b border-neutral-800/40 pb-1 last:border-b-0"
                >
                  <span className="opacity-80">{r.to}</span>
                  {r.ok ? (
                    <span className="text-emerald-400">OK ({r.sid})</span>
                  ) : (
                    <span className="text-red-400">Error: {r.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
