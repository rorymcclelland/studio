import { z } from "zod";
import { asUser, type Tx } from "@/lib/db/scoped";
import { normaliseKitText } from "@/lib/context/keys";

// C7-2: the languages a brand's ads are translated into (Q3: each brand picks
// from the supported list; French, German and Spanish to start), and, per
// language, the legal lines and banned terms a person wrote for it (Q4: legal
// lines are regulated text and are never machine-translated). A language
// without legal lines is refused for the brand's ads while its English kit has
// some, so no translated ad goes out without them.

/** The kit's own language: every copy set before C7-2, and every English one since. */
export const ENGLISH = "en-GB";

/** Languages the Localise agent writes, in the order they are offered. Latin script only (Satori can't shape complex scripts). */
export const SUPPORTED_LANGS = ["fr-FR", "de-DE", "es-ES"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const LANG_NAMES: Record<Lang | typeof ENGLISH, string> = {
  "en-GB": "English",
  "fr-FR": "French",
  "de-DE": "German",
  "es-ES": "Spanish",
};

/** What a language is called in itself, for the model and for people who read it. */
export const LANG_ENDONYMS: Record<Lang, string> = { "fr-FR": "français", "de-DE": "Deutsch", "es-ES": "español" };

export function isLang(x: unknown): x is Lang {
  return typeof x === "string" && (SUPPORTED_LANGS as readonly string[]).includes(x);
}

/** "French, German and Spanish". */
export function langList(langs: readonly string[]): string {
  const names = langs.map((l) => LANG_NAMES[l as Lang] ?? l);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Rule 1: what every translated ad says about itself, in the gallery, the Sizes view and the launch pack. */
export const MACHINE_TRANSLATION = {
  label: "Machine translation",
  detail:
    "Translated by the Localise agent (an AI model), not by a person. The legal lines are not machine-translated: they are the brand's own for this language. The checks for testimonials and for quantities in words were written for English and catch less in other languages, so read it before it runs.",
  simulatedLabel: "Machine translation (simulated)",
  simulatedDetail: "Fixed words from the mock model, not a real translation: it shows how a translated ad looks and checks, and costs nothing.",
} as const;

export const WRITTEN_FOR_DEMO = "Written by Claude for the demo, not by the brand. A real brand's legal team writes these.";

const line = (max: number, label: string) => z.string().trim().min(1, `${label} can't be empty.`).max(max, `${label} must be ${max} characters or fewer.`);

/** One language's entry in a kit, as a person saves it. */
export const languageInput = z.object({
  lang: z.enum(SUPPORTED_LANGS),
  legalLines: z
    .array(line(500, "A legal line"))
    .max(20, "No more than 20 legal lines.")
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, i) => {
        const k = normaliseKitText(item);
        if (seen.has(k)) ctx.addIssue({ code: "custom", path: [i], message: "This legal line is already in the list." });
        seen.add(k);
      });
    }),
  bannedTerms: z.array(line(80, "A banned term")).max(50, "No more than 50 banned terms."),
});
export type LanguageInput = z.infer<typeof languageInput>;

export type BrandLanguage = {
  lang: Lang;
  name: string;
  legalLines: string[];
  bannedTerms: string[];
  writtenForDemo: boolean;
  updatedAt: Date;
};

/** A brand's chosen languages with their kit, in the supported order (rows for languages no longer supported are ignored). */
export async function brandLanguagesIn(tx: Tx, brandId: string): Promise<BrandLanguage[]> {
  const rows = await tx`select lang, legal_lines, banned_terms, written_for_demo, updated_at from public.brand_languages where brand_id = ${brandId}`;
  return SUPPORTED_LANGS.flatMap((lang) => {
    const r = rows.find((x) => x.lang === lang);
    return r
      ? [{ lang, name: LANG_NAMES[lang], legalLines: r.legal_lines as string[], bannedTerms: r.banned_terms as string[], writtenForDemo: r.written_for_demo === true, updatedAt: r.updated_at as Date }]
      : [];
  });
}

export async function listBrandLanguages(userId: string, brandId: string): Promise<BrandLanguage[]> {
  if (!UUID.test(brandId)) return [];
  return asUser(userId, (tx) => brandLanguagesIn(tx, brandId));
}

/**
 * Why a brand's ads can't be translated into a language, or null. Test case 5:
 * no legal lines for the language while the English kit has some.
 */
export function languageRefusal(englishLegal: string[], language: BrandLanguage | undefined, lang: Lang): string | null {
  const name = LANG_NAMES[lang];
  if (!language) return `${name} isn't one of the brand's languages. Add it on the brand's Languages page.`;
  if (englishLegal.length > 0 && language.legalLines.length === 0) {
    return `The brand has no ${name} legal lines, so its ads can't go out in ${name}. A person writes them on the brand's Languages page; they are never machine-translated.`;
  }
  return null;
}

export class LanguageError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Member = { userId: string; workspaceId: string };

/**
 * Saves a brand's languages: the ones given are kept with their lines (a
 * person's edit clears "written for the demo" where the lines changed), the
 * rest are removed. Nothing is saved unless every language is valid.
 */
export async function saveBrandLanguages(member: Member, brandId: string, raw: unknown): Promise<BrandLanguage[]> {
  if (!UUID.test(brandId)) throw new LanguageError("That brand isn't in your workspace.");
  const parsed = z.array(languageInput).max(SUPPORTED_LANGS.length).safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
    throw new LanguageError(Object.values(fieldErrors)[0] ?? "Check the highlighted fields.", fieldErrors);
  }
  const langs = parsed.data;
  if (new Set(langs.map((l) => l.lang)).size !== langs.length) throw new LanguageError("Each language may be listed once.");
  return asUser(member.userId, async (tx) => {
    const [b] = await tx`select id from public.brands where id = ${brandId} for update`;
    if (!b) throw new LanguageError("That brand isn't in your workspace.");
    const before = await brandLanguagesIn(tx, brandId);
    await tx`delete from public.brand_languages where brand_id = ${brandId} and not (lang = any(${langs.map((l) => l.lang)}::text[]))`;
    for (const l of langs) {
      const old = before.find((x) => x.lang === l.lang);
      const same = old && JSON.stringify(old.legalLines) === JSON.stringify(l.legalLines) && JSON.stringify(old.bannedTerms) === JSON.stringify(l.bannedTerms);
      await tx`
        insert into public.brand_languages (workspace_id, brand_id, lang, legal_lines, banned_terms, written_for_demo, created_by)
        values (${member.workspaceId}, ${brandId}, ${l.lang}, ${l.legalLines}, ${l.bannedTerms}, false, ${member.userId})
        on conflict (brand_id, lang) do update set legal_lines = excluded.legal_lines, banned_terms = excluded.banned_terms,
          written_for_demo = ${same ? old!.writtenForDemo : false}`;
    }
    return brandLanguagesIn(tx, brandId);
  });
}

// The demo brands' languages (Q4): written by Claude once, for the demo, and marked so.
// Each list follows the brand's English legal lines and banned terms, in the same order.

type DemoLanguages = Record<Lang, { legalLines: string[]; bannedTerms: string[] }>;

export const DEMO_LANGUAGES: Record<"quillmoor" | "fernhollow", DemoLanguages> = {
  quillmoor: {
    "fr-FR": {
      legalLines: [
        "Taux d'épargne variables, susceptibles de changer.",
        "Frais sur les formules Plus et Premium : voir les prix dans l'appli.",
        "Quillmoor Money est une société fictive créée pour la démo.",
      ],
      bannedTerms: ["rendement garanti", "sans risque", "argent gratuit", "devenir riche", "meilleurs taux du marché", "jamais de frais"],
    },
    "de-DE": {
      legalLines: [
        "Sparzinsen sind variabel und können sich ändern.",
        "Gebühren für Plus und Premium: siehe Preisliste in der App.",
        "Quillmoor Money ist ein fiktives Unternehmen für die Demo.",
      ],
      bannedTerms: ["garantierte Rendite", "risikofrei", "geschenktes Geld", "reich werden", "beste Zinsen am Markt", "nie Gebühren"],
    },
    "es-ES": {
      legalLines: [
        "Los tipos de ahorro son variables y pueden cambiar.",
        "Planes Plus y Premium con comisiones: ver precios en la app.",
        "Quillmoor Money es una empresa ficticia creada para la demo.",
      ],
      bannedTerms: ["rentabilidad garantizada", "sin riesgo", "dinero gratis", "hacerse rico", "los mejores tipos del mercado", "nunca pagarás comisiones"],
    },
  },
  fernhollow: {
    "fr-FR": {
      legalLines: ["Prix TVA incluse.", "Retours gratuits sous 30 jours pour les articles non portés."],
      bannedTerms: ["indestructible", "imperméable pour toujours", "sécurité garantie", "une vie d'aventure"],
    },
    "de-DE": {
      legalLines: ["Preise inklusive Mehrwertsteuer.", "Kostenlose Rücksendung innerhalb von 30 Tagen für ungetragene Artikel."],
      bannedTerms: ["unzerstörbar", "für immer wasserdicht", "garantiert sicher", "ein Leben voller Abenteuer"],
    },
    "es-ES": {
      legalLines: ["Precios con IVA incluido.", "Devoluciones gratuitas en 30 días para artículos sin usar."],
      bannedTerms: ["indestructible", "impermeable para siempre", "seguridad garantizada", "una vida de aventura"],
    },
  },
};

export function isDemoSlug(slug: string): slug is keyof typeof DEMO_LANGUAGES {
  return Object.hasOwn(DEMO_LANGUAGES, slug);
}

/** Adds a demo brand's three languages, marked as written for the demo, in a transaction the caller holds. Languages already there are left as they are. */
export async function insertDemoLanguages(tx: Tx, member: Member, brandId: string, slug: string): Promise<number> {
  if (!isDemoSlug(slug)) return 0;
  let added = 0;
  for (const lang of SUPPORTED_LANGS) {
    const l = DEMO_LANGUAGES[slug][lang];
    const rows = await tx`
      insert into public.brand_languages (workspace_id, brand_id, lang, legal_lines, banned_terms, written_for_demo, created_by)
      values (${member.workspaceId}, ${brandId}, ${lang}, ${l.legalLines}, ${l.bannedTerms}, true, ${member.userId})
      on conflict (brand_id, lang) do nothing
      returning id`;
    added += rows.length;
  }
  return added;
}

/**
 * For a demo brand loaded before C7-2: adds its demo languages (one click on
 * the Languages page). Refused for a brand that isn't one of the simulated
 * demo brands.
 */
export async function addDemoLanguages(member: Member, brandId: string): Promise<number> {
  if (!UUID.test(brandId)) throw new LanguageError("That brand isn't in your workspace.");
  return asUser(member.userId, async (tx) => {
    const [b] = await tx`select slug, is_fictional from public.brands where id = ${brandId}`;
    if (!b) throw new LanguageError("That brand isn't in your workspace.");
    if (!b.is_fictional || !isDemoSlug(b.slug as string)) throw new LanguageError("Only the demo brands come with languages written for the demo.");
    return insertDemoLanguages(tx, member, brandId, b.slug as string);
  });
}
