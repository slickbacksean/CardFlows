/**
 * Renders the Terms of Service web page (site/terms/index.html) from TERMS_SECTIONS so the
 * website, the in-app Terms and docs/TERMS_OF_SERVICE.md never drift. Regenerate with
 * `pnpm site:build`; site-terms.test.ts fails if the committed HTML is stale.
 */
import { TERMS_DRAFT_BANNER, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS, TERMS_VERSION } from "./terms";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Shared page shell for site/ pages. */
export function sitePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · PokeSniper</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><a class="brand" href="/">PokeSniper</a><nav><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/support/">Support</a></nav></header>
<main>
${body}
</main>
<footer><p>PokeSniper is not affiliated with Nintendo, The Pokémon Company, Creatures Inc. or Game Freak. · <a href="mailto:support@pokesniper.app">support@pokesniper.app</a></p></footer>
</body>
</html>
`;
}

export function termsHtml(): string {
  const parts = [
    `<!-- GENERATED from packages/shared/src/terms.ts by \`pnpm site:build\`. Do not edit by hand. -->`,
    `<h1>PokeSniper Terms of Service</h1>`,
    `<p class="draft">${escapeHtml(TERMS_DRAFT_BANNER)}.</p>`,
    `<p class="meta">Version ${escapeHtml(TERMS_VERSION)} · Effective ${escapeHtml(TERMS_EFFECTIVE_DATE)}</p>`,
  ];
  for (const section of TERMS_SECTIONS) {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    for (const p of section.paragraphs) parts.push(`<p>${escapeHtml(p)}</p>`);
  }
  return sitePage("Terms of Service", parts.join("\n"));
}
