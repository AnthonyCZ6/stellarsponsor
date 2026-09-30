import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StellarSponsor · Micro-mecenazgo transparente",
  description:
    "Apoya campañas con XLM sobre Stellar Soroban. Cada donación queda registrada on-chain y es auditable por cualquiera.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark">
      <body>{children}</body>
    </html>
  );
}
