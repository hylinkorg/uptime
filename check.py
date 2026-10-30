"""Is hylink.org up? One check from outside, with a message to Discord on changes."""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

SITES = ("https://hylink.org/", "https://api.hylink.org/")
TRIES = 3  # a site is down only if it fails three times, 20 seconds apart
REMIND_SECONDS = 3600  # while down, at most one reminder an hour
STATE = Path("state.json")


def status(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": "Hylink-Uptime/1.0 (+https://github.com/hylinkorg/uptime)"}
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (OSError, ValueError):
        return None  # no answer at all


def down(url):
    """None when the site answers 200, else what it answered last."""
    for attempt in range(TRIES):
        code = status(url)
        if code == 200:
            return None
        if attempt < TRIES - 1:
            time.sleep(20)
    return "no answer" if code is None else f"HTTP {code}"


def send(message):
    url = os.environ.get("DISCORD_WEBHOOK_URL", "")
    if not url.startswith("https://discord.com/api/webhooks/"):
        raise SystemExit("DISCORD_WEBHOOK_URL is missing")
    body = {
        "content": message,
        "allowed_mentions": {"parse": ["everyone"] if message.startswith("@everyone") else []},
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "Hylink-Uptime/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10):
        pass


def main():
    now = time.time()
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    problems = {url: reason for url in SITES if (reason := down(url))}
    if problems:
        what = "; ".join(f"{url} ({reason})" for url, reason in problems.items())
        if not state.get("down_since"):
            state = {"down_since": now}
            send(f"@everyone Hylink is down, seen from outside: {what}. "
                 "If both fail, the whole server may be unreachable.")
            state["reminded"] = now
        elif now - state.get("reminded", 0) >= REMIND_SECONDS:
            minutes = round((now - state["down_since"]) / 60)
            send(f"@everyone Hylink is still down after {minutes} minutes: {what}.")
            state["reminded"] = now
    elif state.get("down_since"):
        minutes = round((now - state["down_since"]) / 60)
        send(f"Hylink is answering again from outside, after about {minutes} minutes down.")
        state = {}
    STATE.write_text(json.dumps(state))
    print(json.dumps({"down": problems, "state": state}))


if __name__ == "__main__":
    main()
