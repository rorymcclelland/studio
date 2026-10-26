"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/** A link inside a popover menu: it closes the menu as it navigates, since the shell stays on screen. */
export function MenuLink({ href, popover, children }: { href: string; popover: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={buttonClass("quiet", "sm", "w-full")}
      onClick={() => document.getElementById(popover)?.hidePopover()}
    >
      {children}
    </Link>
  );
}
