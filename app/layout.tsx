import "./globals.css";
import "@livekit/components-styles";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "HelloCounsel Agent Operations",
  description: "Long-running legal-agent workflow operations",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-panel text-ink">
          <header className="border-b border-line bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
              <Link href="/" className="text-lg font-semibold">
                HelloCounsel Agent Ops
              </Link>
              <nav className="flex gap-4 text-sm text-muted">
                <Link href="/">Dashboard</Link>
                <Link href="/cases">Cases</Link>
                <Link href="/review">Review</Link>
                <Link href="/voice">Voice</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
