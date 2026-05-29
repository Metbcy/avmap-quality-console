import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import dynamic from "next/dynamic";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const SplashOverlay = dynamic(() => import("@/components/SplashOverlay"));

export const metadata: Metadata = {
  title: "avmap",
  description:
    "An independent open-source prototype exploring tooling for high-stakes geospatial data quality.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className="min-h-full font-sans">
        {children}
        <SplashOverlay />
      </body>
    </html>
  );
}
