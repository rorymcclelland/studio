import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getBrand } from "@/lib/brands/repo";
import { readAdEstimate } from "@/lib/creative/costs";
import { ENGLISH, LANG_NAMES, listBrandLanguages } from "@/lib/creative/languages";
import { formatWhen } from "@/lib/format";
import { isActive, listUploads } from "@/lib/uploads/repo";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AutoRefresh } from "@/components/auto-refresh";
import { OutcomePill } from "./outcome";
import { UploadForm } from "./upload-form";

// C8-3: a brand's Check an ad page. Upload an ad made outside Studio (an
// agency's PNG, say) and check it against the brand's kit: the Read ad agent
// reads its words and estimates where they and the logo sit, then code checks
// the words and measures the contrast. The cost shows on the button. Earlier
// uploads are listed with their outcome. A person's upload is their own data:
// it is never shown as demo content (rule 2) and never used in ads or a pack.

export const metadata = { title: "Check an ad" };

async function CheckContent(props: PageProps<"/brands/[id]/check">) {
  const { id } = await props.params;
  const member = await requireMember();
  const brand = await getBrand(member.userId, id);
  if (!brand) notFound();
  const [languages, uploads] = await Promise.all([listBrandLanguages(member.userId, brand.id), listUploads(member.userId, brand.id)]);
  const cost = readAdEstimate().label;

  return (
    <div className="space-y-8">
      <div>
        <TextLink href={`/brands/${brand.id}`}>
          <span aria-hidden>← </span>Back to {brand.name}
        </TextLink>
        <h1 className="mt-3 min-w-0 text-title font-strong wrap-anywhere">Check an ad</h1>
        <p className="mt-2 max-w-prose text-lg text-ink-2 wrap-anywhere">
          Upload an ad made outside Studio, such as an agency&apos;s PNG, and check it against {brand.name}&apos;s kit. The Read
          ad agent (AI) reads its words and estimates where they and the logo sit; code then checks the words and measures the
          contrast. Each finding says how it was found. Nothing in the ad is changed.
        </p>
      </div>

      <Card as="section" aria-labelledby="upload" className="space-y-4">
        <h2 id="upload" className="text-2xl font-strong tracking-tight">
          Upload an ad
        </h2>
        <UploadForm
          brandId={brand.id}
          cost={cost}
          languages={[{ lang: ENGLISH, name: LANG_NAMES[ENGLISH] }, ...languages.map((l) => ({ lang: l.lang, name: l.name }))]}
        />
      </Card>

      <Card as="section" aria-labelledby="uploads" className="space-y-4" data-uploads="">
        <h2 id="uploads" className="text-2xl font-strong tracking-tight">
          Uploaded ads
        </h2>
        <AutoRefresh active={uploads.some((u) => isActive(u.run))} intervalMs={2000} />
        {uploads.length === 0 ? (
          <p className="text-ink-2">No ads uploaded for {brand.name} yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-field border border-line">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-upload={u.id}>
                <Link href={`/brands/${brand.id}/check/${u.id}`} className="min-w-0 font-semibold text-primary underline underline-offset-4 wrap-anywhere">
                  {u.name}
                </Link>
                <span className="text-sm text-ink-2">
                  {u.width} × {u.height}, uploaded {formatWhen(u.createdAt)}
                </span>
                {isActive(u.run) ? (
                  <Pill tone="active">Checking</Pill>
                ) : u.check && (!u.run || u.run.id === u.check.runId) ? (
                  <OutcomePill outcome={u.check.outcome} />
                ) : (
                  <Pill tone="attention">{u.run ? "The check didn't run" : "Not checked"}</Pill>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function CheckPage(props: PageProps<"/brands/[id]/check">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading Check an ad" />}>
      <CheckContent {...props} />
    </Suspense>
  );
}
