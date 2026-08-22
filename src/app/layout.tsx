import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AmbientBackground } from "@/components/ui/AmbientBackground";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ACCENT } from "@/lib/accent";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: "Last Man Standing",
  title: {
    default: "Last Man Standing — NFL Survival League",
    template: "%s · Last Man Standing",
  },
  description:
    "Run a private NFL survival league with your friends. One team a week, automated eliminations, live scores. Installs to your home screen — no app store.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Last Man Standing",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png" }],
  },
};

export const viewport: Viewport = {
  // The accent itself, imported rather than retyped: metadata is a plain string
  // and no Tailwind token can reach it, so a hardcoded hex here is a colour a
  // palette change silently leaves behind. `public/manifest.webmanifest` states
  // the same value and CANNOT import it — keep the two in step.
  themeColor: ACCENT,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AmbientBackground />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
