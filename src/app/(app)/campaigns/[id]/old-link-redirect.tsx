"use client";

// U10-2: links made before the campaign had stages point at a section of the
// one-page campaign (/campaigns/<id>#creative). A fragment never reaches the
// server, so the overview sends them on here: a fragment that names a section
// replaces the address with that section's stage, keeping the fragment, so
// /campaigns/<id>#personas lands on /campaigns/<id>/audience#personas.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { stageForHash, stageHref } from "@/lib/campaigns/stages";

export function OldLinkRedirect({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    const stage = stageForHash(hash);
    if (stage) router.replace(`${stageHref(campaignId, stage)}${hash}`);
  }, [campaignId, router]);
  return null;
}
