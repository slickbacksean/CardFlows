// Regenerates docs/TERMS_OF_SERVICE.md from packages/shared/src/terms.ts (`pnpm terms:doc`).
import { writeFileSync } from "node:fs";
import { termsMarkdown } from "../packages/shared/src/terms";
writeFileSync(new URL("../docs/TERMS_OF_SERVICE.md", import.meta.url), termsMarkdown());
