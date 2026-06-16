import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FortiGate Backup Portal",
  description: "Productieportaal voor FortiGate configuratiebackups"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
