import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dienstplan",
  description: "Interner Dienstplan (Plan / Ist, Zeitkonto)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
