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

// 창이 리셋되면 그 전 사용률은 더 이상 사실이 아니다. Codex는 세션 로그를 지우지 않으므로
// 며칠 전 파일이 그대로 남아 있고, 그걸 읽으면 만료된 수치를 현재값처럼 보여주게 된다.
// resets_at이 지난 창은 값이 없는 것으로 본다. resets_at이 아예 없는 구버전 로그는
// 만료를 판정할 근거가 없으므로 그대로 살려둔다.
function dropExpired(u, now = Date.now()) {
  if (!u) return null;
  const alive = (w) => (w && (w.resetsAt == null || w.resetsAt > now)) ? w : null;
  const weekly = alive(u.weekly);
  return weekly ? { fiveHour: alive(u.fiveHour), weekly } : null;
}

// Codex 홈은 ~/.codex 하나가 아니다. CODEX_HOME으로 홈을 옮겨 쓰는 런처가 있고(orca는
// 계정마다 별도 홈을 만든다), 그러면 ~/.codex에는 옛날 세션만 남아 실제로 쓰는 세션을
// 통째로 놓친다. 후보를 전부 훑어 그중 가장 최신 파일부터 본다.
function codexSessionDirs() {
  const home = os.homedir();
  const dirs = [];
  if (process.env.CODEX_HOME) dirs.push(path.join(process.env.CODEX_HOME, 'sessions'));
  dirs.push(path.join(home, '.codex', 'sessions'));
  const orca = path.join(home, 'Library', 'Application Support', 'orca', 'codex-accounts');
  try {
    for (const acc of fs.readdirSync(orca)) dirs.push(path.join(orca, acc, 'home', 'sessions'));
  } catch { /* orca를 안 쓰면 없는 게 정상 */ }
  return [...new Set(dirs)];
}

// 없는 홈은 빈 목록으로 넘긴다 — 후보 중 하나가 없다고 나머지를 못 보면 안 된다
function jsonlFiles(dir) {
  try {
    return fs.readdirSync(dir, { recursive: true })
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }));
  } catch {
    return [];
  }
}

async function fetchCodexUsage(sessionsDir) {
  const dirs = sessionsDir ? [sessionsDir] : codexSessionDirs();
  const files = dirs.flatMap(jsonlFiles)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 50); // ponytail: 최근 50개만 스캔, 부족하면 늘리면 됨
  if (!files.length) return null; // Codex 미설치
  // 가장 최신 스냅샷이 만료됐으면 더 오래된 파일은 볼 것도 없다 — 전부 그보다 낡았다
  for (const { f } of files) {
    const u = usageFromJsonl(fs.readFileSync(f, 'utf8'));
    if (u) return dropExpired(u);
  }
  return null;
}

async function fetchCodexWeekly(sessionsDir) {
  return (await fetchCodexUsage(sessionsDir))?.weekly.pct ?? null;
}

module.exports = { usageFromJsonl, weeklyFromJsonl, dropExpired, codexSessionDirs, fetchCodexUsage, fetchCodexWeekly };
