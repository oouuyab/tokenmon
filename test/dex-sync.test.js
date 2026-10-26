const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { syncDir, mergeDex, readPeers, writeOwn } = require('../src/dex-sync');

const known = new Set(['pichu', 'pikachu', 'raichu', 'eevee']);
const isKnown = (s) => known.has(s);
const empty = () => ({ seen: {}, caught: {} });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tokemon-sync-'));

test('mergeDex: 없는 종은 더하고 있는 종은 더 이른 시각을 남긴다', () => {
  const dex = { seen: { pichu: 200 }, caught: { pichu: 200 } };
  const changed = mergeDex(dex, { seen: { pichu: 100, eevee: 300 }, caught: { pichu: 500 } }, isKnown);
  assert.equal(changed, true);
  assert.deepEqual(dex, { seen: { pichu: 100, eevee: 300 }, caught: { pichu: 200 } });
});

test('mergeDex: 새로 얻은 게 없으면 false', () => {
  const dex = { seen: { pichu: 100 }, caught: {} };
  assert.equal(mergeDex(dex, { seen: { pichu: 100 }, caught: {} }, isKnown), false);
  assert.equal(mergeDex(dex, { seen: { pichu: 900 } }, isKnown), false);
});

// 순서를 바꿔 합쳐도 결과가 같아야 기기끼리 읽는 순서에 상관없이 맞춰진다
test('mergeDex: 합치는 순서와 상관없이 같은 결과', () => {
  const a = { seen: { pichu: 100, eevee: 400 }, caught: { pichu: 100 } };
  const b = { seen: { pichu: 300, pikachu: 200 }, caught: { pikachu: 200 } };
  const ab = empty();
  mergeDex(ab, a, isKnown);
  mergeDex(ab, b, isKnown);
  const ba = empty();
  mergeDex(ba, b, isKnown);
  mergeDex(ba, a, isKnown);
  assert.deepEqual(ab, ba);
});

test('mergeDex: 도감에 없는 종·이상한 시각·__proto__는 버린다', () => {
  const dex = empty();
  const incoming = JSON.parse(
    '{"seen":{"__proto__":1,"<img src=x>":1,"missingno":1,"pichu":"100","eevee":-1,"raichu":0},' +
    '"caught":{"pikachu":null}}');
  assert.equal(mergeDex(dex, incoming, isKnown), false);
  assert.deepEqual(dex, empty());
  assert.equal(Object.getPrototypeOf(dex.seen), Object.prototype);
});

test('mergeDex: 형태가 깨진 입력은 건너뛴다', () => {
  const dex = empty();
  for (const bad of [null, 'x', 1, { seen: 'x', caught: [] }]) mergeDex(dex, bad, isKnown);
  assert.deepEqual(dex, empty());
});

test('writeOwn → readPeers: 내 파일은 빼고 다른 기기 파일만 읽는다', () => {
  const dir = tmpDir();
  writeOwn(dir, 'me', { seen: { pichu: 1 }, caught: {} }, 'mac-a');
  writeOwn(dir, 'other', { seen: { eevee: 2 }, caught: {} }, 'mac-b');
  assert.deepEqual(readPeers(dir, 'me'), [{ device: 'mac-b', seen: { eevee: 2 }, caught: {} }]);
});

test('writeOwn: 내용이 같으면 다시 쓰지 않는다', () => {
  const dir = tmpDir();
  const dex = { seen: { pichu: 1 }, caught: {} };
  assert.equal(writeOwn(dir, 'me', dex, 'mac-a'), true);
  assert.equal(writeOwn(dir, 'me', dex, 'mac-a'), false);
  dex.seen.eevee = 2;
  assert.equal(writeOwn(dir, 'me', dex, 'mac-a'), true);
  assert.deepEqual(fs.readdirSync(dir), ['dex-me.json']);
});

test('writeOwn: 폴더가 없으면 만든다', () => {
  const dir = path.join(tmpDir(), 'tokenmon');
  writeOwn(dir, 'me', empty(), 'mac-a');
  assert.ok(fs.existsSync(path.join(dir, 'dex-me.json')));
});

test('readPeers: 폴더가 없으면 빈 목록', () =>
  assert.deepEqual(readPeers(path.join(tmpDir(), 'none'), 'me'), []));

test('readPeers: 깨진 파일·다른 이름의 파일은 건너뛴다', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'dex-broken.json'), '{half');
  fs.writeFileSync(path.join(dir, 'dex-x.json.tmp'), '{"seen":{}}');
  fs.writeFileSync(path.join(dir, 'dex-a 2.json'), '{"seen":{}}'); // iCloud 충돌 사본
  fs.writeFileSync(path.join(dir, 'notes.json'), '{}');
  fs.writeFileSync(path.join(dir, 'dex-ok.json'), '{"seen":{"pichu":1}}');
  assert.deepEqual(readPeers(dir, 'me'), [{ seen: { pichu: 1 } }]);
});

test('syncDir: iCloud Drive가 없으면 null', () => {
  assert.equal(syncDir(path.join(tmpDir(), 'none')), null);
  const root = tmpDir();
  assert.equal(syncDir(root), path.join(root, 'tokenmon'));
});
