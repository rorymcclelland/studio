// C7-2 review fix 1 (rule 1): a translation never speaks as a customer. The
// first-person check per language catches elided French forms ("J'ai",
// "J’adore", "m’a"), with straight and curly apostrophes and no quotation
// marks, keeps Unicode word edges (so "même" isn't "me"), and covers the
// Spanish possessives (mío, mía) and German forms the same way.
import { describe, expect, it } from "vitest";
import { translationProblems, type TranslationRules } from "@/lib/creative/copy-rules";

const rules = (lang: string, langName: string): TranslationRules => ({
  lang,
  langName,
  brandName: "Quillmoor Money",
  products: [],
  places: [],
  bannedTerms: [],
  evidenceClaims: [],
  realNames: [],
  legalLines: [],
  pool: [{ value: "200", unit: "€", text: "200 €" } as never],
});

const problemsFor = (lang: string, name: string, body: string) =>
  translationProblems("paid social", { headline: "Votre épargne", body, cta: "Voir" }, rules(lang, name), { where: "the set" });

const voice = /customer's own words/;

describe("first person in a translation", () => {
  it("French: elided j' and m' with straight and curly apostrophes are refused", () => {
    for (const body of [
      "J’ai économisé 200 € grâce à Quillmoor.",
      "J'ai économisé 200 € grâce à Quillmoor.",
      "J'adore cette appli.",
      "J’adore cette appli.",
      "Ça m’a aidé à épargner.",
      "Ça m'a aidé à épargner.",
      "Je mets de côté chaque semaine.",
      "Mon épargne, enfin claire.",
    ]) {
      expect(problemsFor("fr-FR", "French", body).join(" "), body).toMatch(voice);
    }
  });

  it("French: words that only contain the letters are not first person", () => {
    for (const body of [
      "Tout est au même endroit, prêt quand vous l'êtes.",
      "Un thème clair pour votre épargne.",
      "Aujourd'hui, voyez où va votre argent.",
      "Majorez votre épargne, jamais vos frais.",
      "L'appli qu'il vous faut.",
    ]) {
      expect(problemsFor("fr-FR", "French", body).join(" "), body).not.toMatch(voice);
    }
  });

  it("Spanish: mí, mi, me, conmigo and the possessives mío, mía, míos, mías", () => {
    for (const body of ["Para mí, es la mejor.", "Mi dinero crece.", "Me encanta ahorrar.", "Esta cuenta es mía.", "Los ahorros son míos.", "El mío crece."]) {
      expect(problemsFor("es-ES", "Spanish", body).join(" "), body).toMatch(voice);
    }
    for (const body of ["Mira cómo crecen tus ahorros.", "Mismo precio, más claro.", "Tu dinero, mejor organizado."]) {
      expect(problemsFor("es-ES", "Spanish", body).join(" "), body).not.toMatch(voice);
    }
  });

  it("German: ich, mich, mir and the forms of mein, including meins", () => {
    for (const body of ["Ich spare jede Woche.", "Das hat mir geholfen.", "Mein Geld wächst.", "Das Konto ist meins."]) {
      expect(problemsFor("de-DE", "German", body).join(" "), body).toMatch(voice);
    }
    for (const body of ["Sieh, wohin dein Geld geht.", "Meinung zählt.", "Spare ohne Mühe."]) {
      expect(problemsFor("de-DE", "German", body).join(" "), body).not.toMatch(voice);
    }
  });
});
