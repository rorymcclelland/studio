import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getBrand } from "@/lib/brands/repo";
import { TextLink } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { BrandEditor } from "./brand-editor";
import { LogoUpload } from "./logo-upload";

export const metadata = { title: "Edit brand kit" };

async function EditBrandContent(props: PageProps<"/brands/[id]/edit">) {
  const { id } = await props.params;
  const member = await requireMember();
  const brand = await getBrand(member.userId, id);
  if (!brand) notFound();

  return (
    <div className="space-y-8">
      <div>
        <TextLink href={`/brands/${brand.id}`}>
          <span aria-hidden>← </span>Back to {brand.name}
        </TextLink>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-title font-strong wrap-anywhere">Edit brand kit</h1>
          {brand.isSimulated && <Pill tone="review">Demo brand</Pill>}
        </div>
        <p className="mt-2 max-w-prose text-lg text-ink-2 wrap-anywhere">
          {brand.name}. Agents read this kit before they write or design anything, so changes apply to their next run.
        </p>
      </div>
      <LogoUpload brandId={brand.id} brandName={brand.name} initial={{ svg: brand.logoSvg, pngSrc: brand.logoPngSrc }} />
      <BrandEditor
        brandId={brand.id}
        initial={{
          name: brand.name,
          slug: brand.slug,
          description: brand.description,
          category: brand.category,
          toneWords: brand.toneWords,
          voiceNotes: brand.voiceNotes,
          doRules: brand.doRules,
          dontRules: brand.dontRules,
          palette: brand.palette,
          fontPrimary: brand.fontPrimary,
          fontSecondary: brand.fontSecondary,
          legalLines: brand.legalLines,
          bannedTerms: brand.bannedTerms,
          evidenceClaims: brand.evidenceClaims,
        }}
      />
    </div>
  );
}

export default function EditBrandPage(props: PageProps<"/brands/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the brand kit" />}>
      <EditBrandContent {...props} />
    </Suspense>
  );
}
