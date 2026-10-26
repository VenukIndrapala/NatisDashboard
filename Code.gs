// Water & Food Tracker - Apps Script backend
// 1) Import Water-Food-Tracker.xlsx into Google Sheets (File > Import > Upload > "Replace spreadsheet").
// 2) File > Settings > Time zone = (GMT+05:30) Colombo.
// 3) Extensions > Apps Script > paste this file > Deploy > New deployment > Web app | Execute as: Me | Who has access: Anyone.
// 4) Copy the Web app URL into API at the top of app.js.
//
// Tabs used: Log (one row per entry), Goals, Quick Add, Tasks. Daily/Weekly Summary tabs are formulas and are never touched here.
const TZ = 'Asia/Colombo';
const SS = SpreadsheetApp.getActive();
const KEYS = ['water', 'calories', 'protein', 'veg'];
const CAPS = { water: 10000, calories: 10000, protein: 1000, veg: 50 };   // sanity limits per single entry
const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const num = v => { v = Number(v); return isFinite(v) && v > 0 ? v : 0; };
const r1 = v => Math.round(v * 10) / 10;

// Date cell -> 'yyyy-mm-dd' (works for real dates and for text typed as 2026-10-20)
function dkey(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

// Daily totals for the last ~400 days: { '2026-10-20': { water, calories, protein, veg } }
function readDays() {
  const sh = SS.getSheetByName('Log'), n = sh.getLastRow(), days = {};
  if (n < 2) return days;
  const min = Utilities.formatDate(new Date(Date.now() - 400 * 864e5), TZ, 'yyyy-MM-dd');
  sh.getRange(2, 1, n - 1, 6).getValues().forEach(r => {
    const k = dkey(r[0]); if (!k || k < min) return;
    const o = days[k] || (days[k] = { water: 0, calories: 0, protein: 0, veg: 0 });
    KEYS.forEach((f, i) => o[f] = r1(o[f] + num(r[i + 2])));
  });
  return days;
}

function readGoals() {
  const goals = {}, sh = SS.getSheetByName('Goals');
  sh.getRange(2, 1, 8, 2).getValues().forEach(r => {
    const name = String(r[0]).toLowerCase(), v = num(r[1]); if (!v) return;
    if (name.indexOf('water') >= 0) goals.water = v;
    else if (name.indexOf('calor') >= 0) goals.calories = v;
    else if (name.indexOf('protein') >= 0) goals.protein = v;
    else if (name.indexOf('veg') >= 0 || name.indexOf('fruit') >= 0) goals.veg = v;
  });
  return goals;
}

function readQuick() {
  return SS.getSheetByName('Quick Add').getRange(2, 1, 8, 5).getValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({ label: String(r[0]).trim().slice(0, 40), water: num(r[1]), calories: num(r[2]), protein: num(r[3]), veg: num(r[4]) }));
}

function readTasks() {
  return SS.getSheetByName('Tasks').getRange(2, 1, 30, 2).getValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({ t: String(r[0]).trim().slice(0, 80), d: r[1] === true || /^true$/i.test(String(r[1])) }));
}

function doGet() {
  return out({ goals: readGoals(), quick: readQuick(), tasks: readTasks(), days: readDays() });
}

function doPost(e) {
  let b; try { b = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'bad request' }); }
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const now = new Date();
    if (b.action === 'log') {
      const date = String(b.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return out({ error: 'date' });
      const ts = Utilities.parseDate(date, TZ, 'yyyy-MM-dd').getTime();
      if (Math.abs(ts - now.getTime()) > 400 * 864e5) return out({ error: 'date' });
      const v = {}; let any = false;
      KEYS.forEach(f => { v[f] = Math.min(num(b[f]), CAPS[f]); if (v[f] > 0) any = true; });
      if (!any) return out({ error: 'empty' });
      const sh = SS.getSheetByName('Log'), r = sh.getLastRow() + 1;
      sh.getRange(r, 1, 1, 8).setValues([[Utilities.parseDate(date, TZ, 'yyyy-MM-dd'), Utilities.formatDate(now, TZ, 'HH:mm'),
        v.water, v.calories, v.protein, v.veg, String(b.note || '').slice(0, 80), now]]);
      sh.getRange(r, 1).setNumberFormat('yyyy-mm-dd'); sh.getRange(r, 8).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    }
    if (b.action === 'tasks') {
      if (!Array.isArray(b.tasks) || b.tasks.length > 30) return out({ error: 'tasks' });
      const sh = SS.getSheetByName('Tasks');
      sh.getRange(2, 1, 30, 3).clearContent();
      if (b.tasks.length) sh.getRange(2, 1, b.tasks.length, 3).setValues(
        b.tasks.map(t => [String(t.t || '').trim().slice(0, 80), t.d === true, now]));
    }
    return out({ ok: true });
  } finally { lock.releaseLock(); }
}
