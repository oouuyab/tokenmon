const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { mergeDex, readCloudDex, writeCloudDex } = require('../src/dexsync');

// iCloud Drive 루트 아래 tokenmon 폴더를 흉내 낸다 — 루트는 있고 폴더는 아직 없다
const tmpDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tokemon-')), 'tokenmon');

test('mergeDex: 없는 종을 더하고 더 이른 시각을 남긴다', () => {
  const target = { seen: { pichu: 5, eevee: 1 }, caught: {} };
  const changed = mergeDex(target, { seen: { pichu: 2, eevee: 9, raichu: 7 }, caught: { pichu: 3 } });
  assert.equal(changed, true);
  assert.deepEqual(target, { seen: { pichu: 2, eevee: 1, raichu: 7 }, caught: { pichu: 3 } });
});
test('mergeDex: 새로 얻은 게 없으면 false', () => {
  const target = { seen: { pichu: 1 }, caught: { pichu: 1 } };
  assert.equal(mergeDex(target, { seen: { pichu: 4 }, caught: { pichu: 1 } }), false);
});
test('mergeDex: 시각이 아니거나 슬러그가 아닌 항목은 건너뛴다', () => {
  const target = { seen: {}, caught: {} };
  mergeDex(target, { seen: { pichu: 'x', eevee: 0, 'Bad Slug': 1, '../x': 1, raichu: 2 }, caught: null });
  assert.deepEqual(target, { seen: { raichu: 2 }, caught: {} });
});

test('writeCloudDex → readCloudDex 왕복', () => {
  const dir = tmpDir();
  const dex = { seen: { pichu: 1 }, caught: { pichu: 2 } };
  assert.equal(writeCloudDex(dir, 'a', dex, 'mini'), true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'dex-a.json'), 'utf8'));
  assert.deepEqual(saved, { device: 'mini', ...dex });
  assert.deepEqual(readCloudDex(dir), [dex]);
});
// iCloud가 5분마다 같은 내용을 다시 올리지 않게 한다
test('writeCloudDex: 내용이 같으면 다시 쓰지 않는다', () => {
  const dir = tmpDir();
  writeCloudDex(dir, 'a', { seen: { pichu: 1, eevee: 2 }, caught: {} }, 'mini');
  assert.equal(writeCloudDex(dir, 'a', { seen: { eevee: 2, pichu: 1 }, caught: {} }, 'mini'), false);
  assert.equal(writeCloudDex(dir, 'a', { seen: { pichu: 1 }, caught: {} }, 'mini'), true);
});
test('writeCloudDex: iCloud Drive가 없으면 폴더를 만들지 않는다', () => {
  const dir = path.join(tmpDir(), 'tokenmon');
  assert.equal(writeCloudDex(dir, 'a', { seen: {}, caught: {} }, 'mini'), false);
  assert.equal(fs.existsSync(dir), false);
});

test('readCloudDex: 다른 기기 파일을 모두 읽고 나머지는 건너뛴다', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'dex-a.json'), JSON.stringify({ device: 'a', seen: { pichu: 1 }, caught: {} }));
  fs.writeFileSync(path.join(dir, 'dex-b.json'), JSON.stringify({ device: 'b', seen: {}, caught: { eevee: 2 } }));
  fs.writeFileSync(path.join(dir, 'dex-c.json'), '{corrupt');
  fs.writeFileSync(path.join(dir, '.dex-d.json.icloud'), 'placeholder');
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ seen: { raichu: 1 } }));
  const all = readCloudDex(dir).sort((x, y) => Object.keys(y.seen).length - Object.keys(x.seen).length);
  assert.deepEqual(all, [{ seen: { pichu: 1 }, caught: {} }, { seen: {}, caught: { eevee: 2 } }]);
});
test('readCloudDex: 폴더가 없으면 빈 목록', () => {
  assert.deepEqual(readCloudDex(tmpDir()), []);
});
