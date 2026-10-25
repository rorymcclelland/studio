import type { Metadata, Viewport } from "next";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Studio (working title)", template: "%s · Studio" },
  description: "Agents for campaign strategy, creative and performance, with people approving every move.",
};

// Light theme only for now (Sprint 2 refinement, Q7): tell the browser not
// to darken the page when the operating system is set to dark.
export const viewport: Viewport = {
  colorScheme: "only light",
  themeColor: "#f3f5fb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
