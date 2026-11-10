import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getBrand } from "@/lib/brands/repo";
import { isDemoSlug, LANG_NAMES, listBrandLanguages, SUPPORTED_LANGS, WRITTEN_FOR_DEMO } from "@/lib/creative/languages";
import { TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AddDemoLanguages, LanguagesEditor } from "./languages-editor";

// C7-2: a brand's languages (Q3: picked from the supported list) and, for
// each, the legal lines and banned terms a person writes (Q4: legal lines are
// never machine-translated). The demo brands' were written by Claude for the
// demo, and say so until a person edits them.

export const metadata = { title: "Languages" };

async function LanguagesContent(props: PageProps<"/brands/[id]/languages">) {
  const { id } = await props.params;
  const member = await requireMember();
  const brand = await getBrand(member.userId, id);
  if (!brand) notFound();
  const languages = await listBrandLanguages(member.userId, brand.id);
  const demoMissing = brand.isFictional && isDemoSlug(brand.slug) && languages.length < SUPPORTED_LANGS.length;

  return (
    <div className="space-y-8">
      <div>
        <TextLink href={`/brands/${brand.id}`}>
          <span aria-hidden>← </span>Back to {brand.name}
        </TextLink>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="min-w-0 text-title font-strong wrap-anywhere">Languages</h1>
          {brand.isFictional && <Pill tone="review">Demo brand</Pill>}
        </div>
        <p className="mt-2 max-w-prose text-lg text-ink-2 wrap-anywhere">
          {brand.name}. The Localise agent translates picked ads into these languages. Each language needs its own legal lines,
          written by a person: they are regulated text, so they are never machine-translated, and a language without them
          can&apos;t be used while the English kit has some.
        </p>
      </div>
      {demoMissing && (
        <Card className="space-y-3" data-demo-languages="">
          <p className="max-w-prose">
            This demo brand was added before languages existed. Add its {SUPPORTED_LANGS.map((l) => LANG_NAMES[l]).join(", ").replace(/, ([^,]*)$/, " and $1")}{" "}
            legal lines and banned terms, written by Claude for the demo and marked so.
          </p>
          <AddDemoLanguages brandId={brand.id} />
        </Card>
      )}
      <LanguagesEditor
        brandId={brand.id}
        englishLegal={brand.legalLines}
        englishBanned={brand.bannedTerms}
        writtenForDemoNote={WRITTEN_FOR_DEMO}
        languages={SUPPORTED_LANGS.map((lang) => {
          const l = languages.find((x) => x.lang === lang);
          return { lang, name: LANG_NAMES[lang], chosen: !!l, legalLines: l?.legalLines ?? [], bannedTerms: l?.bannedTerms ?? [], writtenForDemo: l?.writtenForDemo ?? false };
        })}
      />
    </div>
  );
}

export default function LanguagesPage(props: PageProps<"/brands/[id]/languages">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the languages" />}>
      <LanguagesContent {...props} />
    </Suspense>
  );
}
