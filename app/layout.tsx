import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldhouse — Sports program management",
  description: "Attendance, match records, and ready-player lists for a sports academy.",
  icons: { icon: "/fieldhouse-mark.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
