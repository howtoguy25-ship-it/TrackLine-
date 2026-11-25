import "./globals.css";
import type { Metadata } from "next";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "TrackLine dashboard", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body className="text-ink antialiased">
        <AuthGate>
          <Shell>{children}</Shell>
        </AuthGate>
      </body>
    </html>
  );
}
