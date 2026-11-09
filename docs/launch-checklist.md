# Product Hunt launch checklist

Tracks everything the site and repo need before the Product Hunt launch. Tick items as they land.

## P0: before launch day

- [x] Title and meta description: "mto: shrink MCP tool responses for AI agents and cut token cost"
- [x] Open Graph and Twitter card tags on the landing page and docs (absolute URLs)
- [x] OG image, 1200×630 (`site/public/og.png`)
- [x] `<link rel="canonical">` on both pages
- [x] JSON-LD `SoftwareApplication` structured data
- [x] `robots.txt` and `sitemap.xml`
- [x] `llms.txt` and `llms-full.txt`, generated from the README at build time
- [x] Prerendered HTML so crawlers, LLMs and link unfurlers see real content
- [x] Release date and test count derived at build time instead of hardcoded
- [x] GitHub social preview image, 1280×640 (`docs/social-preview.png`; regenerate with `npm run social --prefix site`)
- [ ] Upload `docs/social-preview.png` in repo Settings → Social preview *(manual)*
- [ ] GitHub repo description matches the site copy *(manual)*
- [ ] Decide on a custom domain before sharing links *(decision)*

## Site: social proof and CTAs

- [x] Live npm downloads (public `api.npmjs.org` GET, fetched in the browser)
- [x] Live GitHub stars (public `api.github.com` GET), count hidden until it is worth showing
- [x] One-line nav: `mto` brand that expands to the full name on hover, Star button with count
- [x] Hero CTAs: "Install with AI" + "See the benchmarks" (the star CTA lives in the nav and the closing section only); npm downloads as the lead stat (total + this week, counting up from 0), stars once past the threshold; no repeat of version/license from the pill
- [x] Maker card: GitHub and LinkedIn as a matched pair of outline buttons
- [x] Product Hunt slots wired to one config (`PRODUCT_HUNT` in `site/src/data.ts`): launch-day pill, hero, closing section and footer, as a custom button in the site's style (logo + upvote chip) instead of the stock badge image
- [x] Final CTA section before the footer
- [x] Launch-day strip above the nav (Product Hunt logo, one line, Upvote button)
- [x] "Install with AI" copies a short 7-step prompt (no embedded docs); file download only if the clipboard is blocked
- [x] Hover language: accent underline on text links, accent edge on outline buttons and cards, hover-capable devices only
- [x] Mobile: no horizontal overflow (closing section grid fixed)
- [x] Maker card facts: live downloads and stars
- [x] Review switch: open the site with `?review` to flip Product Hunt (off / badges / launch day) and star counts
- [x] Footer: year and author, Product Hunt badge

## P1

- [x] Web manifest and PNG app icons (`icon-180.png` as apple-touch-icon, `icon-512.png`)
- [x] Styled `404.html`
- [x] Docs page assembled from README + `docs/*.md` + `TROUBLESHOOTING.md` + `SECURITY.md`, cross-links become in-page anchors
- [ ] Demo GIF or short video (before/after token count)
- [ ] Dashboard screenshots on the site (`docs/screenshots/`)
- [ ] FAQ section (free? data leaves my machine? quality? agents? uninstall?)
- [ ] Cookieless analytics for the site only (GoatCounter or Plausible), disclosed
- [x] README: emoji removed from the front page; npm version, downloads and stars badges
- [ ] README: Product Hunt badge (after the post exists)
- [ ] Lighthouse pass (performance, accessibility, SEO) and mobile check

## Product Hunt submission *(manual)*

- [ ] Create the upcoming page; put the post slug in `PRODUCT_HUNT.slug` (`site/src/data.ts`)
- [ ] Once live, decide: keep the custom Product Hunt buttons, or swap in the official embed (live upvote count) in `ProductHuntBadge`
- [ ] Tagline (≤60 chars) and description (≤260 chars)
- [ ] Thumbnail 240×240 (GIF allowed)
- [ ] 3–5 gallery images, 1270×760
- [ ] Maker's first comment: the story, benchmark numbers, what feedback you want
- [ ] UTM tags on every link from the post (`?ref=producthunt`)
- [ ] Launch day: set `PRODUCT_HUNT.live = true`, redeploy; afterwards set it back
