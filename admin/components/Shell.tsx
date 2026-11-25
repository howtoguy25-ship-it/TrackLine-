"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { navFor } from "@/lib/nav";
import { useStaff } from "@/components/AuthGate";

export function Shell({ children }: { children: React.ReactNode }) {
  const staff = useStaff();
  const path = usePathname();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-ink text-white md:w-56 md:border-b-0 md:border-r">
        <div className="p-4 text-lg font-bold">TrackLine</div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {navFor(staff?.role ?? null).map((n) => (
            <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${path === n.href ? "bg-white/15 font-semibold" : "hover:bg-white/10"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden p-4 text-xs text-white/70 md:block">
          <div>{staff?.email}</div>
          <div className="mb-2">Role: {staff?.role}</div>
          <button className="underline" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-4 md:p-6">{children}</main>
    </div>
  );
}
