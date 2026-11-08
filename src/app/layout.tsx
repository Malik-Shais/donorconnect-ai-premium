import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "DonorConnect AI Premium", template: "%s · DonorConnect AI" },
  description: "Coordinate blood donors and requesters with preliminary matching, consent-based contact sharing and a safe AI assistant.",
  applicationName: "DonorConnect AI",
  appleWebApp: { capable: true, title: "DonorConnect", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#7a1630", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="absolute -left-[999px] top-2 z-[100] rounded-lg bg-navy px-4 py-2 text-white focus:left-2">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
