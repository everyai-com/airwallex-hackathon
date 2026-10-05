import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "Airwallex Developer Lab",
  description:
    "Agentic Banking Hackathon — sixteen starter kits sharing one typed REST client, policy layer, and approval gate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geist.variable} suppressHydrationWarning>
      <body className="relative z-0 font-sans antialiased">{children}</body>
    </html>
  );
}
