import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { getBrand } from "@/lib/brands/repo";
import { listProducts } from "@/lib/brands/products";
import { getCustomerSummary } from "@/lib/brands/summary";
import { listSegments, searchContext } from "@/lib/context/store";
import { getRun, listRuns } from "@/lib/agents/runs";
import { listMarketNotes, STALE_DAYS } from "@/lib/strategy/market";
import { listCampaigns, OBJECTIVE_MAX, OBJECTIVE_MIN } from "@/lib/brief/repo";
import { ButtonLink, TextLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatPrice, formatWhen } from "@/lib/format";
import { mapBrandFont } from "@/lib/creative/render/fonts";
import { listBrandLanguages } from "@/lib/creative/languages";
import { BrandLogo } from "../brand-logo";
import { ContextSearch, MAX_QUERY } from "./context-search";
import { CustomerSummary } from "./customer-summary";
import { MarketNotes } from "./market-notes";
import { Segments } from "./segments";
import { statusTone } from "../../campaigns/campaign-list";
import { NewCampaignForm } from "../../campaigns/new-campaign-form";
import { campaignStatusLabel } from "@/lib/campaigns/status";
import { parseBrandTab } from "@/lib/brands/tabs";
import { BrandCampaigns, type BrandCampaignRow } from "./brand-campaigns";
import { BrandTabs } from "./brand-tabs";
import { ProductsTable } from "./products-table";

async function BrandPageContent(props: PageProps<"/brands/[id]">) {
  const { id } = await props.params;
  const { q, tab: tabParam } = await props.searchParams;
  // U10-7: the tab a shared link opens; none, or an unknown one, opens Audience.
  const tab = parseBrandTab(tabParam);
  const member = await requireMember();
  const brand = await getBrand(member.userId, id);
  if (!brand) notFound();

  const query = (typeof q === "string" ? q : "").trim().slice(0, MAX_QUERY);
  const [products, summary, hits, segments, runs, campaigns, marketNotes, languages] = await Promise.all([
    listProducts(member.userId, brand.id),
    getCustomerSummary(member.userId, brand.id),
    query ? searchContext(member.userId, { query, brandId: brand.id, limit: 10 }) : Promise.resolve([]),
    listSegments(member.userId, brand.id),
    listRuns(member.userId, 50, brand.id),
    listCampaigns(member.userId, brand.id),
    listMarketNotes(member.userId, brand.id),
    listBrandLanguages(member.userId, brand.id),
  ]);
  const audienceRun = runs.find((r) => r.agent === "audience") ?? null;
  const marketRun = runs.find((r) => r.agent === "market") ?? null;
  // The run list has no error text; read it only when the last refresh failed.
  const marketFailed = !!marketRun && !["queued", "running", "completed"].includes(marketRun.status);
  const marketError = marketFailed ? ((await getRun(member.userId, marketRun.id))?.error ?? null) : null;
  const rows: BrandCampaignRow[] = campaigns.map((c) => {
    const status = campaignStatusLabel(c);
    return { id: c.id, title: c.title, objective: c.objective, status, tone: statusTone(status), updated: formatWhen(c.updatedAt) };
  });

  return (
    <div className="space-y-8">
      <div>
        <TextLink href="/brands">
          <span aria-hidden>← </span>All brands
        </TextLink>
        {/* U10-7: a compact header, so the campaigns below start on a phone's first screen (the description shows from sm up). */}
        <Card className="mt-3">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <BrandLogo name={brand.name} svg={brand.logoSvg} pngSrc={brand.logoPngSrc} className="h-10 w-auto max-w-60 sm:h-14 sm:max-w-72" />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 sm:mt-5">
                <h1 className="min-w-0 text-title font-strong wrap-anywhere">{brand.name}</h1>
                {brand.isSimulated && <Pill tone="review">Simulated data</Pill>}
              </div>
              {brand.category && <p className="mt-1 text-ink-2 wrap-anywhere sm:text-lg">{brand.category}</p>}
              {brand.description && <p className="mt-2 hidden max-w-prose wrap-anywhere sm:mt-4 sm:block">{brand.description}</p>}
            </div>
            <div className="flex flex-wrap gap-3 self-start">
              <ButtonLink href={`/brands/${brand.id}/edit`} size="sm">
                Edit brand kit
              </ButtonLink>
              {/* C8-3: check an ad made outside Studio against this kit. */}
              <ButtonLink href={`/brands/${brand.id}/check`} variant="quiet" size="sm">
                Check an ad
              </ButtonLink>
            </div>
          </div>
        </Card>
      </div>

      <BrandCampaigns brandName={brand.name} rows={rows}>
        <NewCampaignForm brandId={brand.id} limits={{ min: OBJECTIVE_MIN, max: OBJECTIVE_MAX }} idPrefix="brand-campaign" />
      </BrandCampaigns>

      {/* U10-7: the reference data, a tab at a time; the address keeps the tab (?tab=). */}
      <BrandTabs
        selected={tab}
        panels={{
          audience: (
            <div className="space-y-10">
              <Segments brandId={brand.id} segments={segments} latestRun={audienceRun} simulated={brand.isSimulated} />
              <MarketNotes brandId={brand.id} notes={marketNotes} latestRun={marketRun} runError={marketError} staleDays={STALE_DAYS} />
            </div>
          ),
          voice: (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card as="section" aria-labelledby="voice">
                  <h2 id="voice" className="text-2xl font-strong tracking-tight">
                    Voice
                  </h2>
                  <Sub title="Tone words">
                    {brand.toneWords.length ? (
                      <ul className="flex flex-wrap gap-2" aria-label="Tone words">
                        {brand.toneWords.map((w, i) => (
                          <li key={i}>
                            <Pill tone="active" className="whitespace-normal wrap-anywhere">
                              {w}
                            </Pill>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <None />
                    )}
                  </Sub>
                  <Sub title="Voice notes">
                    {brand.voiceNotes ? <p className="whitespace-pre-line wrap-anywhere">{brand.voiceNotes}</p> : <None />}
                  </Sub>
                  <Sub title="Do">
                    <Rules items={brand.doRules} label="Do" />
                  </Sub>
                  <Sub title="Don't">
                    <Rules items={brand.dontRules} label="Don't" />
                  </Sub>
                </Card>

                <Card as="section" aria-labelledby="visual">
                  <h2 id="visual" className="text-2xl font-strong tracking-tight">
                    Visual
                  </h2>
                  <Sub title="Palette">
                    {brand.palette.length ? (
                      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {brand.palette.map((c, i) => (
                          <li key={i} className="min-w-0">
                            {/* The swatch is the brand's own colour, which is data, not a design token. */}
                            <span
                              aria-hidden
                              className="block h-14 rounded-field ring-1 ring-line ring-inset"
                              style={{ backgroundColor: c.hex }}
                            />
                            <span className="mt-1.5 block font-medium wrap-anywhere">{c.name}</span>
                            <span className="block font-mono text-sm text-ink-2 uppercase">{c.hex}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <None />
                    )}
                  </Sub>
                  <Sub title="Fonts">
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <FontSample label="Primary" font={brand.fontPrimary} />
                      <FontSample label="Secondary" font={brand.fontSecondary} />
                    </dl>
                    <p className="mt-2 text-sm text-ink-2">Ads are drawn with bundled open fonts, so each brand font maps to the nearest one.</p>
                  </Sub>
                </Card>
              </div>
              <p>
                <TextLink href={`/brands/${brand.id}/edit`}>Edit the voice and visual kit</TextLink>
              </p>
            </div>
          ),
          legal: (
            <Card as="section" aria-labelledby="legal">
              <h2 id="legal" className="text-2xl font-strong tracking-tight">
                Legal
              </h2>
              <div className="grid gap-x-8 md:grid-cols-3">
                <Sub title="Required legal lines">
                  <Rules items={brand.legalLines} label="Required legal lines" />
                </Sub>
                <Sub title="Banned terms">
                  {brand.bannedTerms.length ? (
                    <ul className="flex flex-wrap gap-2" aria-label="Banned terms">
                      {brand.bannedTerms.map((t, i) => (
                        <li key={i}>
                          <Pill tone="attention" className="whitespace-normal wrap-anywhere">
                            {t}
                          </Pill>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <None />
                  )}
                </Sub>
                <Sub title="Claims that need evidence">
                  <Rules items={brand.evidenceClaims} label="Claims that need evidence" />
                </Sub>
              </div>
              <div className="mt-6 border-t border-line pt-4" data-brand-languages="">
                <h3 className="font-strong">Languages</h3>
                <p className="mt-1 max-w-prose text-ink-2">
                  {languages.length
                    ? `Ads can be translated into ${languages.map((l) => l.name).join(", ").replace(/, ([^,]*)$/, " and $1")}, each with its own legal lines${languages.some((l) => l.writtenForDemo) ? " (written by Claude for the demo)" : ""}.`
                    : "English only. Choose languages, with the legal lines for each, to translate picked ads."}{" "}
                  <TextLink href={`/brands/${brand.id}/languages`}>{languages.length ? "Languages and their legal lines" : "Choose languages"}</TextLink>
                </p>
              </div>
            </Card>
          ),
          products: (
            <div className="space-y-10">
              {/* D-3: a brand with no customers can be given simulated ones from a short profile (no AI, rule 5). */}
              {(!summary || summary.customers === 0) && (
                <Card as="section" tone="primary" aria-labelledby="generate-data" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 id="generate-data" className="text-xl font-strong tracking-tight">
                      No customers yet
                    </h2>
                    <p className="mt-1 max-w-prose text-ink-2">
                      Make simulated customers and orders from a short profile. They are labelled as simulated everywhere, and no AI is used.
                    </p>
                  </div>
                  <ButtonLink href={`/brands/${brand.id}/simulated-data`} data-generate-data="" className="shrink-0 self-start sm:self-center">
                    Generate simulated data
                  </ButtonLink>
                </Card>
              )}
              <section aria-labelledby="products">
                <h2 id="products" className="text-2xl font-strong tracking-tight">
                  Products
                </h2>
                <p className="mt-1 text-ink-2">
                  {products.length === 0
                    ? "No products yet. The demo brands come with a catalogue, and generating simulated data adds the products you list."
                    : `${products.length} ${products.length === 1 ? "product" : "products"}, by category.`}
                </p>
                {products.length > 0 && (
                  <ProductsTable
                    brandName={brand.name}
                    rows={products.map((p) => ({ id: p.id, name: p.name, category: p.category, price: formatPrice(p.pricePence), active: p.active }))}
                  />
                )}
              </section>
              <CustomerSummary summary={summary} simulated={brand.isSimulated} />
            </div>
          ),
        }}
      />

      <ContextSearch brandName={brand.name} query={query} hits={hits} />
    </div>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 min-w-0">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function None() {
  return <p className="text-ink-2">None yet.</p>;
}

function Rules({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return <None />;
  return (
    <ul aria-label={label} className="list-disc space-y-1.5 pl-5 marker:text-ink-2">
      {items.map((r, i) => (
        <li key={i} className="wrap-anywhere">
          {r}
        </li>
      ))}
    </ul>
  );
}

function FontSample({ label, font }: { label: string; font: string }) {
  return (
    <div className="min-w-0 rounded-field bg-bg p-3">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="font-medium wrap-anywhere">{font || "Not set"}</dd>
      {font && (
        // The brand's own font, if the device has it: data, not a design token.
        <dd aria-hidden className="mt-1 truncate text-2xl" style={{ fontFamily: `"${font.replace(/["\\]/g, "")}", sans-serif` }}>
          Aa Bb Cc 123
        </dd>
      )}
      <dd className="mt-1 text-sm text-ink-2" data-font-note="">
        In ads: {mapBrandFont(font).note}.
      </dd>
    </div>
  );
}

export default function BrandPage(props: PageProps<"/brands/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the brand" />}>
      <BrandPageContent {...props} />
    </Suspense>
  );
}
