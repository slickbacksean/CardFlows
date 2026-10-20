// Regenerates site/terms/index.html from packages/shared/src/terms.ts (`pnpm site:build`).
import { writeFileSync } from "node:fs";
import { termsHtml } from "../packages/shared/src/site-terms";
writeFileSync(new URL("../site/terms/index.html", import.meta.url), termsHtml());
