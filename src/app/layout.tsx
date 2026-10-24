import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Studio (working title)", template: "%s · Studio" },
  description: "Agents for campaign strategy, creative and performance, with people approving every move.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
