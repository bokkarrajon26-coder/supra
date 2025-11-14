// app/api/inbox/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  direction: "in" | "out";
  wa_id?: string;
  ctw_clid?: string | null;
  referral_source_type?: string | null;
  referral_source_url?: string | null;
  media_url?: string;
  media_type?: "image" | "pdf";
};


const g = global as any;
if (!g.__MEM__) g.__MEM__ = [] as Msg[];
const STORE: Msg[] = g.__MEM__;

export async function GET() {
  return NextResponse.json({ ok: true, messages: STORE });
}
