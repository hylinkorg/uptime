import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, down, run, SITES } from "../src/index.js";

const noPause = async () => {};
const webhook = "https://discord.com/api/webhooks/1/test";

function site(answers) {
  // answers: url -> list of statuses (null = no answer), one per try
  const calls = {};
  const sent = [];
  const fetcher = async (url, init) => {
    if (url === webhook) {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 204 };
    }
    calls[url] = (calls[url] ?? 0) + 1;
    const list = answers[url] ?? [200];
    const code = list[Math.min(calls[url] - 1, list.length - 1)];
    if (code === null) throw new TypeError("network");
    return { status: code };
  };
  return { fetcher, sent, calls };
}

function store(initial = {}) {
  const data = { state: JSON.stringify(initial) };
  let writes = 0;
  return {
    env: {
      DISCORD_WEBHOOK_URL: webhook,
      STATE: {
        get: async (key) => (data[key] ? JSON.parse(data[key]) : null),
        put: async (key, value) => { writes++; data[key] = value; },
      },
    },
    writes: () => writes,
    state: () => JSON.parse(data.state),
  };
}

test("a site that answers 200 on a retry is up", async () => {
  const { fetcher, calls } = site({ [SITES[0]]: [502, 200] });
  assert.equal(await down(SITES[0], fetcher, noPause), null);
  assert.equal(calls[SITES[0]], 2);
});

test("three failures are down, with what it answered last", async () => {
  assert.equal(await down(SITES[0], site({ [SITES[0]]: [null, null, 522] }).fetcher, noPause), "HTTP 522");
  assert.equal(await down(SITES[0], site({ [SITES[0]]: [null] }).fetcher, noPause), "no answer");
});

test("one failing minute does not page; the second in a row does", async () => {
  const kv = store();
  const outage = site({ [SITES[0]]: [522] });
  await run(kv.env, 1000, outage.fetcher, noPause);
  assert.equal(outage.sent.length, 0);
  assert.deepEqual(kv.state(), { failing_since: 1000 });
  await run(kv.env, 1060, outage.fetcher, noPause);
  assert.equal(outage.sent.length, 1);
  assert.match(outage.sent[0].content, /^@everyone Hylink is down, seen from outside: https:\/\/hylink\.org\/ \(HTTP 522\)/);
  assert.deepEqual(outage.sent[0].allowed_mentions, { parse: ["everyone"] });
});

test("a blip that is gone the next minute never pages and leaves no state", async () => {
  const kv = store();
  await run(kv.env, 1000, site({ [SITES[1]]: [null] }).fetcher, noPause);
  const ok = site({});
  await run(kv.env, 1060, ok.fetcher, noPause);
  assert.equal(ok.sent.length, 0);
  assert.deepEqual(kv.state(), {});
});

test("while down: no repeat within the hour, a reminder after it, one untagged all-clear", async () => {
  const kv = store({ down_since: 1000, reminded: 1060 });
  const outage = site({ [SITES[0]]: [null], [SITES[1]]: [null] });
  await run(kv.env, 1060 + 1800, outage.fetcher, noPause);
  assert.equal(outage.sent.length, 0);
  await run(kv.env, 1060 + 3600, outage.fetcher, noPause);
  assert.equal(outage.sent.length, 1);
  assert.match(outage.sent[0].content, /^@everyone Hylink is still down after 61 minutes/);
  const ok = site({});
  await run(kv.env, 1000 + 7200, ok.fetcher, noPause);
  assert.equal(ok.sent[0].content, "Hylink is answering again from outside, after about 120 minutes down.");
  assert.deepEqual(ok.sent[0].allowed_mentions, { parse: [] });
  assert.deepEqual(kv.state(), {});
});

test("state is written only when it changes", async () => {
  const kv = store();
  for (let minute = 0; minute < 10; minute++) await run(kv.env, 1000 + 60 * minute, site({}).fetcher, noPause);
  assert.equal(kv.writes(), 0);
});

test("if Discord fails, the state stays so the next run pages again", async () => {
  const kv = store({ failing_since: 1000 });
  const fetcher = async (url) => {
    if (url === webhook) return { ok: false, status: 500 };
    return { status: 522 };
  };
  await assert.rejects(run(kv.env, 1060, fetcher, noPause), /Discord answered 500/);
  assert.deepEqual(kv.state(), { failing_since: 1000 });
});

test("an old lone failure does not count toward a page", () => {
  const next = decide({ failing_since: 1000 }, { [SITES[0]]: "HTTP 502" }, 1000 + 3600);
  assert.equal(next.message, null);
  assert.deepEqual(next.state, { failing_since: 1000 + 3600 });
});
