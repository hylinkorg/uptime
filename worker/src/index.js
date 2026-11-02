// Is hylink.org up? Checked from Cloudflare every minute, with a message to Discord on
// changes. It runs outside the server, so it still works when the whole server is down.

export const SITES = ["https://hylink.org/", "https://api.hylink.org/"];
// A site fails a run only if it fails three times, 15 seconds apart (a run stays under a
// minute). The page waits for a second failing run in a row: the host's network drops
// for up to about 90 seconds at times, and that must not page.
const TRIES = 3;
const PAUSE_MS = 15_000;
const TIMEOUT_MS = 8_000;
const CONFIRM_SECONDS = 50; // the next minute's run
const FORGET_SECONDS = 300; // an older lone failure no longer counts
const REMIND_SECONDS = 3600; // while down, at most one reminder an hour
const USER_AGENT = "Hylink-Uptime/2.0 (+https://github.com/hylinkorg/uptime)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function status(url, fetcher = fetch) {
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return null; // no answer at all
  }
}

/** null when the site answers 200, else what it answered last. */
export async function down(url, fetcher = fetch, pause = sleep) {
  let code = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    code = await status(url, fetcher);
    if (code === 200) return null;
    if (attempt < TRIES - 1) await pause(PAUSE_MS);
  }
  return code === null ? "no answer" : `HTTP ${code}`;
}

/** The next state and the message to send (or null), from this run's problems. */
export function decide(state, problems, now) {
  const failing = Object.entries(problems);
  if (failing.length === 0) {
    if (state.down_since) {
      const minutes = Math.round((now - state.down_since) / 60);
      return { state: {}, message: `Hylink is answering again from outside, after about ${minutes} minutes down.` };
    }
    return { state: {}, message: null };
  }
  const what = failing.map(([url, reason]) => `${url} (${reason})`).join("; ");
  if (state.down_since) {
    if (now - (state.reminded ?? 0) < REMIND_SECONDS) return { state, message: null };
    const minutes = Math.round((now - state.down_since) / 60);
    return {
      state: { ...state, reminded: now },
      message: `@everyone Hylink is still down after ${minutes} minutes: ${what}.`,
    };
  }
  const since = state.failing_since;
  if (!since || now - since > FORGET_SECONDS) {
    return { state: { failing_since: now }, message: null }; // the first failing run
  }
  if (now - since < CONFIRM_SECONDS) return { state, message: null };
  return {
    state: { down_since: since, reminded: now },
    message: `@everyone Hylink is down, seen from outside: ${what}. If both fail, the whole server may be unreachable.`,
  };
}

export async function send(webhook, message, fetcher = fetch) {
  if (!webhook || !webhook.startsWith("https://discord.com/api/webhooks/")) {
    throw new Error("DISCORD_WEBHOOK_URL is missing");
  }
  const response = await fetcher(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      content: message,
      allowed_mentions: { parse: message.startsWith("@everyone") ? ["everyone"] : [] },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Never the response text: it could echo the webhook.
  if (!response.ok) throw new Error(`Discord answered ${response.status}`);
}

export async function run(env, now, fetcher = fetch, pause = sleep) {
  const state = (await env.STATE.get("state", "json")) ?? {};
  const answers = await Promise.all(SITES.map((url) => down(url, fetcher, pause)));
  const problems = Object.fromEntries(SITES.map((url, i) => [url, answers[i]]).filter(([, reason]) => reason));
  const next = decide(state, problems, now);
  // The message first: if Discord fails, the state stays and the next run tries again.
  if (next.message) await send(env.DISCORD_WEBHOOK_URL, next.message, fetcher);
  // Written only on a change: the free plan allows 1,000 writes a day.
  if (JSON.stringify(next.state) !== JSON.stringify(state)) {
    await env.STATE.put("state", JSON.stringify(next.state));
  }
  console.log(JSON.stringify({ down: problems, state: next.state, sent: Boolean(next.message) }));
  return next;
}

export default {
  async scheduled(controller, env, ctx) {
    await run(env, Math.floor(controller.scheduledTime / 1000));
  },
};
