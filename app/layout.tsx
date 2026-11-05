import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ScaleUp Admin", template: "%s · ScaleUp Admin" },
  description: "ScaleUp Web operations dashboard",
  // Private tool — keep it out of every search engine.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } }
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        {children}
      </body>
    </html>
  );
}
