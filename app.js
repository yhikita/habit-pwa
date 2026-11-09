// 画面の表示と操作。データの扱いは habits.js に任せる。
import {
  toDateKey,
  firstWeekday,
  loadData,
  saveData,
  createEmptyData,
  addHabit,
  toggleDone,
  isDone,
  currentStreak,
  monthRecord,
  monthDoneCount,
  serializeBackup,
  parseBackup,
  backupFileName,
  summarize,
  MAX_BACKUP_BYTES,
} from './habits.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const els = {
  todayLabel: document.getElementById('today-label'),
  loadError: document.getElementById('load-error'),
  form: document.getElementById('add-form'),
  nameInput: document.getElementById('habit-name'),
  formError: document.getElementById('form-error'),
  empty: document.getElementById('empty-message'),
  list: document.getElementById('habit-list'),
  template: document.getElementById('habit-template'),
  exportButton: document.getElementById('export-button'),
  importButton: document.getElementById('import-button'),
  importFile: document.getElementById('import-file'),
  backupMessage: document.getElementById('backup-message'),
  dialog: document.getElementById('import-dialog'),
  dialogNew: document.getElementById('import-new'),
  dialogCurrent: document.getElementById('import-current'),
  dialogCancel: document.getElementById('import-cancel'),
  dialogConfirm: document.getElementById('import-confirm'),
};

let data = createEmptyData();
// 保存済みデータが読めなかったときは、上書きして記録を消さないよう変更を止める。
let locked = false;
// 開いている「今月の記録」を描き直しても閉じないように覚えておく。
const openMonths = new Set();

try {
  data = loadData(localStorage);
} catch (err) {
  locked = true;
  showBanner(`${err.message} 記録を守るため、追加とチェックを止めています。`);
}

function today() {
  return toDateKey(new Date());
}

function showBanner(message) {
  els.loadError.textContent = message;
  els.loadError.hidden = false;
}

function hideBanner() {
  els.loadError.textContent = '';
  els.loadError.hidden = true;
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = message === '';
}

/** データを更新して保存する。保存に失敗したら元に戻す。 */
function commit(next) {
  try {
    saveData(localStorage, next);
  } catch {
    showBanner('端末に保存できませんでした。空き容量やブラウザの設定を確認してください。');
    return false;
  }
  data = next;
  render();
  return true;
}

function formatToday(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日 (${w})`;
}

function renderCalendar(container, habit, todayKey) {
  const [y, m] = todayKey.split('-').map(Number);
  container.replaceChildren();

  for (const w of WEEKDAYS) {
    const head = document.createElement('span');
    head.className = 'cal-head';
    head.textContent = w;
    container.append(head);
  }
  for (let i = 0; i < firstWeekday(y, m); i += 1) {
    container.append(document.createElement('span'));
  }
  for (const cell of monthRecord(habit, y, m, todayKey)) {
    const el = document.createElement('span');
    el.className = 'cal-day';
    el.textContent = String(cell.day);
    if (cell.done) el.classList.add('done');
    if (cell.future) el.classList.add('future');
    if (cell.today) el.classList.add('today');
    if (!cell.future) {
      const state = document.createElement('span');
      state.className = 'visually-hidden';
      state.textContent = cell.done ? 'できた' : 'できなかった';
      el.append(state);
    }
    container.append(el);
  }
}

function renderHabit(habit, todayKey) {
  const [y, m] = todayKey.split('-').map(Number);
  const node = els.template.content.firstElementChild.cloneNode(true);
  const done = isDone(habit, todayKey);
  const streak = currentStreak(habit, todayKey);

  node.querySelector('.habit-name').textContent = habit.name;
  node.querySelector('.streak').textContent = `連続 ${streak} 日`;
  node.querySelector('.month-count').textContent = `今月 ${monthDoneCount(habit, y, m)} 日`;

  const check = node.querySelector('.check');
  check.setAttribute('aria-pressed', String(done));
  check.setAttribute('aria-label', `${habit.name} を今日できた${done ? ' (チェック済み)' : ''}`);
  check.classList.toggle('is-done', done);
  check.disabled = locked;
  check.addEventListener('click', () => {
    commit(toggleDone(data, habit.id, today()));
  });

  const details = node.querySelector('.month');
  details.open = openMonths.has(habit.id);
  details.addEventListener('toggle', () => {
    if (details.open) openMonths.add(habit.id);
    else openMonths.delete(habit.id);
  });
  renderCalendar(node.querySelector('.calendar'), habit, todayKey);

  return node;
}

function render() {
  const todayKey = today();
  els.todayLabel.textContent = formatToday(todayKey);
  els.empty.hidden = data.habits.length > 0 || locked;
  els.list.replaceChildren(...data.habits.map((h) => renderHabit(h, todayKey)));
  els.nameInput.disabled = locked;
  els.form.querySelector('button').disabled = locked;
  // 壊れたデータは書き出せないが、バックアップからの読み込みで直せるようにしておく。
  els.exportButton.disabled = locked;
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (locked) return;
  let next;
  try {
    next = addHabit(data, els.nameInput.value, today());
  } catch (err) {
    showFormError(err.message);
    return;
  }
  if (commit(next)) {
    els.nameInput.value = '';
    showFormError('');
  }
});

els.nameInput.addEventListener('input', () => showFormError(''));

// ---- バックアップ ----

function showBackupMessage(message, isError = false) {
  els.backupMessage.textContent = message;
  els.backupMessage.hidden = message === '';
  els.backupMessage.classList.toggle('is-error', isError);
}

function describe(d) {
  const { habitCount, recordCount } = summarize(d);
  return `習慣 ${habitCount} 件・記録 ${recordCount} 日分`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

els.exportButton.addEventListener('click', () => {
  if (locked) return;
  const blob = new Blob([serializeBackup(data, new Date())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(today());
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  showBackupMessage(`${a.download} を書き出しました (${describe(data)})。`);
});

let pendingImport = null;

els.importButton.addEventListener('click', () => {
  showBackupMessage('');
  els.importFile.click();
});

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  els.importFile.value = ''; // 同じファイルをもう一度選べるようにする
  if (!file) return;
  showBackupMessage('');
  if (file.size > MAX_BACKUP_BYTES) {
    showBackupMessage('ファイルが大きすぎます。このアプリで書き出したファイルを選んでください。', true);
    return;
  }
  let backup;
  try {
    backup = parseBackup(await file.text());
  } catch (err) {
    showBackupMessage(`読み込めませんでした: ${err.message} 今のデータはそのままです。`, true);
    return;
  }
  pendingImport = backup.data;
  els.dialogNew.textContent = `${file.name} (${formatDateTime(backup.exportedAt)} に書き出し) ${describe(backup.data)}`;
  els.dialogCurrent.textContent = locked ? '保存されているデータは壊れていて読めません' : describe(data);
  els.dialog.showModal();
  els.dialogCancel.focus(); // うっかり置き換えないよう「やめる」を選んだ状態にする
});

els.dialogConfirm.addEventListener('click', () => {
  const next = pendingImport;
  pendingImport = null;
  els.dialog.close('confirm');
  if (!next) return;
  if (commit(next)) {
    if (locked) {
      locked = false;
      hideBanner();
      render();
    }
    showBackupMessage(`読み込みました (${describe(next)})。`);
  }
});

els.dialogCancel.addEventListener('click', () => els.dialog.close('cancel'));

// Esc キーなどで閉じたときも「やめる」と同じ扱いにする。
els.dialog.addEventListener('close', () => {
  if (els.dialog.returnValue !== 'confirm') {
    pendingImport = null;
    showBackupMessage('読み込みをやめました。今のデータはそのままです。');
  }
  els.dialog.returnValue = '';
});

// 日付が変わったあとにアプリへ戻ってきたら「今日」を更新する。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // 登録できなくてもアプリ自体は使えるので、画面には出さない。
  });
}
