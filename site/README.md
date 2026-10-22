# mcp-token-optimizer website

The landing page and docs for [mcp-token-optimizer](../README.md), built with Vite + React and deployed to GitHub Pages by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on every push to `main` that touches `site/` or the root `README.md`.

- `index.html` → the landing page (`src/App.tsx`)
- `docs/index.html` → the docs page (`src/Docs.tsx`), rendered from the repository's `README.md` at build time

```bash
cd site
npm install
npm run dev        # http://localhost:5173/mcp-token-optimizer/
npm run build      # static output in site/dist
```

The build assumes the project-site path `/mcp-token-optimizer/`. For a custom domain, build with `BASE_PATH=/`.

Content lives in code: install commands and links in `src/data.ts`, benchmark numbers in `src/data.ts` (from `npm run smoke`), terminal output in `src/Sections.tsx`, the agent replay in `src/AgentMock.tsx`. External links open in a new tab automatically (`src/externalLinks.ts`).
