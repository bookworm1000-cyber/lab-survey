// 結果画面のスクリーンショット対策。ウェブページから撮影そのものを止める手段はないため、
// ・他の人のデータは押している(カーソルを合わせている)間だけ、その1枚分だけを見せる
// ・ページの外に意識が移った瞬間やスクショ用のキーで画面を隠す
// ・撮られた画像に閲覧者ごとの透かしが残る
// を組み合わせて、1回の撮影で持ち出せる情報を小さくする。
(() => {
  'use strict';
  const root = document.documentElement;
  const shield = document.getElementById('shield');
  const mark = document.getElementById('watermark');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let active = false;
  let veiling = false;
  let label = '';
  let keyHeld = false;
  let timer = 0;
  let lit = null;

  function hide() {
    if (!active) return;
    clearTimeout(timer);
    light(null);
    root.classList.add('shielded');
    shield.hidden = false;
  }

  function reveal(force) {
    if (!active) return;
    if (!force && (keyHeld || document.hidden)) return;
    root.classList.remove('shielded');
    shield.hidden = true;
  }

  function hideFor(ms) {
    hide();
    timer = setTimeout(() => reveal(), ms);
  }

  function scrubClipboard() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('この画面の撮影・転載は禁止されています。').catch(() => {});
    }
  }

  function paintWatermark() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const fill = dark.matches ? '#ffffff' : '#18262e';
    const text = `閲覧ID ${label}  ${stamp}  転載禁止`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190">`
      + `<text x="150" y="95" text-anchor="middle" transform="rotate(-24 150 95)" font-family="sans-serif" font-size="13" fill="${fill}" fill-opacity="0.085">${text}</text></svg>`;
    mark.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  // ---------- 押している間だけ表示 ----------

  function light(el) {
    if (lit === el) return;
    if (lit) lit.classList.remove('lit');
    lit = el;
    if (lit) lit.classList.add('lit');
  }

  function veilAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const own = el.closest('.veil');
    if (own) return own;
    const scope = el.closest('[data-veil-scope]');
    return scope ? scope.querySelector('.veil') : null;
  }

  const onTouch = e => {
    if (!veiling || root.classList.contains('shielded')) return;
    const t = e.touches[0];
    if (t) light(veilAt(t.clientX, t.clientY));
  };
  document.addEventListener('touchstart', onTouch, { passive: true });
  document.addEventListener('touchmove', onTouch, { passive: true });
  document.addEventListener('touchend', e => { if (!e.touches.length) light(null); });
  document.addEventListener('touchcancel', () => light(null));

  let mouse = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') { mouse = null; return; }
    mouse = { x: e.clientX, y: e.clientY };
    if (!veiling || root.classList.contains('shielded')) return;
    light(veilAt(mouse.x, mouse.y));
  });
  document.documentElement.addEventListener('mouseleave', () => { mouse = null; light(null); });
  // ホイールでスクロールしたときは、カーソルの下に来た要素に合わせ直す
  window.addEventListener('scroll', () => {
    if (veiling && mouse) requestAnimationFrame(() => { if (mouse) light(veilAt(mouse.x, mouse.y)); });
  }, { passive: true });

  document.addEventListener('focusin', e => {
    if (!veiling || !(e.target instanceof Element)) return;
    const own = e.target.closest('.veil');
    light(own || (e.target.matches('[data-veil-scope]') ? e.target.querySelector('.veil') : null));
  });

  // ---------- 公開する操作 ----------

  window.Guard = {
    enable(viewer, useVeil) {
      label = String(viewer).replace(/[^0-9A-Za-z]/g, '');
      active = true;
      veiling = !!useVeil;
      root.classList.add('guarded');
      root.classList.toggle('veiling', veiling);
      paintWatermark();
      mark.hidden = false;
      if (document.hidden) hide();
    },
    disable() {
      active = false;
      veiling = false;
      keyHeld = false;
      clearTimeout(timer);
      light(null);
      root.classList.remove('guarded', 'shielded', 'veiling');
      shield.hidden = true;
      mark.hidden = true;
    },
  };

  if (dark.addEventListener) dark.addEventListener('change', () => { if (active) paintWatermark(); });

  // ウィンドウからフォーカスが外れたら隠す(切り取りツールや画面録画アプリに切り替えたとき)
  window.addEventListener('blur', hide);
  window.addEventListener('focus', () => { keyHeld = false; timer = setTimeout(() => reveal(), 150); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hide();
    else timer = setTimeout(() => reveal(), 150);
  });
  window.addEventListener('beforeprint', hide);
  window.addEventListener('afterprint', () => reveal());

  const isMetaKey = k => k === 'Meta' || k === 'OS' || k === 'Super' || k === 'Hyper';

  document.addEventListener('keydown', e => {
    if (!active) return;
    const k = e.key || '';
    // Win+Shift+S、⌘+Shift+3/4/5 はどれも Win/⌘ キーから押されるので、その時点で隠しておく
    if (isMetaKey(k)) { keyHeld = true; hide(); return; }
    if (k === 'PrintScreen') { hideFor(2500); scrubClipboard(); return; }
    const mod = e.ctrlKey || e.metaKey;
    const lower = k.toLowerCase();
    if (mod && (lower === 'p' || lower === 's')) { e.preventDefault(); hideFor(1500); }
  }, true);

  document.addEventListener('keyup', e => {
    if (!active) return;
    const k = e.key || '';
    if (isMetaKey(k)) { keyHeld = false; clearTimeout(timer); timer = setTimeout(() => reveal(), 700); }
    if (k === 'PrintScreen') { hideFor(2500); scrubClipboard(); }
  }, true);

  ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart'].forEach(type => {
    document.addEventListener(type, e => {
      if (!active) return;
      if (e.target.closest && e.target.closest('input, textarea')) return;
      e.preventDefault();
    });
  });

  shield.addEventListener('click', () => { keyHeld = false; reveal(true); });
})();
