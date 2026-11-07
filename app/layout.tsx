import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldhouse — Sports program management",
  description: "Official attendance and season records for school, college, and academy sports programs.",
  icons: { icon: "/fieldhouse-mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
