import type { Metadata } from "next";
import "./globals.css";

const TITLE = "JobHunter — AI application agent";
const DESCRIPTION =
  "An AI agent that finds recommended jobs and tailors your CV to each one.";
const BANNER_PATH = "/jobhunter-ai-job-search-agent-banner.png";

export const metadata: Metadata = {
  metadataBase: new URL("https://jobhunter-lemon.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "JobHunter",
    images: [{ url: BANNER_PATH, width: 1672, height: 941, alt: TITLE }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [BANNER_PATH],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
