import type { Metadata, Viewport } from "next";
import "./globals.css";

// next/font/google fetches the font at build time; on a flaky network the build fails. Use a
// system monospace stack instead so the build is offline-safe (verify-branch robustness).
const jetbrainsMono = {
  variable: "font-mono-system",
} as const;

export const metadata: Metadata = {
  title: "Ptylon — Browser Terminal Workspace",
  description: "Browser-based terminal workspace",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ptylon",
  },
};

export const viewport: Viewport = {
  themeColor: "#40E0D0",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${jetbrainsMono.variable} antialiased bg-[#0a0e14] text-white`}>
        {children}
      </body>
    </html>
  );
}
