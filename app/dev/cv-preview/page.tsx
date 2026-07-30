"use client";

// Dev-only CV template preview — renders the actual PDF live via
// react-pdf's PDFViewer so template tweaks (spacing, colors, icons) can be
// checked instantly without going through search → tailor → apply →
// download for every change. Blocked outside development below.
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

const PdfPreviewClient = dynamic(() => import("./PdfPreviewClient"), { ssr: false });

export default function CVPreviewDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PdfPreviewClient />;
}
