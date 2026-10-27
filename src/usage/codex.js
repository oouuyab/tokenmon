const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 창의 정체는 자리가 아니라 길이가 정한다. 유료 플랜은 primary=5시간 / secondary=주간으로
// 오지만, free 플랜은 주간 하나만 primary에 담아 보내고 secondary를 비운다. 자리를 믿고
// secondary만 읽으면 후자에서 값을 영영 못 찾는다.
const LONG_WINDOW_MIN = 1440; // 하루 이상이면 주간 자리로 본다 (Codex 실측값은 300과 10080)

const pick = (w) => (w && typeof w.used_percent === 'number')
  ? { pct: w.used_percent, resetsAt: w.resets_at ? w.resets_at * 1000 : null }
  : null;

// rate_limits 한 덩어리에서 주간/5시간 창을 골라낸다.
// window_minutes가 없는 구버전 로그는 예전 자리 규칙으로 되돌아간다.
function windowsOf(rl) {
  let weekly = null;
  let fiveHour = null;
  for (const w of [rl?.primary, rl?.secondary]) {
    const v = pick(w);
    if (!v) continue;
    const min = w.window_minutes;
    if (typeof min !== 'number') {
      if (w === rl?.secondary) weekly ??= v;
      else fiveHour ??= v;
    } else if (min >= LONG_WINDOW_MIN) weekly ??= v;
    else fiveHour ??= v;
  }
  return { fiveHour, weekly };
}

// 파일 끝에서부터 스캔: 마지막 rate_limits 스냅샷이 가장 최신
// 반환: { fiveHour: {pct, resetsAt(ms)}|null, weekly: {pct, resetsAt(ms)} } | null
function usageFromJsonl(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('rate_limits')) continue;
    try {
      const { fiveHour, weekly } = windowsOf(JSON.parse(lines[i])?.payload?.rate_limits);
      if (weekly) return { fiveHour, weekly };
    } catch { /* 깨진 줄 무시 */ }
  }
  return null;
}

function weeklyFromJsonl(text) {
  return usageFromJsonl(text)?.weekly.pct ?? null;
}

async function fetchCodexUsage(sessionsDir = path.join(os.homedir(), '.codex', 'sessions')) {
  let files;
  try {
    files = fs.readdirSync(sessionsDir, { recursive: true })
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(sessionsDir, f))
      .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 50); // ponytail: 최근 50개만 스캔, 부족하면 늘리면 됨
  } catch {
    return null; // Codex 미설치
  }
  for (const { f } of files) {
    const u = usageFromJsonl(fs.readFileSync(f, 'utf8'));
    if (u) return u;
  }
  return null;
}

async function fetchCodexWeekly(sessionsDir) {
  return (await fetchCodexUsage(sessionsDir))?.weekly.pct ?? null;
}

module.exports = { usageFromJsonl, weeklyFromJsonl, fetchCodexUsage, fetchCodexWeekly };
