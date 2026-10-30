# Hylink uptime

Checks [hylink.org](https://hylink.org) and [api.hylink.org](https://api.hylink.org)
from outside every five minutes (GitHub's schedule can run late). If either fails three
times in a row, 20 seconds apart, it posts to the team's Discord and tags `@everyone`;
while it stays down, it reminds at most hourly, and it posts once (untagged) when the
site answers again.

It runs here rather than on the server so that it still works when the whole server
is down. The checks on the server itself live in the private deployment repository.

- `check.py`: the check (Python standard library only).
- `.github/workflows/uptime.yml`: the schedule. The Discord webhook is the
  `DISCORD_WEBHOOK_URL` repository secret. The last state (up, or down since when) is
  kept in the Actions cache between runs.
