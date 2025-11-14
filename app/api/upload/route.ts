// app/api/upload/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Falta archivo" }, { status: 400 });
    }

    // leemos el binario que mandó el navegador
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    // detectar si es PDF
    const fileName = (file as any).name || "upload";
    const isPdf =
      file.type === "application/pdf" ||
      fileName.toLowerCase().endsWith(".pdf");

    // armamos data URI
    const dataUri = `data:${file.type};base64,${base64}`;

    // elegimos endpoint según tipo
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
    const preset = process.env.CLOUDINARY_UPLOAD_PRESET!;

    const endpoint = isPdf
      ? `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`
      : `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;

    const params = new URLSearchParams({
      file: dataUri,
      upload_preset: preset,
    });

    // para pdf aclaramos que es raw (algunos presets lo necesitan)
    if (isPdf) {
      params.set("resource_type", "raw");
      // nombre sin espacios ni barras
      const clean = fileName.replace(/[\\\/]/g, "_");
      params.set("public_id", clean.replace(/\.[^.]+$/, "")); // sin .pdf final
    } else {
      // para imagen, por si hay nombres raros
      const clean = fileName.replace(/[\\\/]/g, "_");
      params.set("public_id", clean);
    }

    const cloudRes = await fetch(endpoint, {
      method: "POST",
      body: params,
    });

    const json = await cloudRes.json();

    if (!cloudRes.ok || !json.secure_url) {
      console.error("❌ Cloudinary upload error:", json);
      return NextResponse.json(
        { ok: false, error: json?.error?.message || "Error subiendo a Cloudinary" },
        { status: 500 }
      );
    }

    // esta es la URL que después vas a mandar con /api/send
    return NextResponse.json({
      ok: true,
      url: json.secure_url,
      kind: isPdf ? "pdf" : "image",
    });
  } catch (err: any) {
    console.error("upload error", err);
    return NextResponse.json({ ok: false, error: err?.message || "error" }, { status: 500 });
  }
}

