"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ClubTabs({ clubId }: { clubId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/clubs/${clubId}`;
  const tabs = [
    { href: base, label: "Current" },
    { href: `${base}/history`, label: "History" }
  ];

  return (
    <nav className="flex gap-1 border-b border-black/10 -mb-px">
      {tabs.map((t) => {
        const active =
          t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              active
                ? "border-ink text-ink font-medium"
                : "border-transparent muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
