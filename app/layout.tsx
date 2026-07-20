import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobHunter — AI application agent",
  description:
    "An AI agent that finds real jobs, scores your fit, and tailors your CV to each one.",
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
