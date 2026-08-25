"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, LayoutDashboard, Mic, Users } from "lucide-react";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: Users },
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/voice", label: "Voice", icon: Mic },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      {links.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-teal-50 text-accent"
                : "text-muted hover:bg-panel hover:text-ink"
            }`}
          >
            <Icon size={16} aria-hidden />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
