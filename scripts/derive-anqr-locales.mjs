// Derive ANQR's locale registry from the USF semantic graph.
//
// The graph declares the complete language denominator: which locales the
// product claims, and which of them are written right to left. This script
// projects that into the form the product repository consumes, so ANQR can
// prepare and check every locale without importing USF or depending on this
// checkout at run time. The projection is never the truth: a drift check
// compares a fresh derivation against the committed output, and the graph wins.
//
//   node scripts/derive-anqr-locales.mjs [output-path]
//
// With no argument it writes the derivation to stdout, which is what the drift
// check uses so it never has to touch the product tree.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSemanticGraph, objectValues } from "../src/graph/index.ts";

const P = "urn:usf:predicate:";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const g = loadSemanticGraph(repositoryRoot, "graph/products/anqr/semantic-build-manifest.json");
const vals = (s, p) => objectValues(g, s, P + p);
const one = (s, p) => { const v = vals(s, p); return v.length ? v[0] : null; };
const typed = (t) => [...new Set(g.quads.filter(q => q.predicate === P + "type" && q.object === t).map(q => q.subject))].sort();

const model = typed("urn:usf:type:AnqrLocalisationModel")[0] ?? "urn:anqr:localisation-model:1";
const referenceIri = one(model, "referenceLocale");
if (referenceIri === null) throw new Error("ANQR_LOCALE_REFERENCE_MISSING");

// Only locales the model actually claims. A SupportedLocale that nothing claims
// is not part of the denominator, and silently including it would overstate it.
const claimed = new Set(vals(model, "claimsLocale"));
const locales = typed("urn:usf:type:SupportedLocale")
  .filter((iri) => claimed.has(iri))
  .map((iri) => {
    const code = one(iri, "localeCode");
    const direction = one(iri, "writingDirection");
    if (code === null || direction === null) throw new Error(`ANQR_LOCALE_INCOMPLETE:${iri}`);
    return { code, direction: direction.split(":").pop(), reference: iri === referenceIri };
  })
  .sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

if (locales.length !== claimed.size) throw new Error("ANQR_LOCALE_CLAIM_UNRESOLVED");
if (locales.filter((locale) => locale.reference).length !== 1) throw new Error("ANQR_LOCALE_REFERENCE_AMBIGUOUS");

const obligations = typed("urn:usf:type:LocaleParityObligation").map((iri) => ({
  name: one(iri, "canonicalName"),
  scope: one(iri, "parityObligationScope"),
  referenceCode: one(one(iri, "referenceLocale") ?? referenceIri, "localeCode"),
  requirement: one(iri, "realisationRequirement"),
})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const derivation = {
  schema: "urn:anqr:locale-registry:1",
  referenceCode: one(referenceIri, "localeCode"),
  localeCount: locales.length,
  rightToLeftCount: locales.filter((locale) => locale.direction === "rtl").length,
  locales,
  parityObligations: obligations,
  nonClaims: [
    "This registry is the claimed language denominator, not evidence that any locale is translated.",
    "Parity is decided by key set against the reference locale. A resource of the right size proves nothing about coverage.",
    "A prepared locale carrying no translated value is honestly untranslated; it is never reported as satisfied.",
  ],
};

const output = `${JSON.stringify(derivation, null, 2)}\n`;
const target = process.argv[2];
if (target === undefined) process.stdout.write(output);
else writeFileSync(target, output);
