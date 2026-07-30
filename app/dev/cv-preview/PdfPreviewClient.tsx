"use client";

import { useState } from "react";
import { buildCVDocument } from "@/lib/cvDocument";
import { fileToDataUrl, resizeImageDataUrl } from "@/lib/image";
import { printReactDocument } from "@/lib/print/printHtml";
import { CvHtmlTemplate } from "@/lib/pdf/CvHtmlTemplate";
import { Profile, TailoredCVContent } from "@/lib/types";

const MOCK_PROFILE: Omit<Profile, "photo"> = {
  name: "Muhammad Mustafa",
  title: "Senior Full-Stack Engineer",
  location: "Abu Dhabi, UAE",
  email: "mustufa50@gmail.com",
  phone: "+971 52 100 0409",
  links: ["linkedin.com/in/muhammad-mustafa-16477a99"],
  cvFormat: "both",
  summary: "",
  skills: [],
  experience: [],
  education: ["B.Sc. Computer Science — FAST-NUCES, Karachi, Pakistan"],
  certifications: [],
  languages: ["English (Fluent)"],
};

const MOCK_TAILORED_CV: TailoredCVContent = {
  summary:
    "Results-driven Quality Control Data Engineer with over 10 years of experience at ADNOC, beginning in operations before progressing across the Operations and Technical Center, contributing to projects, and moving into leading the Data Management team. Specialized in data governance, AI-powered quality tools, and cross-cultural stakeholder engagement, with a proven record of architecting and orchestrating enterprise data standards, quality frameworks, and automated reporting pipelines alongside world-leading partners including ExxonMobil, Shell, TotalEnergies, and JEDCO. Leverages advanced technology and automation to drive efficiency across the organization — spanning operations, terminal, HSE, and all business areas — transforming raw data into accurate, compliant, and decision-ready intelligence at enterprise scale. Passionate about harnessing cutting-edge technology to advance the UAE's national vision.",
  skills: [
    "React",
    "Next.js",
    "Node.js",
    "TypeScript",
    "PostgreSQL",
    "MongoDB",
    "REST APIs",
    "Stripe",
    "Multi-tenant SaaS",
    "TailwindCSS",
  ],
  experience: [
    {
      company: "AutoLeap",
      role: "Senior Full-Stack Engineer",
      dates: "2021 - Present",
      bullets: [
        "Own core modules (Workboard 2.0, Repair Orders, Purchase Orders) end-to-end for a SaaS platform serving 5,000+ auto-repair shops.",
        "Built and maintained performant, user-friendly UIs used daily by thousands of shops.",
        "Designed and integrated scalable backend logic and APIs on a large multi-tenant system.",
      ],
    },
    {
      company: "CultureAI",
      role: "Founding Engineer (solo)",
      dates: "2024 - Present",
      bullets: [
        "Architected and shipped a live multi-tenant AI employee-engagement SaaS solo.",
        "Owned the full stack: auth, multi-tenancy, data model, AI features, and UI.",
      ],
    },
  ],
  education: ["B.Sc. Computer Science — FAST-NUCES, Karachi, Pakistan"],
};

export default function PdfPreviewClient() {
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);

  const profile: Profile = { ...MOCK_PROFILE, photo };
  const doc = buildCVDocument(profile, MOCK_TAILORED_CV);

  async function selectPhoto(file: File) {
    setBusy(true);
    try {
      const raw = await fileToDataUrl(file);
      setPhoto(await resizeImageDataUrl(raw));
    } finally {
      setBusy(false);
    }
  }

  function testPrint() {
    printReactDocument(<CvHtmlTemplate doc={doc} />, "dev-preview-cv");
  }

  return (
    <main style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#666" }}>
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <strong>CV template dev preview</strong>
        <span style={{ opacity: 0.6, fontSize: 13 }}>
          Mock content — edit lib/pdf/CvHtmlTemplate.tsx and this updates live (plain HTML/CSS, no rebuild-the-PDF-viewer lag).
        </span>
        <label style={{ marginLeft: "auto", cursor: "pointer" }}>
          {busy ? "Uploading…" : "Test photo…"}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) selectPhoto(f);
              e.target.value = "";
            }}
          />
        </label>
        {photo && <button onClick={() => setPhoto("")}>Clear photo</button>}
        <button onClick={testPrint}>Print test PDF</button>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "24px 0" }}>
        <div style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.35)" }}>
          <CvHtmlTemplate doc={doc} />
        </div>
      </div>
    </main>
  );
}
