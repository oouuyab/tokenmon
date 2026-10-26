// 여러 Mac이 iCloud Drive 폴더 하나로 도감 기록을 나눠 갖는다.
//
// 기기마다 자기 파일(dex-<id>.json)만 쓰고 남의 파일은 읽기만 한다. 한 파일을
// 같이 쓰면 iCloud가 충돌 사본을 만들고 한쪽 기록이 빠진다. 도감은 쌓이기만
// 하므로 키는 합집합, 시각은 더 이른 쪽으로 합치면 읽는 순서와 상관없이 같다.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ICLOUD_ROOT = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
const PEER_FILE = /^dex-[A-Za-z0-9-]+\.json$/;

// iCloud Drive를 켜지 않은 Mac이면 null — 동기화를 건너뛴다
function syncDir(root = ICLOUD_ROOT) {
  return fs.existsSync(root) ? path.join(root, 'tokenmon') : null;
}

const fileName = (id) => `dex-${id}.json`;

// 다른 기기의 파일은 손으로 고칠 수도 있는 외부 입력이다. 도감에 있는 종과
// 양수 시각만 받는다 — 도감 창이 그리는 값이라 그대로 믿으면 안 된다.
function mergeDex(target, incoming, isKnown) {
  let changed = false;
  for (const kind of ['seen', 'caught']) {
    const bag = incoming && incoming[kind];
    if (!bag || typeof bag !== 'object') continue;
    for (const [slug, at] of Object.entries(bag)) {
      if (!isKnown(slug) || !Number.isFinite(at) || at <= 0) continue;
      const cur = target[kind][slug];
      if (cur && cur <= at) continue;
      target[kind][slug] = at;
      changed = true;
    }
  }
  return changed;
}

// 폴더가 아직 없으면 빈 목록. 권한 거부처럼 그 밖의 오류는 호출한 쪽이 알 수 있게 던진다.
function readPeers(dir, selfId) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const peers = [];
  for (const name of names) {
    if (!PEER_FILE.test(name) || name === fileName(selfId)) continue;
    try {
      peers.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
    } catch { /* 받는 중이거나 깨진 파일 — 다음 폴링에 다시 읽는다 */ }
  }
  return peers;
}

// 내용이 같으면 쓰지 않는다 — 폴링마다 iCloud 업로드가 일어나지 않게.
// 다른 기기가 쓰다 만 파일을 읽지 않도록 임시 파일에 쓰고 이름을 바꾼다.
function writeOwn(dir, selfId, dex, device = os.hostname()) {
  const file = path.join(dir, fileName(selfId));
  const body = JSON.stringify({ device, seen: dex.seen, caught: dex.caught }, null, 2);
  try {
    if (fs.readFileSync(file, 'utf8') === body) return false;
  } catch { /* 처음 쓰는 경우 */ }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  return true;
}

module.exports = {
  syncDir,
  mergeDex,
  readPeers,
  writeOwn,
};
