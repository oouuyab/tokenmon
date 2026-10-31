// 여러 기기의 도감 기록을 iCloud Drive로 합친다.
//
// 기기마다 dex-{기기 id}.json 하나씩만 쓰고, 읽을 때는 폴더의 파일을 전부 합친다.
// 한 파일을 여러 기기가 덮어쓰면 iCloud가 "파일 2" 같은 충돌본을 만들고 어느
// 한쪽 기록이 사라지는데, 자기 파일만 쓰면 그런 일이 생기지 않는다.
// 기록은 늘어나기만 하고 같은 종이면 더 이른 시각을 남기므로, 어떤 순서로
// 합쳐도 결과가 같다.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isDeepStrictEqual } = require('node:util');

const CLOUD_DIR = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'tokenmon');

// 아직 내려받지 않은 파일은 .dex-….json.icloud 자리표시자로 보이는데, 점으로
// 시작해 여기 걸리지 않는다. 다음 동기화 때 내려받아져 있으면 그때 합쳐진다.
const FILE = /^dex-[A-Za-z0-9-]+\.json$/;
const SLUG = /^[a-z0-9-]+$/;

const bagOf = (v) => (v && typeof v === 'object' ? v : {});

// 다른 기기 파일은 손으로 고쳤거나 다른 버전이 썼을 수 있어 그대로 믿지 않는다
function mergeBag(target, other) {
  let changed = false;
  for (const [slug, at] of Object.entries(bagOf(other))) {
    if (!SLUG.test(slug) || typeof at !== 'number' || !(at > 0)) continue;
    if (target[slug] && target[slug] <= at) continue;
    target[slug] = at;
    changed = true;
  }
  return changed;
}

function mergeDex(target, other) {
  const seen = mergeBag(target.seen, other && other.seen);
  const caught = mergeBag(target.caught, other && other.caught);
  return seen || caught;
}

function readCloudDex(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const all = [];
  for (const name of names) {
    if (!FILE.test(name)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      all.push({ seen: bagOf(d.seen), caught: bagOf(d.caught) });
    } catch { /* 쓰는 도중이거나 깨진 파일 — 다음 동기화 때 다시 읽는다 */ }
  }
  return all;
}

// 내용이 그대로면 쓰지 않는다. 폴링마다 쓰면 iCloud가 매번 같은 파일을 올린다.
// iCloud Drive를 꺼둔 기기에서는 폴더를 만들지 않는다 — 만들면 그 기기에만
// 남는 폴더가 생길 뿐이다.
function writeCloudDex(dir, deviceId, dex, device = os.hostname()) {
  if (!fs.existsSync(path.dirname(dir))) return false;
  const file = path.join(dir, `dex-${deviceId}.json`);
  const next = { device, seen: dex.seen, caught: dex.caught };
  try {
    if (isDeepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), next)) return false;
  } catch { /* 처음 쓰거나 깨진 파일 — 새로 쓴다 */ }
  try {
    fs.mkdirSync(dir, { recursive: true });
    // 다른 기기가 쓰다 만 파일을 읽지 않도록 다 쓴 뒤에 이름을 바꿔 넣는다
    const tmp = path.join(dir, `.dex-${deviceId}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { CLOUD_DIR, mergeDex, readCloudDex, writeCloudDex };
