# pokesniper.app static site

Plain HTML + CSS. No build step: the folder `site/` is the whole website.

- `site/terms/index.html` is generated from `packages/shared/src/terms.ts`. After editing the Terms run
  `pnpm terms:doc && pnpm site:build` and commit; `site-terms.test.ts` fails if it's stale.
- Every other page is hand-written HTML. The privacy page is a **draft — not legal advice; review before launch**.

Pages: `/`, `/privacy/`, `/terms/`, `/support/`, `/delete-account/` (Google Play web deletion URL), `404.html`.

## Option 1 (recommended): Cloudflare Pages

1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Connect to Git** → `slickbacksean/CardFlows`.
2. Production branch `main`. Framework preset **None**. Build command: *(leave empty)*. Build output directory: **`site`**.
3. Deploy, then Custom domains → add **`pokesniper.app`** and **`www.pokesniper.app`**.
4. Porkbun DNS (domain stays registered at Porkbun):
   - **Easiest:** in Porkbun → Domain → Authoritative Nameservers, replace Porkbun's with the two Cloudflare nameservers Cloudflare shows when you add the site (Add a site → Free plan). Cloudflare then creates the records itself.
   - **Keep Porkbun DNS instead:** delete the parking `ALIAS`/`A` record on `@` and the `CNAME` on `www` (and `*` if present), then add
     - `ALIAS` · host *(blank)* · `<project>.pages.dev`
     - `CNAME` · host `www` · `<project>.pages.dev`
     (Cloudflare only allows an apex custom domain on Pages when the zone is on Cloudflare, so the nameserver route is the reliable one.)
5. Redirect `www` → apex with a Cloudflare Redirect Rule (optional). HTTPS is automatic (`.app` requires HTTPS).

## Option 2: GitHub Pages

GitHub Pages can only publish from `/` or `/docs`, so use a GitHub Actions workflow that uploads `site/`
(`actions/upload-pages-artifact` with `path: site` + `actions/deploy-pages`). Settings → Pages → Source: **GitHub Actions**,
Custom domain `pokesniper.app`, then tick **Enforce HTTPS**. Note: the repo must be public, or on a paid GitHub plan.

Porkbun DNS: delete the parking `ALIAS`/`A`/`CNAME` records on `@`, `www` and `*`, then add
- `A` · host *(blank)* · `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (four records)
- `AAAA` · host *(blank)* · `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
- `CNAME` · host `www` · `slickbacksean.github.io`

## Option 3: Netlify

New site → Import from Git → this repo. Base directory empty, build command empty, publish directory **`site`**.
Domain settings → add `pokesniper.app` (and `www`).

Porkbun DNS: delete the parking records on `@`, `www` and `*`, then add
- `ALIAS` · host *(blank)* · `apex-loadbalancer.netlify.com`
- `CNAME` · host `www` · `<site-name>.netlify.app`

## After deploy

Check https://pokesniper.app/privacy, /terms, /support and /delete-account load over HTTPS. Use
`https://pokesniper.app/delete-account` as the Google Play account-deletion URL and
`https://pokesniper.app/support` as the App Store support URL.
