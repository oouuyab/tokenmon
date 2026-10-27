const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { weeklyFromJsonl, usageFromJsonl, dropExpired, fetchCodexWeekly, fetchCodexUsage } = require('../src/usage/codex');

const FIXTURE = [
  '{"timestamp":"t","type":"event_msg","payload":{"type":"agent_message"}}',
  '{"timestamp":"t","type":"event_msg","payload":{"type":"token_count","info":{},"rate_limits":{"limit_id":"codex","primary":{"used_percent":40.0,"window_minutes":300},"secondary":{"used_percent":6.0,"window_minutes":10080}}}}',
  '{"timestamp":"t","type":"event_msg","payload":{"type":"token_count","info":{},"rate_limits":{"limit_id":"codex","primary":{"used_percent":41.0,"window_minutes":300},"secondary":{"used_percent":7.5,"window_minutes":10080}}}}',
].join('\n');

test('가장 마지막 스냅샷의 주간 %를 반환', () => assert.equal(weeklyFromJsonl(FIXTURE), 7.5));
test('rate_limits 없으면 null', () => assert.equal(weeklyFromJsonl('{"a":1}\n{"b":2}'), null));
test('깨진 줄은 건너뛰고 이전 스냅샷 사용', () =>
  assert.equal(weeklyFromJsonl(FIXTURE + '\n{broken rate_limits'), 7.5));
test('빈 문자열 → null', () => assert.equal(weeklyFromJsonl(''), null));

test('usageFromJsonl: 5시간/주간 %와 리셋 시각(ms) 반환', () => {
  const line = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: 40, window_minutes: 300, resets_at: 1783768016 },
    secondary: { used_percent: 6, window_minutes: 10080, resets_at: 1784354816 },
  } } });
  assert.deepEqual(usageFromJsonl(line), {
    fiveHour: { pct: 40, resetsAt: 1783768016000 },
    weekly: { pct: 6, resetsAt: 1784354816000 },
  });
});

test('usageFromJsonl: resets_at 없으면 null, primary 없어도 weekly는 반환', () => {
  const line = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    secondary: { used_percent: 7.5, window_minutes: 10080 },
  } } });
  assert.deepEqual(usageFromJsonl(line), { fiveHour: null, weekly: { pct: 7.5, resetsAt: null } });
});

test('fetchCodexWeekly: 세션 디렉토리 없으면 null', async () => {
  assert.equal(await fetchCodexWeekly(path.join(os.tmpdir(), 'tokemon-no-such-dir-' + Date.now())), null);
});

test('fetchCodexWeekly: 최신 파일의 스냅샷을 읽음', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokemon-codex-'));
  const sub = path.join(dir, '2026', '07');
  fs.mkdirSync(sub, { recursive: true });
  const line = (pct) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { secondary: { used_percent: pct, window_minutes: 10080 } } } });
  fs.writeFileSync(path.join(sub, 'old.jsonl'), line(3));
  fs.writeFileSync(path.join(sub, 'new.jsonl'), line(9));
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(sub, 'old.jsonl'), past, past);
  assert.equal(await fetchCodexWeekly(dir), 9);
});

test('fetchCodexWeekly: rate_limits 없는 최신 파일은 건너뛰고 이전 파일 사용', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokemon-codex-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.jsonl'), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { secondary: { used_percent: 4, window_minutes: 10080 } } } }));
  fs.writeFileSync(path.join(dir, 'b.jsonl'), '{"no":"limits"}');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'a.jsonl'), past, past);
  assert.equal(await fetchCodexWeekly(dir), 4);
});

// 주간 창이 어느 자리에 오는지는 플랜마다 다르다 — free는 primary에 주간 하나만 담는다
const rlLine = (rate_limits) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits } });

test('free 플랜: 주간이 primary에 오고 secondary가 비어도 읽는다', () => {
  const line = rlLine({
    limit_id: 'codex', plan_type: 'free',
    primary: { used_percent: 27, window_minutes: 10080, resets_at: 1774325923 },
    secondary: null,
  });
  assert.deepEqual(usageFromJsonl(line), {
    fiveHour: null,
    weekly: { pct: 27, resetsAt: 1774325923000 },
  });
});

test('유료 플랜: primary(300)=5시간, secondary(10080)=주간', () => {
  const line = rlLine({
    primary: { used_percent: 40, window_minutes: 300 },
    secondary: { used_percent: 6, window_minutes: 10080 },
  });
  assert.deepEqual(usageFromJsonl(line), {
    fiveHour: { pct: 40, resetsAt: null },
    weekly: { pct: 6, resetsAt: null },
  });
});

test('두 창이 모두 주간이면 primary를 쓴다', () => {
  const line = rlLine({
    primary: { used_percent: 27, window_minutes: 10080 },
    secondary: { used_percent: 99, window_minutes: 10080 },
  });
  assert.equal(weeklyFromJsonl(line), 27);
});

test('최근 줄의 rate_limits가 전부 null이면 건너뛰고 이전 줄을 쓴다', () => {
  const text = [
    rlLine({ primary: { used_percent: 27, window_minutes: 10080 }, secondary: null }),
    rlLine({ limit_id: 'codex', primary: null, secondary: null, credits: null, plan_type: 'unknown' }),
  ].join('\n');
  assert.equal(weeklyFromJsonl(text), 27);
});

test('window_minutes가 없으면 예전 자리 규칙 — secondary가 주간', () => {
  const line = rlLine({
    primary: { used_percent: 40 },
    secondary: { used_percent: 6 },
  });
  assert.deepEqual(usageFromJsonl(line), {
    fiveHour: { pct: 40, resetsAt: null },
    weekly: { pct: 6, resetsAt: null },
  });
});

test('window_minutes가 없고 primary만 있으면 주간을 못 찾아 null', () => {
  assert.equal(weeklyFromJsonl(rlLine({ primary: { used_percent: 40 }, secondary: null })), null);
});

// 만료 판정 — 창이 리셋된 뒤의 옛 수치를 현재값처럼 보여주지 않기 위한 것
const NOW = 1_700_000_000_000;

test('dropExpired: 주간 resets_at이 지났으면 통째로 null', () => {
  const u = { fiveHour: { pct: 40, resetsAt: NOW + 1000 }, weekly: { pct: 10, resetsAt: NOW - 1 } };
  assert.equal(dropExpired(u, NOW), null);
});

test('dropExpired: 주간이 살아 있고 5시간만 만료면 5시간만 버린다', () => {
  const u = { fiveHour: { pct: 40, resetsAt: NOW - 1 }, weekly: { pct: 10, resetsAt: NOW + 1000 } };
  assert.deepEqual(dropExpired(u, NOW), { fiveHour: null, weekly: { pct: 10, resetsAt: NOW + 1000 } });
});

test('dropExpired: 둘 다 살아 있으면 그대로', () => {
  const u = { fiveHour: { pct: 40, resetsAt: NOW + 1 }, weekly: { pct: 10, resetsAt: NOW + 2 } };
  assert.deepEqual(dropExpired(u, NOW), u);
});

test('dropExpired: resets_at이 없으면 판정할 근거가 없으므로 살려둔다', () => {
  const u = { fiveHour: null, weekly: { pct: 10, resetsAt: null } };
  assert.deepEqual(dropExpired(u, NOW), u);
});

test('dropExpired: 입력이 null이면 null', () => assert.equal(dropExpired(null, NOW), null));

test('fetchCodexUsage: 만료된 스냅샷만 있으면 null을 준다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokemon-codex-'));
  const expired = Math.floor(Date.now() / 1000) - 60; // 1분 전에 리셋됨
  fs.writeFileSync(path.join(dir, 'a.jsonl'), rlLine({
    primary: { used_percent: 10, window_minutes: 10080, resets_at: expired },
    secondary: null,
  }));
  assert.equal(await fetchCodexUsage(dir), null);
});

test('fetchCodexUsage: 아직 안 지난 스냅샷은 그대로 읽는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokemon-codex-'));
  const future = Math.floor(Date.now() / 1000) + 3600;
  fs.writeFileSync(path.join(dir, 'a.jsonl'), rlLine({
    primary: { used_percent: 10, window_minutes: 10080, resets_at: future },
    secondary: null,
  }));
  assert.deepEqual(await fetchCodexUsage(dir), {
    fiveHour: null,
    weekly: { pct: 10, resetsAt: future * 1000 },
  });
});
