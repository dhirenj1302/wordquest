# WordQuest V3 — Cloudflare Pages + D1

## Create D1
`npx wrangler d1 create wordquest`
Copy the returned database_id into wrangler.toml.

## Apply migrations remotely
`npx wrangler d1 execute wordquest --file=migrations/0001_schema.sql --remote`
`npx wrangler d1 execute wordquest --file=migrations/0002_seed_1400_words.sql --remote`

## Verify
`npx wrangler d1 execute wordquest --remote --command="SELECT year_group, COUNT(*) n, MIN(gem_score) min_gem, MAX(gem_score) max_gem FROM word_levels GROUP BY year_group ORDER BY year_group;"`

## Deploy
Connect the repo to Cloudflare Pages. Add a D1 binding named `DB` pointing to `wordquest` in Pages > Settings > Bindings.
