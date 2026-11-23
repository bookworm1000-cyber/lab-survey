(() => {
  'use strict';

  const CFG = window.SURVEY_CONFIG || {};
  const MIN = CFG.MIN_CHOICES || 3;
  const DEMO = !CFG.API_URL;
  const VEIL = CFG.HOLD_TO_REVEAL !== false;
  const COH = CFG.COHORT && Array.isArray(CFG.COHORT.pct) && CFG.COHORT.pct.length === 8 && CFG.COHORT.size > 0
    ? CFG.COHORT : null;
  const AREAS = window.LAB_AREAS;
  const LABS = [];
  const LAB = {};
  AREAS.forEach(area => area.labs.forEach(lab => { lab.area = area; LABS.push(lab); LAB[lab.id] = lab; }));

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const span = (a, b) => (a === b ? `${a}` : `${a}〜${b}`);
  const cents = g => Math.round(g * 100);
  const gpaSeats = lab => [Math.floor(lab.min / 2), Math.floor(lab.max / 2)];
  const binIndex = g => Math.min(7, Math.floor(cents(g) / 50));
  const TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;
  const normToken = v => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const fmtToken = t => `${t.slice(0, 5)}-${t.slice(5)}`;

  const store = kind => ({
    get(k) { try { return window[kind].getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window[kind].setItem(k, v); } catch (e) { /* 保存できない環境では回答コードを控えてもらう */ } },
    del(k) { try { window[kind].removeItem(k); } catch (e) { /* 同上 */ } },
  });
  const local = store('localStorage');

  const S = {
    screen: 'login',
    token: '',
    gpa: null, prefs: [],
    answer: null, A: null,
    busy: false, error: '', tokenError: '',
    issued: false, showCode: false,
    sortAll: 'area', open: new Set(), intro: false,
  };

  const ERRORS = {
    bad_token: '回答コードが見つかりません。入力に誤りがないか確かめてください。',
    bad_gpa: 'GPAは0.00〜4.00の範囲で入力してください。',
    bad_prefs: `希望は${MIN}つ以上、重複なしで選んでください。`,
    busy: '送信が混み合っています。数秒おいて、もう一度送信してください。',
    server_not_configured: 'サーバーの設定が終わっていません。アンケートの管理者に連絡してください。',
    server_error: 'サーバーでエラーが起きました。少し時間をおいてやり直してください。',
    network: '通信できませんでした。電波の良い場所で、もう一度やり直してください。',
    bad_request: 'リクエストの形式が正しくありません。ページを再読み込みしてください。',
  };
  const errorText = code => ERRORS[code] || ERRORS.server_error;

  // ---------- 通信 ----------

  async function call(action, extra = {}) {
    const body = Object.assign({ action }, S.token ? { token: S.token } : {}, extra);
    if (DEMO) return window.DemoServer.handle(body);
    let res;
    try {
      // text/plain にするとプリフライトが発生せず、Apps Script でも CORS が通る
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, error: 'network' };
    }
    if (!res.ok) return { ok: false, error: 'network' };
    try { return await res.json(); } catch (e) { return { ok: false, error: 'server_error' }; }
  }

  // ---------- 集計 ----------

  // 回答者の GPA の偏りを学科全体の分布で補正する重み。
  // 0.5 刻みの階級ごとに「学科全体での人数 ÷ 回答者数」を各回答者の重みにする(極端な値は丸める)。
  function applyWeights(rows) {
    if (!COH || !rows.length) return false;
    const group = new Array(8);
    const share = [];
    let pending = [];
    for (let i = 0; i < 8; i++) {
      if (COH.pct[i] > 0) {
        share.push(COH.pct[i]);
        pending.concat(i).forEach(j => { group[j] = share.length - 1; });
        pending = [];
      } else {
        pending.push(i);
      }
    }
    if (!share.length) return false;
    pending.forEach(j => { group[j] = share.length - 1; });
    const counts = share.map(() => 0);
    rows.forEach(r => { counts[group[binIndex(r.g)]]++; });
    const base = COH.size / rows.length;
    const w = share.map((p, k) => (counts[k]
      ? Math.min(base * 3, Math.max(base / 3, (COH.size * p) / 100 / counts[k]))
      : 0));
    rows.forEach(r => { r.w = w[group[binIndex(r.g)]]; });
    return rows.length < COH.size * 0.9;
  }

  function analyze(results) {
    const rows = (results.rows || []).map(([g, p], i) => ({
      g: Number(g),
      p: (Array.isArray(p) ? p : []).filter(id => LAB[id]),
      me: i === results.me,
      w: 1,
    }));
    const byFirst = {};
    const counts = {};
    LABS.forEach(l => { byFirst[l.id] = []; counts[l.id] = [0, 0, 0]; });
    rows.forEach(r => {
      if (r.p[0]) byFirst[r.p[0]].push(r);
      r.p.slice(0, 3).forEach((id, k) => { counts[id][k]++; });
    });
    Object.values(byFirst).forEach(list => list.sort((a, b) => b.g - a.g));
    const est = applyWeights(rows);
    return { rows, byFirst, counts, est, n: rows.length, at: results.at ? new Date(results.at) : new Date() };
  }

  function judge(lab, rank, k) {
    const [gs, gm] = gpaSeats(lab);
    if (k <= lab.min) return 'fit';
    if (rank <= gs) return 'gpa';
    if (rank <= gm) return 'edge';
    return 'sel';
  }

  function standing(labId) {
    const lab = LAB[labId];
    const mine = cents(S.answer.gpa);
    const others = S.A.byFirst[labId].filter(r => !r.me);
    const higher = others.filter(r => cents(r.g) > mine).length;
    const ties = others.filter(r => cents(r.g) === mine).length;
    const k = others.length + 1;
    const rank = higher + 1;
    const [gs, gm] = gpaSeats(lab);
    return { lab, others, higher, ties, k, rank, gs, gm, status: judge(lab, rank, k) };
  }

  function estimate(st) {
    if (!S.A.est) return null;
    const mine = cents(S.answer.gpa);
    let higher = 0;
    let total = 1;
    st.others.forEach(r => {
      total += r.w;
      if (cents(r.g) > mine) higher += r.w;
    });
    const rank = 1 + Math.round(higher);
    const k = Math.max(rank, Math.round(total));
    return { rank, k, status: judge(st.lab, rank, k) };
  }

  // 学科全体の分布から、自分より GPA が高い人の割合(%)を出す。階級の中は一様に分布すると仮定。
  function cohortShareAbove(g) {
    let above = 0;
    COH.pct.forEach((p, i) => {
      const lo = i * 0.5, hi = lo + 0.5;
      if (g < lo) above += p;
      else if (g < hi) above += (p * (hi - g)) / 0.5;
    });
    return above;
  }

  // 配属のモンテカルロ・シミュレーション。1回ごとに次の手順で配属を決め、あなたがどこに入ったかを数える。
  //  1. 各研究室の定員を目安の範囲からランダムに決める
  //  2. 第1希望者のうち GPA 上位(定員の半分)を確定。残りの枠は志望理由書などで決まるため、ランダムに選ぶ
  //  3. 決まらなかった人を GPA の高い順に並べ、空きのある研究室のうち希望順位がいちばん高いところに入れていく
  // 回答者が学年の9割に満たないときは、回答者を重み付きで復元抽出して学年の人数分の集団を作る。
  const SIM_MIN_OTHERS = 9;
  function simulate(iterations) {
    const others = S.A.rows.filter(r => !r.me && r.p.length);
    if (others.length < SIM_MIN_OTHERS) return null;
    const mine = S.answer.prefs.filter(id => LAB[id]);
    const index = {};
    LABS.forEach((l, i) => { index[l.id] = i; });
    const resample = S.A.est;
    const cum = [];
    let total = 0;
    others.forEach(r => { total += r.w; cum.push(total); });
    const size = resample ? Math.max(others.length, COH.size - 1) : others.length;
    const pick = () => {
      const x = Math.random() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
      return others[lo];
    };
    const byGpa = (a, b) => b.g - a.g || b.t - a.t;
    const hits = new Array(mine.length + 1).fill(0);
    let gpaSeat = 0;
    const leftAfterFirst = new Array(LABS.length).fill(0);

    for (let it = 0; it < iterations; it++) {
      const me = { g: S.answer.gpa, p: mine, t: Math.random(), lab: -1, me: true };
      const people = [me];
      for (let i = 0; i < size; i++) {
        const r = resample ? pick() : others[i];
        people.push({ g: r.g, p: r.p, t: Math.random(), lab: -1 });
      }
      const seats = LABS.map(l => l.min + Math.floor(Math.random() * (l.max - l.min + 1)));
      const first = LABS.map(() => []);
      people.forEach(s => { if (s.p[0]) first[index[s.p[0]]].push(s); });
      first.forEach((list, L) => {
        list.sort(byGpa);
        const byGrade = Math.min(list.length, Math.floor(seats[L] / 2));
        for (let i = 0; i < byGrade; i++) list[i].lab = L;
        if (me.lab === L) gpaSeat++;
        const rest = list.slice(byGrade);
        const open = seats[L] - byGrade;
        for (let i = 0; i < Math.min(open, rest.length); i++) {
          const j = i + Math.floor(Math.random() * (rest.length - i));
          [rest[i], rest[j]] = [rest[j], rest[i]];
          rest[i].lab = L;
        }
        seats[L] = open - Math.min(open, rest.length);
        leftAfterFirst[L] += seats[L];
      });
      people.filter(s => s.lab < 0).sort(byGpa).forEach(s => {
        for (let k = 1; k < s.p.length; k++) {
          const L = index[s.p[k]];
          if (seats[L] > 0) { seats[L]--; s.lab = L; break; }
        }
      });
      if (me.lab < 0) hits[mine.length]++;
      else hits[mine.indexOf(LABS[me.lab].id)]++;
    }
    return {
      iterations,
      resample,
      share: hits.map(h => h / iterations),
      gpaSeat: gpaSeat / iterations,
      left: leftAfterFirst.map(v => v / iterations),
    };
  }

  // ---------- 部品 ----------

  const FIG = '<svg class="fig" viewBox="0 0 20 28" aria-hidden="true"><circle cx="10" cy="7" r="5"/><path d="M2 27v-5a8 8 0 0 1 16 0v5z"/></svg>';
  const ICON = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10.5 8 6l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5.5 8 10l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  // 他の人のデータを包む。結果画面では押している(カーソルを合わせている)間だけ中身が見える。
  // inline はボタンの中に置く場合で、span で組み、フォーカスはボタン側に任せる。
  function veil(html, inline) {
    if (!VEIL) return html;
    const tag = inline ? 'span' : 'div';
    return `<${tag} class="veil"${inline ? '' : ' tabindex="0"'}><${tag} class="veil-body">${html}</${tag}>
      <span class="veil-cover" aria-hidden="true"><span class="hint-touch">押している間だけ表示</span><span class="hint-mouse">カーソルを合わせると表示</span></span></${tag}>`;
  }

  // 7セグメント表示。セグメントは六角形、桁全体を少し斜体にする。
  const SEG = (() => {
    const t = 10, h = t / 2, L = 6, R = 54, TOP = 6, MID = 52, BOT = 98, G = 2;
    const hz = (c, x1, x2) => `${x1},${c} ${x1 + h},${c - h} ${x2 - h},${c - h} ${x2},${c} ${x2 - h},${c + h} ${x1 + h},${c + h}`;
    const vt = (c, y1, y2) => `${c},${y1} ${c + h},${y1 + h} ${c + h},${y2 - h} ${c},${y2} ${c - h},${y2 - h} ${c - h},${y1 + h}`;
    return {
      a: hz(TOP, L + G, R - G), g: hz(MID, L + G, R - G), d: hz(BOT, L + G, R - G),
      f: vt(L, TOP + G, MID - G), b: vt(R, TOP + G, MID - G),
      e: vt(L, MID + G, BOT - G), c: vt(R, MID + G, BOT - G),
    };
  })();
  const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

  function digit(ch, x) {
    const lit = ch === '-' ? 'g' : DIGITS[Number(ch)];
    return `<g transform="translate(${x} 0)">${Object.keys(SEG).map(k =>
      `<polygon points="${SEG[k]}" class="${lit.includes(k) ? 'on' : 'off'}"/>`).join('')}</g>`;
  }

  function sevenSeg(g) {
    const s = g == null ? '-.--' : g.toFixed(2);
    return `<svg class="seg" viewBox="-2 -2 226 108" aria-hidden="true"><g transform="translate(14 0) skewX(-7)">
      ${digit(s[0], 0)}<circle cx="72" cy="97" r="6" class="${g == null ? 'off' : 'on'}"/>${digit(s[2], 86)}${digit(s[3], 156)}
    </g></svg>`;
  }

  function meterHTML() {
    const label = S.gpa == null ? 'GPA 未入力' : `GPA ${S.gpa.toFixed(2)}`;
    return `<div class="meter" role="img" aria-label="${label}">
      <span class="meter-label">GPA</span>${sevenSeg(S.gpa)}<span class="meter-max">/ 4.00</span>
    </div>`;
  }

  function topbar(buttons) {
    return `<header class="topbar"><div class="topbar-inner">
      <p class="topbar-title">研究室事前調査</p>
      <nav class="topbar-nav">${buttons}</nav>
    </div></header>`;
  }

  // ---------- はじめの画面 ----------

  function seatsDemo() {
    const seat = z => `<li class="seat z-${z}">${FIG}</li>`;
    return `<div class="rule-figure" aria-hidden="true">
      <div><ol class="seats">${seat('gpa').repeat(4)}</ol><p>GPA順で決まる</p></div>
      <div><ol class="seats">${seat('sel').repeat(4)}</ol><p>志望理由書などで選考</p></div>
    </div>`;
  }

  function renderLogin() {
    $app.innerHTML = `
    <main class="wrap login">
      <header class="masthead">
        <p class="dept">電気電子情報工学科</p>
        <h1>研究室事前調査</h1>
        <p class="lede">希望順位とGPAを匿名で集めて、各研究室の第1希望者のなかで自分が何番目にいるかを確かめるためのアンケートです。名前や学籍番号は聞きません。結果は回答した人だけが見られます。</p>
      </header>

      <section class="rule">
        <h2>配属の決まり方</h2>
        <p>各研究室の定員のうち上位半分は、第1希望者のなかからGPA順で決まります。残りの枠は、志望理由書などをもとに教員ごとに選考されます。</p>
        ${seatsDemo()}
        <p>第1希望で決まらなかった人は、GPAの高い人から順に、まだ空きのある研究室のうち希望順位がいちばん高いところに決まっていきます。</p>
      </section>

      <div class="panel login-panel">
        <p class="form-error" role="alert">${esc(S.error)}</p>
        <button type="button" class="btn primary wide-btn" data-act="start" ${S.busy ? 'disabled' : ''}>回答をはじめる</button>
        <p class="fine">送信すると「回答コード」が発行され、この端末に保存されます。回答の修正と結果の閲覧はこのコードで行います。</p>

        <details class="restore"${S.tokenError ? ' open' : ''}>
          <summary>別の端末で回答した人は、回答コードで入る</summary>
          <label class="field">
            <span class="field-label">回答コード</span>
            <input id="token-in" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14" placeholder="例 K7QF2-M2XAP" enterkeyhint="go">
          </label>
          <p class="form-error" role="alert">${esc(S.tokenError)}</p>
          <button type="button" class="btn ghost wide-btn" data-act="restore" ${S.busy ? 'disabled' : ''}>回答コードで入る</button>
        </details>
      </div>
      ${DEMO ? `<p class="demo-note">デモモードで動いています。サーバーのURLが未設定のため、架空の回答64件と、このブラウザで入力した回答だけで集計します。</p>` : ''}
    </main>`;
  }

  function start() {
    S.token = ''; S.error = ''; S.tokenError = '';
    S.answer = null;
    const draft = readDraft();
    S.gpa = draft ? draft.gpa : null;
    S.prefs = draft ? draft.prefs.filter(id => LAB[id]) : [];
    go('form');
  }

  async function enterWithToken(token, fromStorage) {
    S.token = token; S.error = ''; S.tokenError = ''; S.busy = true;
    if (S.screen === 'login') renderLogin();
    const r = await call('login');
    S.busy = false;
    if (!r.ok || !r.exists) {
      S.token = '';
      const code = r.ok ? 'bad_token' : r.error;
      if (code === 'bad_token') {
        if (fromStorage) local.del('ls_token');
        S.tokenError = fromStorage ? 'この端末に保存されていた回答コードが見つかりませんでした。控えた回答コードを入力するか、回答し直してください。' : ERRORS.bad_token;
      } else {
        S.error = errorText(code);
      }
      S.screen = 'login';
      render();
      return;
    }
    S.token = r.token;
    local.set('ls_token', S.token);
    S.answer = r.answer;
    S.gpa = r.answer.gpa;
    S.prefs = r.answer.prefs.filter(id => LAB[id]);
    S.A = analyze(r.results);
    go('results');
  }

  function restore() {
    const token = normToken(document.getElementById('token-in').value);
    if (!TOKEN_RE.test(token)) {
      S.tokenError = '回答コードは英数字10文字です(ハイフンはあってもなくても構いません)。';
      S.error = '';
      renderLogin();
      return;
    }
    enterWithToken(token, false);
  }

  function logout() {
    const msg = 'この端末から回答コードを消します。回答コードを控えていないと、あとで回答を修正したり結果を見たりできなくなります。消してよろしいですか?';
    if (!window.confirm(msg)) return;
    local.del('ls_token');
    Object.assign(S, { token: '', gpa: null, prefs: [], answer: null, A: null, error: '', tokenError: '', issued: false, showCode: false, open: new Set() });
    go('login');
  }

  // ---------- 回答フォーム ----------

  function readDraft() {
    try {
      const d = JSON.parse(local.get('ls_draft'));
      if (d && Array.isArray(d.prefs)) return { gpa: typeof d.gpa === 'number' ? d.gpa : null, prefs: d.prefs };
    } catch (e) { /* 壊れた下書きは無視 */ }
    return null;
  }
  function saveDraft() {
    if (!S.answer) local.set('ls_draft', JSON.stringify({ gpa: S.gpa, prefs: S.prefs }));
  }

  function picksHTML() {
    if (!S.prefs.length) {
      return '<li class="pick-empty">まだ選んでいません。下の一覧から、いちばん行きたい研究室をタップしてください。</li>';
    }
    return S.prefs.map((id, i) => {
      const l = LAB[id];
      return `<li class="pick">
        <span class="pick-no" aria-label="第${i + 1}希望">${i + 1}</span>
        <span class="pick-name">${esc(l.name)}<small>${esc(l.prof)}　定員${span(l.min, l.max)}</small></span>
        <span class="pick-tools">
          <button type="button" class="icon-btn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(l.name)}を1つ上へ">${ICON.up}</button>
          <button type="button" class="icon-btn" data-act="down" data-i="${i}" ${i === S.prefs.length - 1 ? 'disabled' : ''} aria-label="${esc(l.name)}を1つ下へ">${ICON.down}</button>
          <button type="button" class="icon-btn" data-act="remove" data-i="${i}" aria-label="${esc(l.name)}を外す">${ICON.remove}</button>
        </span>
      </li>`;
    }).join('');
  }

  function pickerHTML() {
    return AREAS.map(area => `
      <fieldset class="area">
        <legend>${esc(area.name)}</legend>
        <div class="chips">${area.labs.map(l => {
          const i = S.prefs.indexOf(l.id);
          const picked = i >= 0;
          return `<button type="button" class="chip${picked ? ' picked' : ''}" data-act="add" data-id="${l.id}"${picked ? ' aria-disabled="true"' : ''}>
            <span class="chip-name">${esc(l.name)}</span>
            <span class="chip-sub">${esc(l.prof)}　定員${span(l.min, l.max)}</span>
            ${picked ? `<span class="chip-rank">第${i + 1}希望</span>` : ''}
          </button>`;
        }).join('')}</div>
      </fieldset>`).join('');
  }

  function submitbarHTML() {
    const n = S.prefs.length;
    const ready = S.gpa != null && n >= MIN && !S.busy;
    const missing = [];
    if (S.gpa == null) missing.push('GPA');
    if (n < MIN) missing.push(`希望あと${MIN - n}件`);
    return `<div class="submitbar-inner">
      <p class="sb-state">
        <span>GPA <b>${S.gpa == null ? '未入力' : S.gpa.toFixed(2)}</b></span>
        <span>希望 <b>${n}</b>件</span>
        ${missing.length ? `<span class="sb-missing">未入力: ${missing.join('、')}</span>` : ''}
      </p>
      <button type="button" class="btn primary" data-act="submit" ${ready ? '' : 'disabled'}>${S.busy ? '送信しています…' : '送信して結果を見る'}</button>
    </div>
    <p class="sb-fine">誰の回答かは分からない形で、GPAと希望順位だけがみんなの結果に反映されます。</p>`;
  }

  function renderForm() {
    const editing = !!S.answer;
    $app.innerHTML = `
    ${topbar(editing
      ? '<button type="button" class="btn ghost" data-act="back">結果に戻る</button>'
      : '<button type="button" class="btn ghost" data-act="home">はじめに戻る</button>')}
    <main class="wrap form-screen">
      <h1 class="screen-title">${editing ? '回答を修正する' : '回答する'}</h1>
      ${editing ? '<p class="lede">修正して送信し直すと、前の回答は置き換わります。</p>' : ''}
      <div class="form-grid">
        <section class="block gpa-block" aria-labelledby="gpa-h">
          <h2 id="gpa-h">GPA</h2>
          <p class="hint">通算GPAを小数第2位まで入力してください。</p>
          <div id="meter-slot" data-act="focus-gpa">${meterHTML()}</div>
          <label class="gpa-input">
            <span class="sr">通算GPA</span>
            <input id="gpa-text" type="text" inputmode="decimal" autocomplete="off" maxlength="5" placeholder="例 3.42"
              value="${S.gpa == null ? '' : S.gpa.toFixed(2)}" aria-describedby="gpa-msg">
          </label>
          <p class="gpa-msg" id="gpa-msg" role="alert"></p>
        </section>

        <section class="block prefs-block" aria-labelledby="pref-h">
          <h2 id="pref-h">希望順位</h2>
          <p class="hint">行きたい研究室を、第1希望から順にタップしてください。${MIN}つ以上選ぶと送信できます。グリーンエレクトロニクス工学科の研究室も選べます。</p>
          <ol class="picks" id="picks">${picksHTML()}</ol>
          <div class="picker" id="picker">${pickerHTML()}</div>
        </section>
      </div>
    </main>
    <div class="submitbar" id="submitbar">${submitbarHTML()}</div>`;
  }

  // 入力途中の「3.」なども通し、確定できる値になった時点でメーターに反映する
  function gpaTyped(raw) {
    const s = raw.trim().replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    let msg = '';
    if (s === '') S.gpa = null;
    else if (/^(\d(\.\d{0,2})?|\.\d{1,2})$/.test(s) && Number(s) <= 4) S.gpa = cents(Number(s)) / 100;
    else { S.gpa = null; msg = ERRORS.bad_gpa; }
    document.getElementById('meter-slot').innerHTML = meterHTML();
    document.getElementById('gpa-msg').textContent = msg;
    document.getElementById('submitbar').innerHTML = submitbarHTML();
    saveDraft();
  }

  function prefsChanged(focusSel) {
    document.getElementById('picks').innerHTML = picksHTML();
    document.getElementById('picker').innerHTML = pickerHTML();
    document.getElementById('submitbar').innerHTML = submitbarHTML();
    saveDraft();
    if (focusSel) {
      const el = document.querySelector(focusSel);
      if (!el) return;
      const target = el.disabled ? el.parentElement.querySelector('button:not(:disabled)') : el;
      if (target) target.focus({ preventScroll: true });
    }
  }

  async function submit() {
    if (S.busy || S.gpa == null || S.prefs.length < MIN) return;
    S.busy = true;
    document.getElementById('submitbar').innerHTML = submitbarHTML();
    const r = await call('submit', { gpa: S.gpa, prefs: S.prefs });
    S.busy = false;
    if (!r.ok) {
      document.getElementById('submitbar').innerHTML = submitbarHTML();
      toast(errorText(r.error));
      return;
    }
    local.del('ls_draft');
    S.issued = !S.token;
    S.token = r.token;
    local.set('ls_token', S.token);
    S.answer = r.answer;
    S.A = analyze(r.results);
    go('results');
    toast('送信しました。');
  }

  // ---------- 結果 ----------

  function seat(zone, rank, person, opts = {}) {
    if (!person && !opts.me) {
      return `<li class="seat z-${zone} empty"><span class="sr">空き席</span>${FIG}<span class="g">空き</span></li>`;
    }
    const g = opts.me ? S.answer.gpa : person.g;
    const cls = `seat z-${zone}${opts.me ? ' me' : ''}${opts.ghost ? ' ghost' : ''}`;
    const tag = opts.me ? '<span class="you-tag">あなた<i></i></span>' : '';
    return `<li class="${cls}"><span class="sr">${rank}位 GPA ${g.toFixed(2)}${opts.me ? '(あなた)' : ''}</span>${tag}${FIG}<span class="g">${g.toFixed(2)}</span></li>`;
  }

  const STATUS = { fit: '◎ 定員内', gpa: '○ GPA枠内', edge: '△ GPA枠のボーダー', sel: '● 選考枠' };

  function explain(st, ghost) {
    const { lab, k, gs, gm, status } = st;
    if (status === 'fit') return `${ghost ? 'あなたを加えても' : '回答者のうち'}第1希望者は${k}人で、定員の下限${lab.min}人以内に収まっています。`;
    if (status === 'gpa') return `GPA枠(${span(gs, gm)}席)の内側です。回答者のなかでは、GPAで配属が確定する位置にいます。`;
    if (status === 'edge') return `GPA枠は定員しだいで${gs}席か${gm}席になります。${gm}席になればGPAで確定し、${gs}席なら選考枠にまわります。`;
    return `GPA枠の外側です。残りの選考枠${span(lab.min - gs, lab.max - gm)}席を、GPA枠に入らなかった${span(k - gm, k - gs)}人で争う見込みです。志望理由書などが決め手になります。`;
  }

  function lane(labId, { nth = 0, ghost = false, veiled = true } = {}) {
    const st = standing(labId);
    const { lab, others, higher, ties, k, rank, gs, gm, status } = st;
    const est = estimate(st);
    const list = others.slice();
    list.splice(higher, 0, null);
    const zoneOf = r => (r <= gs ? 'gpa' : r <= gm ? 'edge' : 'sel');
    const cell = (x, idx) => (x === null
      ? seat(zoneOf(idx + 1), idx + 1, null, { me: true, ghost })
      : seat(zoneOf(idx + 1), idx + 1, x));
    const rowA = list.slice(0, gm);
    const rowB = list.slice(gm);
    let seatsA = rowA.map((x, i) => cell(x, i)).join('');
    for (let i = rowA.length; i < gm; i++) seatsA += seat(zoneOf(i + 1), i + 1, null);
    let seatsB = rowB.map((x, i) => cell(x, gm + i)).join('');
    for (let i = rowB.length; i < lab.max - gm; i++) seatsB += seat('sel', gm + i + 1, null);
    const meInA = higher < gm;
    const rankOf = ghost ? `回答者のうち第1希望者${k - 1}人にあなたを加えた場合` : `回答者のうち第1希望者${k}人中`;
    const rows = `<div class="lane-rows">
        <div class="lane-row">
          <p class="row-label">GPA枠 ${span(gs, gm)}席</p>
          <ol class="seats${meInA ? ' has-me' : ''}">${seatsA}</ol>
        </div>
        <div class="lane-row">
          <p class="row-label">選考枠 ${span(lab.min - gs, lab.max - gm)}席<span>候補${rowB.length}人</span></p>
          <ol class="seats${meInA ? '' : ' has-me'}">${seatsB}</ol>
        </div>
      </div>`;

    return `<article class="lane${ghost ? ' is-ghost' : ''}">
      <header class="lane-head">
        ${nth ? `<p class="nth">第${nth}希望</p>` : ''}
        <h3>${esc(lab.name)}</h3>
        <p class="lane-meta"><span>${esc(lab.prof)}</span><span>定員${span(lab.min, lab.max)}人</span></p>
      </header>
      <div class="standing">
        <p class="rank"><span class="rank-num">${rank}</span><span class="rank-unit">位${ghost ? '相当' : ''}</span><span class="rank-of">${rankOf}</span></p>
        <p class="status s-${status}">${STATUS[status]}</p>
      </div>
      <p class="explain">${explain(st, ghost)}${ties ? `同じGPAの人が${ties}人います。` : ''}</p>
      ${est ? `<p class="estimate"><span>学年全員が回答したと仮定すると、約<b>${est.rank}</b>位 / 約${est.k}人</span><span class="status s-${est.status} small">${STATUS[est.status]}</span></p>` : ''}
      ${veiled ? veil(rows) : rows}
    </article>`;
  }

  function legendHTML() {
    return `<ul class="legend">
      <li><span class="sw sw-gpa"></span>GPA枠(GPA順で確定)</li>
      <li><span class="sw sw-edge"></span>定員しだいでGPA枠</li>
      <li><span class="sw sw-sel"></span>選考枠(志望理由書など)</li>
      <li><span class="sw-fig me">${FIG}</span>あなた</li>
      <li><span class="sw-fig empty">${FIG}</span>空き席</li>
    </ul>`;
  }

  const estFirst = labId => S.A.byFirst[labId].reduce((s, r) => s + r.w, 0);

  function labTableHTML() {
    const A = S.A;
    const scale = Math.max(10, ...LABS.map(l => Math.max(A.byFirst[l.id].length, l.max, A.est ? estFirst(l.id) : 0)));
    const pct = v => `${Math.min(100, (v / scale) * 100)}%`;
    const row = lab => {
      const c = A.byFirst[lab.id].length;
      const e = A.est ? Math.round(estFirst(lab.id)) : null;
      const [, c2, c3] = A.counts[lab.id];
      const mine = S.answer.prefs.indexOf(lab.id);
      const open = S.open.has(lab.id);
      const data = `<span class="lt-data">
          <span class="lt-bar" aria-hidden="true">
            ${e != null ? `<span class="lt-est" style="width:${pct(e)}"></span>` : ''}
            <span class="lt-fill" style="width:${pct(c)}"></span>
            <span class="lt-band" style="left:${pct(lab.min)};width:${pct(lab.max - lab.min)}"></span>
          </span>
          <span class="lt-num"><b>${c}</b>人${e != null ? `<small>推定 約${e}人</small>` : ''}<small>定員${span(lab.min, lab.max)}</small></span>
        </span>`;
      return `<li class="lt-row${open ? ' open' : ''}">
        <button type="button" class="lt-main" data-act="toggle-lab" data-id="${lab.id}" aria-expanded="${open}" data-veil-scope>
          <span class="lt-name">${esc(lab.name)}<small>${esc(lab.prof)}${mine >= 0 ? `<em class="mine-tag">あなたの第${mine + 1}希望</em>` : ''}</small></span>
          ${veil(data, true)}
        </button>
        ${open ? `<div class="lt-detail">
          ${veil(`<p class="lt-sub">この研究室を第2希望にした回答者 ${c2}人、第3希望にした回答者 ${c3}人</p>`)}
          ${lane(lab.id, { ghost: S.answer.prefs[0] !== lab.id })}
        </div>` : ''}
      </li>`;
    };
    if (S.sortAll === 'hot') {
      const ratio = l => (A.est ? estFirst(l.id) : A.byFirst[l.id].length) / ((l.min + l.max) / 2);
      return `<ol class="labtable">${LABS.slice().sort((a, b) => ratio(b) - ratio(a)).map(row).join('')}</ol>`;
    }
    return AREAS.map(area => `<h3 class="area-name">${esc(area.name)}</h3><ol class="labtable">${area.labs.map(row).join('')}</ol>`).join('');
  }

  function histogramHTML() {
    const N = 8;
    const A = S.A;
    const counts = new Array(N).fill(0);
    A.rows.forEach(r => { counts[binIndex(r.g)]++; });
    const resp = counts.map(c => (A.n ? (c / A.n) * 100 : 0));
    const coh = COH ? COH.pct : null;
    const W = 400, H = 200, pl = 34, pr = 6, pt = 34, pb = 26;
    const top = Math.ceil(Math.max(5, ...resp, ...(coh || [0])) / 5) * 5;
    const y = v => pt + (H - pt - pb) * (1 - v / top);
    const bw = (W - pl - pr) / N;
    const x = v => pl + (v / 4) * (W - pl - pr);
    const bar = (bx, by, w, h) => {
      if (h <= 0) return '';
      const r = Math.min(3, h, w / 2);
      return `M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + w - r}Q${bx + w},${by} ${bx + w},${by + r}V${by + h}Z`;
    };
    const step = top <= 20 ? 5 : 10;
    let grid = '';
    for (let v = step; v <= top; v += step) {
      grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="h-grid"/><text x="${pl - 6}" y="${y(v) + 4}" class="h-tick" text-anchor="end">${v}%</text>`;
    }
    const bars = resp.map((v, i) => {
      const x0 = pl + i * bw;
      const label = i < N - 1 ? `${(i * 0.5).toFixed(1)}〜${(i * 0.5 + 0.5).toFixed(1)}未満` : '3.5以上';
      let text = `GPA ${label}: 回答者 ${v.toFixed(1)}%(${counts[i]}人)`;
      if (coh) text += ` / 学科全体 ${coh[i]}%(約${Math.round((COH.size * coh[i]) / 100)}人)`;
      const shapes = coh
        ? `<path class="bar" d="${bar(x0 + 3, y(v), bw / 2 - 4, H - pb - y(v))}"/><path class="bar-coh" d="${bar(x0 + bw / 2 + 1, y(coh[i]), bw / 2 - 4, H - pb - y(coh[i]))}"/>`
        : `<path class="bar" d="${bar(x0 + 3, y(v), bw - 6, H - pb - y(v))}"/>`;
      return `<g class="hb" data-text="${esc(text)}" tabindex="0" role="listitem" aria-label="${esc(text)}">
        <rect class="hit" x="${x0}" y="${pt - 12}" width="${bw}" height="${H - pb - pt + 12}"/>${shapes}
      </g>`;
    }).join('');
    const mx = x(Math.min(3.99, S.answer.gpa));
    const xt = [0, 1, 2, 3, 4].map(v => `<text x="${x(v)}" y="${H - 8}" class="h-tick" text-anchor="middle">${v}</text>`).join('');
    return `<ul class="legend">
        <li><span class="sw sw-resp"></span>回答者(${A.n}人)</li>
        ${coh ? `<li><span class="sw sw-coh"></span>${esc(COH.label)}</li>` : ''}
        <li><span class="sw sw-you"></span>あなたのGPA</li>
      </ul>
      <figure class="hist">
        <svg viewBox="0 0 ${W} ${H}" role="list" aria-label="GPA分布(0.5刻み、割合)">
          ${grid}
          <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="h-axis"/>
          ${bars}
          <line x1="${mx}" x2="${mx}" y1="${pt - 8}" y2="${H - pb}" class="h-lead"/>
          <text x="${mx}" y="${pt - 13}" class="h-me" text-anchor="middle">あなた ${S.answer.gpa.toFixed(2)}</text>
          ${xt}
        </svg>
        <figcaption id="hist-cap">棒にカーソルを合わせるかタップすると、その範囲の割合と人数が出ます。</figcaption>
      </figure>`;
  }

  const SIM_ITERATIONS = 400;
  const SIM_TONES = [100, 72, 52, 36];
  function simHTML() {
    if (S.A.sim === undefined) S.A.sim = simulate(SIM_ITERATIONS);
    const sim = S.A.sim;
    if (!sim) {
      return `<section class="sim" aria-labelledby="sim-h"><h2 id="sim-h">配属の見込み</h2>
        <p class="note">他の人の回答が${SIM_MIN_OTHERS}件以上集まると、配属の見込みを計算します。</p></section>`;
    }
    const prefs = S.answer.prefs.filter(id => LAB[id]);
    const pct = p => (p === 0 ? '0%' : p < 0.005 ? '1%未満' : `${Math.round(p * 100)}%`);
    const shown = Math.min(prefs.length, 5);
    const rest = sim.share.slice(shown, prefs.length).reduce((a, b) => a + b, 0);
    const none = sim.share[prefs.length];
    const tone = k => SIM_TONES[k] || 24;
    const items = prefs.slice(0, shown).map((id, k) => ({
      tone: tone(k),
      label: `第${k + 1}希望`,
      name: esc(LAB[id].name),
      note: k === 0
        ? `GPA枠で確定 ${pct(sim.gpaSeat)}、選考枠で合格 ${pct(Math.max(0, sim.share[0] - sim.gpaSeat))}`
        : `第1希望の段階で残る席 平均${sim.left[LABS.indexOf(LAB[id])].toFixed(1)}席`,
      p: sim.share[k],
    }));
    if (prefs.length > shown) items.push({ tone: 24, label: `第${shown + 1}希望以降`, name: '', note: '', p: rest });
    items.push({
      none: true,
      label: '希望外',
      name: '書いた希望のどこにも入らない',
      note: none >= 0.05 ? '希望をもっと書いておくと、空きのある研究室に拾われやすくなります。' : '残りの研究室にまわります。',
      p: none,
    });
    const swatch = it => (it.none ? 'class="sim-sw none"' : `class="sim-sw" style="--tone:${it.tone}%"`);
    const aria = items.map(it => `${it.label}${it.name ? ` ${it.name}` : ''} ${pct(it.p)}`).join('、');
    return `<section class="sim" aria-labelledby="sim-h">
      <h2 id="sim-h">配属の見込み</h2>
      <p class="note">定員(目安の範囲)と選考枠の結果をランダムに変えながら、配属を${sim.iterations}回シミュレーションした割合です。選考枠の合否は予測できないので、第1希望者のなかからくじ引きで決まる扱いにしています。${sim.resample ? 'まだ回答していない人は、回答者を学科全体のGPA分布に合わせて補った仮想の学年で計算しています。' : ''}</p>
      <div class="sim-bar" role="img" aria-label="${aria}">
        ${items.filter(it => it.p > 0).map(it => `<span class="sim-seg${it.none ? ' none' : ''}" style="flex:${it.p} 1 0;--tone:${it.tone || 0}%"></span>`).join('')}
      </div>
      <ol class="sim-list">
        ${items.map(it => `<li${it.none ? ' class="is-none"' : ''}>
          <span ${swatch(it)}></span>
          <span class="sim-k">${it.label}</span>
          <span class="sim-name">${it.name}${it.note ? `<small>${it.note}</small>` : ''}</span>
          <span class="sim-p">${pct(it.p)}</span>
        </li>`).join('')}
      </ol>
    </section>`;
  }

  function codeHTML() {
    const code = fmtToken(S.token);
    if (S.issued) {
      return `<section class="issued" role="status">
        <h2>回答コードを発行しました</h2>
        <p class="code-line"><span class="code">${code}</span><button type="button" class="btn ghost small" data-act="copy-code">コピー</button></p>
        <p>この端末には保存済みです。別の端末から修正・閲覧するときに必要なので、メモしておいてください。他の人には見せないでください。</p>
      </section>`;
    }
    return `<section class="codebox" aria-labelledby="code-h">
      <h2 id="code-h">回答コード</h2>
      <p class="code-line"><span class="code">${S.showCode ? code : '•••••-•••••'}</span>
        <button type="button" class="btn ghost small" data-act="show-code">${S.showCode ? '隠す' : '表示'}</button>
        <button type="button" class="btn ghost small" data-act="copy-code">コピー</button></p>
      <p class="note">別の端末から修正・閲覧するときに使います。他の人には見せないでください。</p>
    </section>`;
  }

  function renderResults() {
    const A = S.A;
    const g = S.answer.gpa;
    const first = S.answer.prefs.find(id => LAB[id]);
    const overall = 1 + A.rows.filter(r => !r.me && cents(r.g) > cents(g)).length;
    const time = A.at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const intro = S.intro;
    S.intro = false;
    let summary = `回答者は${A.n}人です`;
    if (COH) summary += `(学年約${COH.size}人のうち約${Math.round((A.n / COH.size) * 100)}%)`;
    summary += `。あなたのGPA ${g.toFixed(2)} は回答者のなかで${overall}位`;
    if (COH) {
      const above = cohortShareAbove(g);
      const top = above < 1 ? '上位1%以内' : `上位${Math.round(above)}%`;
      summary += `、学科全体の分布から推定すると約${COH.size}人中${1 + Math.round((COH.size * above) / 100)}位前後(${top})`;
    }
    summary += 'です。';

    $app.innerHTML = `
    ${topbar('<button type="button" class="btn ghost" data-act="edit">回答を修正</button><button type="button" class="btn ghost" data-act="logout">ログアウト</button>')}
    <main class="wrap results${intro ? ' intro' : ''}" id="results">
      <section class="summary">
        <h1 class="screen-title">結果</h1>
        <p class="lede">${summary}</p>
        <p class="refresh-line">${time} 時点の集計<button type="button" class="btn ghost small" data-act="refresh" ${S.busy ? 'disabled' : ''}>${S.busy ? '更新しています…' : '最新にする'}</button></p>
      </section>
      ${S.issued ? codeHTML() : ''}

      <section class="mine" aria-labelledby="mine-h">
        <h2 id="mine-h">あなたの第1希望</h2>
        ${legendHTML()}
        <p class="note">人は第1希望者をGPAの高い順に並べています。選考枠はGPA順に決まるとは限りません。${A.est ? '「学年全員が回答したと仮定すると」は、まだ回答していない人も回答者と同じ傾向で志望すると仮定し、学科全体のGPA分布で補正した目安です。' : ''}</p>
        <div class="lanes">${first ? lane(first) : ''}</div>
      </section>

      ${simHTML()}

      <section class="all" aria-labelledby="all-h">
        <div class="section-head">
          <h2 id="all-h">研究室ごとの第1希望者</h2>
          <div class="seg-toggle" role="group" aria-label="並び順">
            <button type="button" data-act="sort" data-sort="area" aria-pressed="${S.sortAll === 'area'}">領域順</button>
            <button type="button" data-act="sort" data-sort="hot" aria-pressed="${S.sortAll === 'hot'}">混雑順</button>
          </div>
        </div>
        <p class="note">濃い棒は回答者のうち第1希望にした人数${A.est ? '、薄い棒は学年全員が回答した場合の推定' : ''}、縦線ではさんだ帯は定員の幅です。研究室をタップすると、あなたがそこを第1希望にした場合の位置が出ます。</p>
        ${labTableHTML()}
      </section>

      <section class="dist" aria-labelledby="dist-h">
        <h2 id="dist-h">GPA分布</h2>
        ${veil(histogramHTML())}
      </section>

      ${S.issued ? '' : codeHTML()}
    </main>`;
  }

  async function refresh() {
    S.busy = true;
    renderResults();
    const r = await call('login');
    S.busy = false;
    if (r.ok && r.exists) {
      S.answer = r.answer;
      S.A = analyze(r.results);
      toast('最新の集計にしました。');
    } else {
      toast(errorText(r.ok ? 'server_error' : r.error));
    }
    renderResults();
  }

  function copyCode() {
    const done = () => toast('回答コードをコピーしました。');
    const fail = () => toast('コピーできませんでした。回答コードを書き写してください。');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(fmtToken(S.token)).then(done, fail);
    else fail();
  }

  // ---------- 画面遷移と共通処理 ----------

  // 透かしには回答コードそのものではなく、そこから作った短い識別子を使う
  function viewerId(token) {
    let h = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) { h ^= token.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  }

  function render() {
    if (S.screen === 'login') renderLogin();
    else if (S.screen === 'form') renderForm();
    else renderResults();
    if (S.screen === 'results') window.Guard.enable(viewerId(S.token), VEIL);
    else window.Guard.disable();
  }

  function go(screen) {
    if (screen !== 'results') S.issued = false;
    S.screen = screen;
    S.intro = screen === 'results';
    render();
    window.scrollTo(0, 0);
  }

  let toastTimer = 0;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('show'), 3600);
  }

  // 長押しで中身を見たあとに指を離したとき、行の開閉まで起きないようにする
  let pressAt = 0;
  let pressType = '';
  $app.addEventListener('pointerdown', e => { pressAt = Date.now(); pressType = e.pointerType; }, true);
  const wasLongPress = () => pressType === 'touch' && Date.now() - pressAt > 450;

  $app.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'token-in') { e.preventDefault(); restore(); }
  });

  $app.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    const i = Number(t.dataset.i);
    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'start': start(); break;
      case 'restore': restore(); break;
      case 'home': go('login'); break;
      case 'add':
        if (!S.prefs.includes(id)) { S.prefs.push(id); prefsChanged(); }
        break;
      case 'up':
        [S.prefs[i - 1], S.prefs[i]] = [S.prefs[i], S.prefs[i - 1]];
        prefsChanged(`[data-act="up"][data-i="${i - 1}"]`);
        break;
      case 'down':
        [S.prefs[i + 1], S.prefs[i]] = [S.prefs[i], S.prefs[i + 1]];
        prefsChanged(`[data-act="down"][data-i="${i + 1}"]`);
        break;
      case 'remove':
        S.prefs.splice(i, 1);
        prefsChanged();
        break;
      case 'focus-gpa': document.getElementById('gpa-text').focus(); break;
      case 'submit': submit(); break;
      case 'logout': logout(); break;
      case 'edit': go('form'); break;
      case 'back':
        S.gpa = S.answer.gpa;
        S.prefs = S.answer.prefs.slice();
        go('results');
        break;
      case 'refresh': refresh(); break;
      case 'sort': S.sortAll = t.dataset.sort; renderResults(); break;
      case 'show-code': S.showCode = !S.showCode; renderResults(); break;
      case 'copy-code': copyCode(); break;
      case 'toggle-lab': {
        if (wasLongPress()) break;
        if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
        renderResults();
        const btn = document.querySelector(`[data-act="toggle-lab"][data-id="${id}"]`);
        if (btn) btn.focus({ preventScroll: true });
        break;
      }
      default:
    }
  });

  $app.addEventListener('input', e => {
    if (e.target.id === 'gpa-text') gpaTyped(e.target.value);
  });

  const showBin = el => {
    const cap = document.getElementById('hist-cap');
    if (!cap) return;
    document.querySelectorAll('.hb.active').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    cap.textContent = el.dataset.text;
  };
  ['pointerover', 'focusin', 'click'].forEach(type => $app.addEventListener(type, e => {
    const b = e.target.closest && e.target.closest('.hb');
    if (b) showBin(b);
  }));

  // ---------- 起動 ----------

  (function init() {
    const token = normToken(local.get('ls_token'));
    if (TOKEN_RE.test(token)) enterWithToken(token, true);
    else render();
  })();
})();
