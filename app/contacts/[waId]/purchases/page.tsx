"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

/* ---------- Tipos ---------- */
type DebugInfo = {
  waId: string;
  listKey: string;
  len: number;
  parseErrors?: number;
  sampleRaw?: unknown[];
  sampleParsed?: unknown[];
};

type Purchase = {
  id: string;
  waId: string;
  amount: number;
  currency?: string;
  source?: string;
  createdAt: string;
  capiStatus?: "pending" | "ok" | "error";
  capiLastError?: string | null;
  ctwa_clid?: string | null;
  capiResult?: { fbtrace_id?: string | null; messages?: any } | null;
};

type ApiResponse = {
  ok: boolean;
  purchases: Purchase[];
  debug?: DebugInfo;
};

/* ---------- UI helpers ---------- */
function Badge({ status = "pending" as "ok" | "error" | "pending" }) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (status === "ok")
    return (
      <span className={`${base} bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-600/40`}>
        OK
      </span>
    );
  if (status === "error")
    return (
      <span className={`${base} bg-rose-600/20 text-rose-300 ring-1 ring-rose-600/40`}>
        Error
      </span>
    );
  return (
    <span className={`${base} bg-zinc-600/20 text-zinc-300 ring-1 ring-zinc-600/40`}>
      Pending
    </span>
  );
}

function Copy({ text, label = "copiar" }: { text?: string | null; label?: string }) {
  if (!text) return null;
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text)}
      className="text-xs underline opacity-80 hover:opacity-100"
      title="Copiar al portapapeles"
    >
      {label}
    </button>
  );
}

/* ---------- Page ---------- */
export default function PurchasesPage() {
  const { waId } = useParams<{ waId: string }>();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const url = useMemo(() => (waId ? `/api/contacts/${waId}/purchases` : null), [waId]);

  async function load() {
    if (!url) return;
    try {
      setLoading(true);
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error((json as any)?.error || `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(load, 4000); // poll cada 4s
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const purchases = data?.purchases ?? [];
  const len = data?.debug?.len ?? 0; // <-- usar SIEMPRE esta variable

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Compras vinculadas a Meta CAPI</h1>

          {data?.debug ? (
            <div className="text-xs opacity-70 space-y-1">
              <p>
                key: <span className="font-mono">{data.debug.listKey}</span>
                {" "}· len: {len}
                {" "}· parseErrors: {data.debug.parseErrors ?? 0}
              </p>
              {len > 0 && purchases.length === 0 ? (
                <details className="mt-1">
                  <summary className="cursor-pointer">Ver sampleRaw (no parseado)</summary>
                  <pre className="mt-1 rounded bg-zinc-900 p-2 overflow-auto text-[11px]">
                    {JSON.stringify(data.debug.sampleRaw ?? [], null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}

          <p className="text-sm opacity-70">WAID: {waId}</p>
        </div>

        <button
          onClick={load}
          className="rounded-xl border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          Refrescar
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60">
            <tr className="[&>th]:px-3 [&>th]:py-2 text-left text-xs uppercase tracking-wide opacity-70">
              <th>Fecha</th>
              <th>Monto</th>
              <th>Moneda</th>
              <th>Fuente</th>
              <th>CTWA CLID</th>
              <th>CAPI</th>
              <th>fbtrace_id</th>
              <th>Mensajes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {!loading && !error && purchases.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center opacity-70">
                  {len > 0
                    ? "Hay items en KV pero no se pudieron parsear. Revisa sampleRaw en el debug."
                    : "Sin compras aún."}
                </td>
              </tr>
            )}

            {purchases.map((p: any, i: number) => {
              const created = new Date(p.createdAt || p.created_at || Date.now());
              const messages = p?.capiResult?.messages ? JSON.stringify(p.capiResult.messages) : "";
              return (
                <tr key={p.id || i} className="[&>td]:px-3 [&>td]:py-2">
                  <td className="whitespace-nowrap">{created.toLocaleString()}</td>
                  <td>{p.amount}</td>
                  <td>{p.currency || "ARS"}</td>
                  <td className="opacity-80">{p.source || "-"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs break-all">{p.ctwa_clid || "-"}</span>
                      {p.ctwa_clid ? <Copy text={p.ctwa_clid} /> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Badge status={p.capiStatus || "pending"} />
                      {p.capiLastError ? (
                        <span className="text-rose-300" title={p.capiLastError}>!</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs break-all">{p?.capiResult?.fbtrace_id || "-"}</span>
                      {p?.capiResult?.fbtrace_id ? <Copy text={p.capiResult.fbtrace_id} /> : null}
                    </div>
                  </td>
                  <td className="max-w-[280px]">
                    <div className="flex items-center gap-2">
                      <span className="line-clamp-2 break-words opacity-80">{messages || "-"}</span>
                      {messages ? <Copy text={messages} label="copiar JSON" /> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs opacity-60">
        Tip: Para pruebas, usa <code className="px-1 rounded bg-zinc-900">META_TEST_CODE</code> en tu .env.
        Los eventos aparecerán en <em>Events Manager → Test events</em>.
      </p>
    </div>
  );
}

