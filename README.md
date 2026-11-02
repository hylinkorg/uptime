# Hylink uptime

Checks [hylink.org](https://hylink.org) and [api.hylink.org](https://api.hylink.org)
from outside, every minute, from a Cloudflare Worker. It runs there rather than on the
server so that it still works when the whole server is down. The checks on the server
itself live in the private deployment repository.

What it does:

- A site fails a run when it fails three times, 15 seconds apart (no answer within
  8 seconds, or anything but HTTP 200).
- It tags `@everyone` in the team's Discord only when a site fails **two runs in a row**
  (about a minute), so a short network blip never pages.
- While a site stays down it reminds at most once an hour, and it posts once, untagged,
  when everything answers again.

Files:

- `worker/src/index.js`: the Worker. `worker/test/`: its tests (`npm test` in `worker/`,
  Node 24, no packages needed; CI runs them).
- `worker/wrangler.toml`: its schedule (`* * * * *`) and the KV namespace that keeps the
  state (up, or failing/down since when). The state is written only when it changes.
- The Discord webhook is the Worker secret `DISCORD_WEBHOOK_URL`.
- `check.py` and `.github/workflows/uptime.yml`: the earlier check on GitHub's schedule,
  kept for a run by hand only (GitHub ran the five-minute schedule every few hours at
  times, and may drop queued runs).

Known gap: a Cloudflare outage that stops both the sites and Workers would not page.

## Setting it up (once)

From `worker/`, with [wrangler](https://developers.cloudflare.com/workers/wrangler/):

```sh
npx wrangler login                                  # opens the browser; the account that holds hylink.org
npx wrangler kv namespace create hylink-uptime      # prints an id: put it in wrangler.toml
npx wrangler deploy
npx wrangler secret put DISCORD_WEBHOOK_URL         # paste the webhook; it is not shown
npx wrangler tail                                   # optional: watch a run's line each minute
```

Each run logs one line: what was down, the state, and whether it sent a message. It fits
the free plan (one of 5 cron triggers, a few ms of CPU per run, 1,440 runs a day, KV
written only on changes).
