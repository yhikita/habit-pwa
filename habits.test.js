import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STORAGE_KEY,
  MAX_NAME_LENGTH,
  toDateKey,
  isValidDateKey,
  addDays,
  monthDateKeys,
  firstWeekday,
  createEmptyData,
  addHabit,
  toggleDone,
  isDone,
  currentStreak,
  monthRecord,
  monthDoneCount,
  parseData,
  loadData,
  saveData,
  serializeBackup,
  parseBackup,
  backupFileName,
  toLocalISOString,
  summarize,
} from './habits.js';

const habitWith = (doneDates) => ({ id: 'x', name: 'テスト', createdAt: '2026-01-01', doneDates });

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

// ---- 日付 ----

test('toDateKey は地方時の日付をゼロ埋めで返す', () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(toDateKey(new Date(2026, 10, 9, 0, 0)), '2026-11-09');
});

test('isValidDateKey は実在しない日付や形式違いを弾く', () => {
  assert.equal(isValidDateKey('2026-11-09'), true);
  assert.equal(isValidDateKey('2028-02-29'), true);
  assert.equal(isValidDateKey('2026-02-29'), false);
  assert.equal(isValidDateKey('2026-13-01'), false);
  assert.equal(isValidDateKey('2026-1-1'), false);
  assert.equal(isValidDateKey(20261109), false);
});

test('addDays は月・年・うるう年をまたいで計算できる', () => {
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('monthDateKeys はその月の日数分の日付を返す', () => {
  assert.equal(monthDateKeys(2026, 11).length, 30);
  assert.equal(monthDateKeys(2026, 2).length, 28);
  assert.equal(monthDateKeys(2028, 2).length, 29);
  assert.equal(monthDateKeys(2026, 11)[0], '2026-11-01');
  assert.equal(monthDateKeys(2026, 11).at(-1), '2026-11-30');
});

test('firstWeekday は月の 1 日の曜日を返す', () => {
  assert.equal(firstWeekday(2026, 11), 0); // 2026-11-01 は日曜
  assert.equal(firstWeekday(2026, 10), 4); // 2026-10-01 は木曜
});

// ---- 習慣の追加 ----

test('addHabit は名前の前後の空白を取って追加し、元のデータは変えない', () => {
  const data = createEmptyData();
  const next = addHabit(data, '  散歩  ', '2026-11-09', 'id1');
  assert.deepEqual(next.habits, [
    { id: 'id1', name: '散歩', createdAt: '2026-11-09', doneDates: [] },
  ]);
  assert.equal(data.habits.length, 0);
});

test('addHabit は空の名前・長すぎる名前・重複をエラーにする', () => {
  const data = addHabit(createEmptyData(), '散歩', '2026-11-09', 'id1');
  assert.throws(() => addHabit(data, '   ', '2026-11-09'), /名前を入力/);
  assert.throws(() => addHabit(data, 'あ'.repeat(MAX_NAME_LENGTH + 1), '2026-11-09'), /文字以内/);
  assert.throws(() => addHabit(data, ' 散歩 ', '2026-11-09'), /同じ名前/);
  assert.doesNotThrow(() => addHabit(data, 'あ'.repeat(MAX_NAME_LENGTH), '2026-11-09'));
});

test('addHabit は id を省略すると重ならない id を作る', () => {
  let data = addHabit(createEmptyData(), 'A', '2026-11-09');
  data = addHabit(data, 'B', '2026-11-09');
  assert.notEqual(data.habits[0].id, data.habits[1].id);
});

// ---- チェック ----

test('toggleDone はチェックを付け外しし、日付順を保つ', () => {
  let data = addHabit(createEmptyData(), '散歩', '2026-11-01', 'id1');
  data = toggleDone(data, 'id1', '2026-11-09');
  data = toggleDone(data, 'id1', '2026-11-03');
  assert.deepEqual(data.habits[0].doneDates, ['2026-11-03', '2026-11-09']);
  assert.equal(isDone(data.habits[0], '2026-11-09'), true);

  data = toggleDone(data, 'id1', '2026-11-09');
  assert.deepEqual(data.habits[0].doneDates, ['2026-11-03']);
});

test('toggleDone はほかの習慣に影響しない', () => {
  let data = addHabit(createEmptyData(), 'A', '2026-11-01', 'a');
  data = addHabit(data, 'B', '2026-11-01', 'b');
  data = toggleDone(data, 'a', '2026-11-09');
  assert.deepEqual(data.habits[1].doneDates, []);
});

test('toggleDone は存在しない習慣や不正な日付をエラーにする', () => {
  const data = addHabit(createEmptyData(), 'A', '2026-11-01', 'a');
  assert.throws(() => toggleDone(data, 'nope', '2026-11-09'), /見つかりません/);
  assert.throws(() => toggleDone(data, 'a', '2026/11/09'), /日付の形式/);
});

// ---- 連続日数 ----

test('currentStreak: 今日までチェックが続いていればその日数', () => {
  const h = habitWith(['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.equal(currentStreak(h, '2026-11-09'), 3);
});

test('currentStreak: 今日が未チェックでも昨日まで続いていれば途切れない', () => {
  const h = habitWith(['2026-11-07', '2026-11-08']);
  assert.equal(currentStreak(h, '2026-11-09'), 2);
});

test('currentStreak: 昨日も今日も未チェックなら 0', () => {
  const h = habitWith(['2026-11-06', '2026-11-07']);
  assert.equal(currentStreak(h, '2026-11-09'), 0);
});

test('currentStreak: 途切れた日より前は数えない', () => {
  const h = habitWith(['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05']);
  assert.equal(currentStreak(h, '2026-11-05'), 2);
});

test('currentStreak: 月をまたいで数える', () => {
  const h = habitWith(['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(currentStreak(h, '2026-11-01'), 3);
});

test('currentStreak: 記録がなければ 0', () => {
  assert.equal(currentStreak(habitWith([]), '2026-11-09'), 0);
});

// ---- 今月の記録 ----

test('monthRecord は各日のできた・今日・未来を返す', () => {
  const h = habitWith(['2026-10-31', '2026-11-01', '2026-11-09']);
  const rec = monthRecord(h, 2026, 11, '2026-11-09');
  assert.equal(rec.length, 30);
  assert.deepEqual(rec[0], { date: '2026-11-01', day: 1, done: true, future: false, today: false });
  assert.deepEqual(rec[8], { date: '2026-11-09', day: 9, done: true, future: false, today: true });
  assert.equal(rec[9].future, true);
  assert.equal(rec.filter((r) => r.done).length, 2);
});

test('monthDoneCount はその月のできた日数だけを数える', () => {
  const h = habitWith(['2026-10-31', '2026-11-01', '2026-11-09', '2027-11-01']);
  assert.equal(monthDoneCount(h, 2026, 11), 2);
  assert.equal(monthDoneCount(h, 2026, 10), 1);
});

// ---- 保存と読み込み ----

test('saveData で保存したものを loadData で読み戻せる', () => {
  const storage = memoryStorage();
  let data = addHabit(createEmptyData(), '散歩', '2026-11-01', 'id1');
  data = toggleDone(data, 'id1', '2026-11-09');
  saveData(storage, data);
  assert.deepEqual(loadData(storage), data);
});

test('loadData は未保存なら空のデータを返す', () => {
  assert.deepEqual(loadData(memoryStorage()), createEmptyData());
});

test('loadData は壊れたデータを黙って捨てずにエラーにする', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{壊れた' });
  assert.throws(() => loadData(storage), /壊れています/);
});

test('parseData はバージョン違い・形式違いをエラーにする', () => {
  assert.throws(() => parseData({ version: 2, habits: [] }), /バージョン/);
  assert.throws(() => parseData({ version: 1 }), /habits/);
  assert.throws(() => parseData([]), /形式/);
  const base = { id: 'a', name: 'A', createdAt: '2026-11-01', doneDates: [] };
  assert.throws(() => parseData({ version: 1, habits: [base, base] }), /重複/);
  assert.throws(
    () => parseData({ version: 1, habits: [{ ...base, doneDates: ['2026-02-30'] }] }),
    /doneDates/,
  );
  assert.throws(() => parseData({ version: 1, habits: [{ ...base, name: '' }] }), /名前/);
});

test('parseData は重複した日付をまとめて日付順に並べる', () => {
  const data = parseData({
    version: 1,
    habits: [{ id: 'a', name: 'A', createdAt: '2026-11-01', doneDates: ['2026-11-09', '2026-11-01', '2026-11-09'] }],
  });
  assert.deepEqual(data.habits[0].doneDates, ['2026-11-01', '2026-11-09']);
});

test('練習用データ sample-backup.json を読み込める', () => {
  const sample = JSON.parse(readFileSync(new URL('./sample-backup.json', import.meta.url), 'utf8'));
  const data = parseData(sample);
  assert.equal(data.habits.length, 3);
  assert.ok(data.habits.every((h) => h.name.endsWith('(練習用)')));
  // 2026-11-08 時点の連続日数 (sample-backup.json 作成時の想定どおり)
  assert.deepEqual(
    data.habits.map((h) => currentStreak(h, '2026-11-08')),
    [4, 5, 2],
  );
});

// ---- バックアップ ----

const sampleText = () => readFileSync(new URL('./sample-backup.json', import.meta.url), 'utf8');

test('toLocalISOString は時差付きの日時を返す', () => {
  const s = toLocalISOString(new Date(2026, 10, 9, 8, 5, 3));
  assert.match(s, /^2026-11-09T08:05:03[+-]\d{2}:\d{2}$/);
  assert.equal(new Date(s).getTime(), new Date(2026, 10, 9, 8, 5, 3).getTime());
});

test('書き出したものを読み込むと同じデータに戻る', () => {
  let data = addHabit(createEmptyData(), '散歩', '2026-11-01', 'id1');
  data = addHabit(data, '読書', '2026-11-02', 'id2');
  data = toggleDone(data, 'id1', '2026-11-09');
  const text = serializeBackup(data, new Date(2026, 10, 9, 12, 0, 0));
  const { data: restored, exportedAt } = parseBackup(text);
  assert.deepEqual(restored, data);
  assert.match(exportedAt, /^2026-11-09T12:00:00/);
});

test('backupFileName は日付入りのファイル名を返す', () => {
  assert.equal(backupFileName('2026-11-09'), 'habit-backup-2026-11-09.json');
});

test('sample-backup.json はこのアプリの形として読み込める', () => {
  const { data, exportedAt } = parseBackup(sampleText());
  assert.equal(exportedAt, '2026-11-08T12:00:00+09:00');
  assert.deepEqual(summarize(data), { habitCount: 3, recordCount: 30 });
});

test('parseBackup は JSON でないものや空のファイルを弾く', () => {
  assert.throws(() => parseBackup(''), /空です/);
  assert.throws(() => parseBackup('hello'), /JSON として読めない/);
  assert.throws(() => parseBackup('[]'), /バックアップではありません/);
  assert.throws(() => parseBackup('null'), /バックアップではありません/);
});

test('parseBackup は項目の過不足があるものを弾く', () => {
  const base = JSON.parse(sampleText());
  const { exportedAt, ...noExportedAt } = base;
  assert.throws(() => parseBackup(JSON.stringify(noExportedAt)), /項目が違います/);
  assert.throws(() => parseBackup(JSON.stringify({ ...base, extra: 1 })), /項目が違います/);

  const extraHabitKey = structuredClone(base);
  extraHabitKey.habits[0].color = 'red';
  assert.throws(() => parseBackup(JSON.stringify(extraHabitKey)), /1 件目の習慣の項目/);

  const missingHabitKey = structuredClone(base);
  delete missingHabitKey.habits[1].doneDates;
  assert.throws(() => parseBackup(JSON.stringify(missingHabitKey)), /2 件目の習慣の項目/);
});

test('parseBackup は中身がおかしいものを弾く', () => {
  const base = JSON.parse(sampleText());
  assert.throws(() => parseBackup(JSON.stringify({ ...base, version: 2 })), /バージョン/);
  assert.throws(() => parseBackup(JSON.stringify({ ...base, exportedAt: '昨日' })), /exportedAt/);
  assert.throws(() => parseBackup(JSON.stringify({ ...base, habits: 'x' })), /habits/);

  const badDate = structuredClone(base);
  badDate.habits[0].doneDates.push('2026-11-31');
  assert.throws(() => parseBackup(JSON.stringify(badDate)), /doneDates/);

  const dupName = structuredClone(base);
  dupName.habits[1].name = dupName.habits[0].name;
  assert.throws(() => parseBackup(JSON.stringify(dupName)), /同じ名前/);

  const dupId = structuredClone(base);
  dupId.habits[1].id = dupId.habits[0].id;
  assert.throws(() => parseBackup(JSON.stringify(dupId)), /重複/);
});

test('summarize は習慣と記録の件数を数える', () => {
  assert.deepEqual(summarize(createEmptyData()), { habitCount: 0, recordCount: 0 });
});
