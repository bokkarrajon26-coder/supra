"use client";

import { useEffect, useState } from "react";

type StatsCargas = {
  ok: boolean;
  total: number;
  conCargas: number;
  conversion: number;
  hoy: number;
  ayer: number;
  tz: string;
};

type Contact = {
  wa_id: string;
  lastMessageAt?: number;
  inbox_id?: string;
  // ...lo que venga
};

const normWaId = (s: string) => String(s || "").replace(/[^\d]/g, "");
const BA_TZ = "America/Argentina/Buenos_Aires";

// convierte ts a YYYY-MM-DD en Buenos Aires
function toBAStringDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-CA", {
    timeZone: BA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }); // "2025-11-09"
}

// devuelve hoy y ayer en BA como YYYY-MM-DD
function getTodayBA() {
  const now = Date.now();
  const today = toBAStringDate(now);
  const y = toBAStringDate(now - 24 * 60 * 60 * 1000);
  return { today, yesterday: y };
}

// parsea YYYY-MM-DD a Date (00:00 BA)
function dateFromYMD(ymd: string): Date {
  // lo creamos en UTC y después comparamos por string BA, así es más simple
  return new Date(ymd + "T00:00:00");
}

export default function StatsPage() {
  const [statsCargas, setStatsCargas] = useState<StatsCargas | null>(null);
  const [contactsToday, setContactsToday] = useState<{ ok: boolean; hoy: number } | null>(null);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [totalContacts, setTotalContacts] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [activeRange, setActiveRange] = useState<string | null>(null);
  // rango dinámico
  const [rangeLabel, setRangeLabel] = useState<string>("Ayer");
  const [filteredCargas, setFilteredCargas] = useState<number | null>(null);
  const [filteredContacts, setFilteredContacts] = useState<number | null>(null);
  const [conversionRange, setConversionRange] = useState<number | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, contactsTodayRes, ventasRes, soporteRes] = await Promise.all([
          fetch("/api/stats/cargas", { cache: "no-store" }),
          fetch("/api/stats/contacts-today", { cache: "no-store" }),
          fetch("/api/contacts?limit=all&inbox_id=ventas", { cache: "no-store" }),
          fetch("/api/contacts?limit=all&inbox_id=soporte", { cache: "no-store" }),
        ]);

        const statsJson = await statsRes.json().catch(() => null);
        const contactsTodayJson = await contactsTodayRes.json().catch(() => null);
        const ventasJson = await ventasRes.json().catch(() => ({ contacts: [] }));
        const soporteJson = await soporteRes.json().catch(() => ({ contacts: [] }));

        // unificamos contactos
        const merged: Contact[] = [
          ...(ventasJson.contacts || []),
          ...(soporteJson.contacts || []),
        ];

        // set total (únicos por wa)
        const uniq = new Set<string>();
        merged.forEach((c) => {
          const wa = normWaId(c.wa_id || "");
          if (wa) uniq.add(wa);
        });

        setAllContacts(merged);
        setTotalContacts(uniq.size);

        if (statsJson?.ok) setStatsCargas(statsJson);
        if (contactsTodayJson?.ok) setContactsToday(contactsTodayJson);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // cuenta contactos del rango en el front
  function countContactsInRange(fromYMD: string, toYMD: string): number {
    if (!fromYMD && !toYMD) return 0;
    // como estamos comparando por string BA ya fecha, lo más simple es:
    const fromDate = dateFromYMD(fromYMD);
    const toDate = dateFromYMD(toYMD);
    // ponemos toDate al final del día
    toDate.setDate(toDate.getDate() + 1);

    let count = 0;
    for (const c of allContacts) {
      const ts = Number(c.lastMessageAt || 0);
      if (!ts) continue;
      const tsMs = ts < 1e12 ? ts * 1000 : ts; // por si viene en segundos
      const baStr = toBAStringDate(tsMs); // "2025-11-09"
      const d = dateFromYMD(baStr);
      if (d >= fromDate && d < toDate) {
        count++;
      }
    }
    return count;
  }

  // trae cargas del rango desde backend y cuenta contactos acá
  async function fetchRange(fromYMD: string, toYMD: string, label: string) {
    try {
      const base = window.location.origin;
      const urlCargas = new URL("/api/stats/cargas", base);
      if (fromYMD) urlCargas.searchParams.set("from", fromYMD);
      if (toYMD) urlCargas.searchParams.set("to", toYMD);

      const cargasRes = await fetch(urlCargas.toString(), { cache: "no-store" });
      const cargasJson = await cargasRes.json().catch(() => null);

      const cargas = cargasJson?.ok ? cargasJson.cargas ?? 0 : 0;
      const contactos = countContactsInRange(fromYMD, toYMD);

      setFilteredCargas(cargas);
      setFilteredContacts(contactos);
      setConversionRange(contactos > 0 ? Math.round((cargas / contactos) * 100) : 0);
      setRangeLabel(label);
    } catch {
      setFilteredCargas(null);
      setFilteredContacts(null);
      setConversionRange(null);
    }
  }

  // atajos
  function selectQuickRange(type: "ayer" | "semana" | "mes") {
    const now = new Date();
    const todayYMD = now.toISOString().slice(0, 10);

    if (type === "ayer") {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      const ymd = y.toISOString().slice(0, 10);
      fetchRange(ymd, ymd, "Ayer");
      return;
    }

    if (type === "semana") {
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      const fromYMD = start.toISOString().slice(0, 10);
      fetchRange(fromYMD, todayYMD, "Última Semana");
      return;
    }

    if (type === "mes") {
      const start = new Date(now);
      start.setDate(now.getDate() - 30);
      const fromYMD = start.toISOString().slice(0, 10);
      fetchRange(fromYMD, todayYMD, "Último Mes");
      return;
    }
  }

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-neutral-400 bg-black">
        Cargando estadísticas...
      </div>
    );
  }

  if (!statsCargas) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-red-500 bg-black">
        Error al obtener estadísticas
      </div>
    );
  }

  // métricas base
  const conversionTotal =
    totalContacts > 0 ? Math.round((statsCargas.conCargas / totalContacts) * 100) : 0;
  const contactosHoy = contactsToday?.hoy ?? 0;
  const conversionHoy =
    contactosHoy > 0 ? Math.round((statsCargas.hoy / contactosHoy) * 100) : 0;

  return (
    <div className="min-h-screen bg-black text-neutral-100 flex flex-col items-center p-6 gap-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <span role="img" aria-label="panel">📊</span> Panel de Cargas
      </h1>

      <div className="grid grid-cols-3 gap-6 max-w-5xl w-full">
        {/* 1. Conversión total */}
        <Card title="Conversión Total">
          <div className="text-4xl font-bold text-emerald-400">{conversionTotal}%</div>
          <p className="text-xs opacity-70 mt-1">
            {statsCargas.conCargas} de {totalContacts} contactos con carga
          </p>
        </Card>

        {/* 2. Mensajes hoy */}
        <Card title="Mensajes Hoy">
          <div className="text-4xl font-bold text-emerald-300">{contactosHoy}</div>
          <p className="text-xs opacity-70 mt-1">Conversión {conversionHoy}%</p>
        </Card>

        {/* 3. Tarjeta dinámica de rango */}
        <Card title="Análisis por Fecha">
          <div className="flex flex-col gap-3">
           <div className="flex gap-2">
            {[
              { key: "ayer", label: "Ayer" },
              { key: "semana", label: "Semana" },
              { key: "mes", label: "Mes" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setActiveRange(key); // nuevo estado
                  selectQuickRange(key as "ayer" | "semana" | "mes");
                }}
                className={`text-xs px-3 py-1.5 rounded transition-colors ${
                  activeRange === key
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-neutral-800 hover:bg-neutral-700"
                }`}
              >
                {label}
              </button>
            ))}
          
            <button
              onClick={() => {
                setShowCalendar((p) => !p);
                setActiveRange("custom");
              }}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                activeRange === "custom"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              Rango personalizado
            </button>
          </div>



            {showCalendar && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="bg-neutral-900 text-neutral-100 text-xs rounded px-2 py-1 border border-neutral-700"
                />
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="bg-neutral-900 text-neutral-100 text-xs rounded px-2 py-1 border border-neutral-700"
                />
                <button
                  onClick={() => {
                    if (!from || !to) return;
                    fetchRange(from, to, "Rango Personalizado");
                  }}
                  className="text-xs bg-emerald-600 px-3 py-1.5 rounded hover:bg-emerald-700"
                >
                  Aplicar
                </button>
              </div>
            )}

            {filteredCargas !== null && filteredContacts !== null && (
              <div className="text-sm mt-1">
                <div className="font-medium text-emerald-300">{rangeLabel}</div>
                <div className="opacity-80 text-xs mt-1">
                  Cargas: <b>{filteredCargas}</b> · Mensajes: <b>{filteredContacts}</b>
                </div>
                <div className="text-xs mt-1">
                  Conversión{" "}
                  <span className="text-emerald-400 font-semibold">
                    {conversionRange ?? 0}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4 shadow min-h-[160px] flex flex-col justify-between">
      <h2 className="text-sm opacity-70 mb-2">{title}</h2>
      {children}
    </div>
  );
}
