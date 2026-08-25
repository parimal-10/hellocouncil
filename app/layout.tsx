import "./globals.css";
import "@livekit/components-styles";
import Link from "next/link";
import type { ReactNode } from "react";
import { Scale } from "lucide-react";
import { NavLinks } from "./components/nav";

export const metadata = {
  title: "HelloCounsel Agent Operations",
  description: "Long-running legal-agent workflow operations",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col bg-panel text-ink">
          <header className="sticky top-0 z-40 border-b border-line/80 bg-white/85 backdrop-blur">
            <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              <Link className="flex items-center gap-2.5" href="/">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white shadow-sm">
                  <Scale size={17} aria-hidden />
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold tracking-tight">HelloCounsel</span>
                  <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">
                    Agent Operations
                  </span>
                </span>
              </Link>
              <NavLinks />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
          <footer className="border-t border-line/70 py-5">
            <p className="mx-auto max-w-7xl px-4 text-xs text-muted sm:px-6 lg:px-8">
              Durable workflow state, autonomous outreach, and human review for long-running legal agents.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
