// 習慣トラッカーの画面に関係しない処理。
// ブラウザ (app.js) と Node のテスト (habits.test.js) の両方から読み込む。
// 日付はすべて端末の地方時の "YYYY-MM-DD" 文字列で扱う。

export const DATA_VERSION = 1;
export const STORAGE_KEY = 'habit-tracker-data';
export const MAX_NAME_LENGTH = 30;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---- 日付 ----

/** Date を地方時の "YYYY-MM-DD" にする。 */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" として実在する日付かどうか。 */
export function isValidDateKey(key) {
  if (typeof key !== 'string' || !DATE_KEY_PATTERN.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "YYYY-MM-DD" に n 日足す (n は負でもよい)。 */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  // UTC で計算するので夏時間の切り替わりの影響を受けない。
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** その月の日付の一覧。month は 1〜12。 */
export function monthDateKeys(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return Array.from({ length: days }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

/** 月の 1 日の曜日 (0 = 日曜)。カレンダーの空白マスの数に使う。 */
export function firstWeekday(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

// ---- データ ----

export function createEmptyData() {
  return { version: DATA_VERSION, habits: [] };
}

/** 習慣名の前後の空白を取り、使えない名前ならエラーにする。 */
export function normalizeName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') throw new Error('習慣の名前を入力してください。');
  if ([...trimmed].length > MAX_NAME_LENGTH) {
    throw new Error(`習慣の名前は ${MAX_NAME_LENGTH} 文字以内にしてください。`);
  }
  return trimmed;
}

export function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 習慣を追加した新しいデータを返す (元のデータは変えない)。 */
export function addHabit(data, name, today, id = generateId()) {
  const cleanName = normalizeName(name);
  if (data.habits.some((h) => h.name === cleanName)) {
    throw new Error('同じ名前の習慣がすでにあります。');
  }
  const habit = { id, name: cleanName, createdAt: today, doneDates: [] };
  return { ...data, habits: [...data.habits, habit] };
}

export function isDone(habit, date) {
  return habit.doneDates.includes(date);
}

/** 指定した日の「できた」を切り替えた新しいデータを返す。 */
export function toggleDone(data, habitId, date) {
  if (!isValidDateKey(date)) throw new Error(`日付の形式が正しくありません: ${date}`);
  let found = false;
  const habits = data.habits.map((h) => {
    if (h.id !== habitId) return h;
    found = true;
    const doneDates = isDone(h, date)
      ? h.doneDates.filter((d) => d !== date)
      : [...h.doneDates, date].sort();
    return { ...h, doneDates };
  });
  if (!found) throw new Error('習慣が見つかりません。');
  return { ...data, habits };
}

/**
 * 今日まで続いている日数。
 * 今日がまだ未チェックでも、昨日まで続いていれば途切れていない扱いにする
 * (その日のうちにチェックすれば連続が伸びるため)。
 */
export function currentStreak(habit, today) {
  const done = new Set(habit.doneDates);
  let day = done.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (done.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/** その月の各日の記録。未来の日は done ではなく future: true にする。 */
export function monthRecord(habit, year, month, today) {
  const done = new Set(habit.doneDates);
  return monthDateKeys(year, month).map((date) => ({
    date,
    day: Number(date.slice(8)),
    done: done.has(date),
    future: date > today,
    today: date === today,
  }));
}

/** その月にできた日数。 */
export function monthDoneCount(habit, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return habit.doneDates.filter((d) => d.startsWith(prefix)).length;
}

// ---- 保存と読み込み ----

/**
 * 保存されていた値を検査して、正しい形のデータにする。
 * 形がおかしい場合はエラーにする (黙って捨てると記録が消えるため)。
 */
export function parseData(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('データの形式が正しくありません。');
  }
  if (value.version !== DATA_VERSION) {
    throw new Error(`対応していないデータのバージョンです: ${value.version}`);
  }
  if (!Array.isArray(value.habits)) {
    throw new Error('データの形式が正しくありません (habits がありません)。');
  }
  const ids = new Set();
  const habits = value.habits.map((h, i) => {
    const where = `${i + 1} 件目の習慣`;
    if (h === null || typeof h !== 'object') throw new Error(`${where}の形式が正しくありません。`);
    if (typeof h.id !== 'string' || h.id === '') throw new Error(`${where}の id が正しくありません。`);
    if (ids.has(h.id)) throw new Error(`${where}の id が重複しています。`);
    ids.add(h.id);
    if (!isValidDateKey(h.createdAt)) throw new Error(`${where}の createdAt が正しくありません。`);
    if (!Array.isArray(h.doneDates) || !h.doneDates.every(isValidDateKey)) {
      throw new Error(`${where}の doneDates が正しくありません。`);
    }
    return {
      id: h.id,
      name: normalizeName(h.name),
      createdAt: h.createdAt,
      doneDates: [...new Set(h.doneDates)].sort(),
    };
  });
  return { version: DATA_VERSION, habits };
}

/** storage (localStorage と同じ形のもの) から読み込む。未保存なら空のデータ。 */
export function loadData(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return createEmptyData();
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('保存されているデータが壊れています。');
  }
  return parseData(value);
}

export function saveData(storage, data) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ---- バックアップ (書き出しと読み込み) ----

export const MAX_BACKUP_BYTES = 1024 * 1024;

const BACKUP_KEYS = ['version', 'exportedAt', 'habits'];
const HABIT_KEYS = ['id', 'name', 'createdAt', 'doneDates'];
const EXPORTED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;

/** 地方時の日時を "2026-11-09T12:00:00+09:00" の形にする。 */
export function toLocalISOString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${toDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** 書き出すファイルの中身 (JSON 文字列)。 */
export function serializeBackup(data, now) {
  const backup = {
    version: DATA_VERSION,
    exportedAt: toLocalISOString(now),
    habits: data.habits.map((h) => ({
      id: h.id,
      name: h.name,
      createdAt: h.createdAt,
      doneDates: [...h.doneDates],
    })),
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function backupFileName(todayKey) {
  return `habit-backup-${todayKey}.json`;
}

function sameKeys(obj, keys) {
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((k, i) => k === expected[i]);
}

/**
 * 読み込んだファイルの中身を検査する。
 * このアプリが書き出した形 (項目の過不足がない version 1) でなければエラーにする。
 * 戻り値は { exportedAt, data }。
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('ファイルが空です。');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('JSON として読めないファイルです。');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('このアプリで書き出したバックアップではありません。');
  }
  if (!sameKeys(value, BACKUP_KEYS)) {
    throw new Error('このアプリで書き出したバックアップではありません (項目が違います)。');
  }
  if (typeof value.exportedAt !== 'string' || !EXPORTED_AT_PATTERN.test(value.exportedAt)
      || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error('バックアップの書き出し日時 (exportedAt) が正しくありません。');
  }
  if (Array.isArray(value.habits)) {
    value.habits.forEach((h, i) => {
      if (h !== null && typeof h === 'object' && !sameKeys(h, HABIT_KEYS)) {
        throw new Error(`${i + 1} 件目の習慣の項目が、このアプリの形と違います。`);
      }
    });
  }
  const data = parseData({ version: value.version, habits: value.habits });
  const names = new Set();
  for (const h of data.habits) {
    if (names.has(h.name)) throw new Error(`同じ名前の習慣が 2 つあります: ${h.name}`);
    names.add(h.name);
  }
  return { exportedAt: value.exportedAt, data };
}

/** 確認画面に出すための件数。 */
export function summarize(data) {
  return {
    habitCount: data.habits.length,
    recordCount: data.habits.reduce((sum, h) => sum + h.doneDates.length, 0),
  };
}
