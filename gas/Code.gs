/**
 * 研究室事前調査のバックエンド(Google Apps Script)
 *
 * スプレッドシートの「拡張機能 > Apps Script」に貼り付けて使う。手順は README.md を参照。
 * 名前や学籍番号は扱わない。初回送信時に発行する「回答コード」のハッシュ、GPA、希望順位、日時だけを残す。
 */

// クラスで共有する合言葉。必ず変更してから setup を実行すること。
const ACCESS_CODE = 'ここを合言葉に変更';

// 送信に必要な希望の最小数。js/config.js の MIN_CHOICES と揃えること。
const MIN_CHOICES = 3;

const MAX_CHOICES = 40;
const SHEET_NAME = 'responses';
const HEADER = ['token_hash', 'gpa', 'prefs', 'updated_at', 'created_at'];
const TOKEN_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const TOKEN_LENGTH = 10;
const TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;
const MAX_NEW_PER_MINUTE = 60;
const UNSET_CODE = 'ここを合言葉に変更';

/** 最初に一度だけエディタから実行する。シートの用意とハッシュ用の秘密値の生成をする。 */
function setup() {
  if (ACCESS_CODE === UNSET_CODE) throw new Error('ACCESS_CODE を合言葉に書き換えてから実行してください。');
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid() + Utilities.getUuid());
  getSheet_();
  console.log('準備ができました。続けて「デプロイ > 新しいデプロイ」からウェブアプリとして公開してください。');
}

function doGet() {
  return json_({ ok: true, service: 'lab-survey' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    return json_(handle_(req || {}));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function handle_(req) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT');
  if (!salt || ACCESS_CODE === UNSET_CODE) return { ok: false, error: 'server_not_configured' };
  if (String(req.pass || '').trim() !== ACCESS_CODE) return { ok: false, error: 'bad_pass' };

  const hasToken = req.token !== undefined && req.token !== null && req.token !== '';
  const token = String(req.token || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (hasToken && !TOKEN_RE.test(token)) return { ok: false, error: 'bad_token' };

  if (req.action === 'login') {
    if (!hasToken) return { ok: true, exists: false };
    const sheet = getSheet_();
    const hash = tokenHash_(salt, token);
    const found = findRow_(sheet, hash);
    if (!found) return { ok: false, error: 'bad_token' };
    return { ok: true, exists: true, token: token, answer: found.answer, results: results_(sheet, hash) };
  }

  if (req.action === 'submit') {
    const gpa = Number(req.gpa);
    if (req.gpa === null || req.gpa === '' || !isFinite(gpa) || gpa < 0 || gpa > 4) return { ok: false, error: 'bad_gpa' };
    const prefs = req.prefs;
    if (!Array.isArray(prefs) || prefs.length < MIN_CHOICES || prefs.length > MAX_CHOICES) return { ok: false, error: 'bad_prefs' };
    const seen = {};
    for (let i = 0; i < prefs.length; i++) {
      const p = prefs[i];
      if (typeof p !== 'string' || !/^[a-z0-9-]{1,40}$/.test(p) || seen[p]) return { ok: false, error: 'bad_prefs' };
      seen[p] = true;
    }
    const g = Math.round(gpa * 100) / 100;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
    try {
      const sheet = getSheet_();
      const now = new Date();
      let t = token;
      let hash;
      if (hasToken) {
        hash = tokenHash_(salt, t);
        const found = findRow_(sheet, hash);
        if (!found) return { ok: false, error: 'bad_token' };
        sheet.getRange(found.row, 2, 1, 3).setValues([[g, JSON.stringify(prefs), now]]);
      } else {
        const cache = CacheService.getScriptCache();
        const minuteKey = 'new:' + Math.floor(Date.now() / 60000);
        const created = Number(cache.get(minuteKey) || 0);
        if (created >= MAX_NEW_PER_MINUTE) return { ok: false, error: 'busy' };
        cache.put(minuteKey, String(created + 1), 120);
        do {
          t = newToken_();
          hash = tokenHash_(salt, t);
        } while (findRow_(sheet, hash));
        sheet.appendRow([hash, g, JSON.stringify(prefs), now, now]);
      }
      SpreadsheetApp.flush();
      return { ok: true, token: t, answer: { gpa: g, prefs: prefs }, results: results_(sheet, hash) };
    } finally {
      lock.releaseLock();
    }
  }

  return { ok: false, error: 'bad_request' };
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.getRange('A:A').setNumberFormat('@');
    sheet.getRange('C:C').setNumberFormat('@');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (!v[0]) continue;
    let prefs;
    try { prefs = JSON.parse(v[2]); } catch (err) { continue; }
    if (!Array.isArray(prefs)) continue;
    rows.push({ row: i + 1, hash: String(v[0]), gpa: Number(v[1]), prefs: prefs });
  }
  return rows;
}

function findRow_(sheet, hash) {
  const rows = readRows_(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].hash === hash) return { row: rows[i].row, answer: { gpa: rows[i].gpa, prefs: rows[i].prefs } };
  }
  return null;
}

/** 公開用の集計。誰の回答か分からないよう、ハッシュを外して並び順をシャッフルする。 */
function results_(sheet, hash) {
  const rows = readRows_(sheet).map(r => ({ g: r.gpa, p: r.prefs, me: r.hash === hash }));
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = rows[i]; rows[i] = rows[j]; rows[j] = t;
  }
  return {
    n: rows.length,
    rows: rows.map(r => [r.g, r.p]),
    me: rows.findIndex(r => r.me),
    at: new Date().toISOString(),
  };
}

function newToken_() {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Utilities.getUuid() + Date.now(),
    Utilities.Charset.UTF_8);
  let s = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) s += TOKEN_CHARS[(bytes[i] & 0xff) % TOKEN_CHARS.length];
  return s;
}

function tokenHash_(salt, token) {
  return sha256_(salt + ':token:' + token);
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
