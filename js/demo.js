// API_URL が未設定のときに使う、ブラウザ内だけで動く偽サーバー。
// 応答の形は gas/Code.gs と同じにしてあるので、画面側のコードはどちらでも同じ経路を通る。
(() => {
  'use strict';
  const DB_KEY = 'ls_demo_answers_v2';
  const MIN_CHOICES = (window.SURVEY_CONFIG && window.SURVEY_CONFIG.MIN_CHOICES) || 3;
  const TOKEN_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;

  const POPULARITY = {
    'ic-comm': 9, 'is-computer': 9, 'mp-media': 8, 'is-agent': 7, 'ic-network': 6,
    'si-math': 6, 'mp-sound': 5, 'ic-wireless': 5, 'is-kansei': 5, 'mp-optics': 4,
    'si-circuit': 4, 'ic-netdesign': 4, 'is-km': 3, 'is-or': 3, 'mp-bio': 3,
    'si-dynamics': 3, 'si-control': 3, 'ee-machine': 3, 'md-device': 3,
  };

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 回答者は GPA の高い人に偏りがち、という想定で学科平均(2.41)より高めに作る
  function seededRows() {
    const rand = mulberry32(20261123);
    const ids = window.LAB_AREAS.flatMap(a => a.labs.map(l => l.id));
    const weight = id => POPULARITY[id] || (id.startsWith('ge-') ? 0.8 : 2);
    const rows = [];
    for (let i = 0; i < 64; i++) {
      const u = Math.max(rand(), 1e-9), v = rand();
      const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const g = Math.round(Math.min(4, Math.max(0.8, 2.7 + normal * 0.6)) * 100) / 100;
      const n = 3 + Math.floor(rand() * 6);
      const pool = ids.slice();
      const prefs = [];
      while (prefs.length < n) {
        const total = pool.reduce((s, id) => s + weight(id), 0);
        let x = rand() * total, k = 0;
        while ((x -= weight(pool[k])) > 0) k++;
        prefs.push(pool.splice(k, 1)[0]);
      }
      rows.push([g, prefs]);
    }
    return rows;
  }

  const SEEDED = seededRows();

  function load() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* 保存できなくてもデモは続行 */ }
  }

  function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(bytes, b => TOKEN_CHARS[b % TOKEN_CHARS.length]).join('');
  }

  function results(db, token) {
    const rows = SEEDED.map(r => ({ r, me: false }));
    Object.keys(db).forEach(k => rows.push({ r: [db[k].gpa, db[k].prefs], me: k === token }));
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    return { n: rows.length, rows: rows.map(x => x.r), me: rows.findIndex(x => x.me), at: new Date().toISOString() };
  }

  function handle(req) {
    if (!String(req.pass || '').trim()) return { ok: false, error: 'bad_pass' };
    const hasToken = req.token !== undefined && req.token !== null && req.token !== '';
    const token = String(req.token || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (hasToken && !TOKEN_RE.test(token)) return { ok: false, error: 'bad_token' };
    const db = load();
    if (hasToken && !db[token]) return { ok: false, error: 'bad_token' };

    if (req.action === 'login') {
      if (!hasToken) return { ok: true, exists: false };
      return { ok: true, exists: true, token, answer: { gpa: db[token].gpa, prefs: db[token].prefs }, results: results(db, token) };
    }
    if (req.action === 'submit') {
      const gpa = Number(req.gpa);
      if (req.gpa === null || !isFinite(gpa) || gpa < 0 || gpa > 4) return { ok: false, error: 'bad_gpa' };
      const prefs = req.prefs;
      if (!Array.isArray(prefs) || prefs.length < MIN_CHOICES || new Set(prefs).size !== prefs.length) {
        return { ok: false, error: 'bad_prefs' };
      }
      const t = hasToken ? token : newToken();
      db[t] = { gpa: Math.round(gpa * 100) / 100, prefs: prefs.slice() };
      save(db);
      return { ok: true, token: t, answer: { gpa: db[t].gpa, prefs: db[t].prefs }, results: results(db, t) };
    }
    return { ok: false, error: 'bad_request' };
  }

  window.DemoServer = {
    handle: req => new Promise(resolve => setTimeout(() => resolve(handle(req)), 300)),
  };
})();
