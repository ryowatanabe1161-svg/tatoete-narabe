/* たとえてナラベ！ NPC「ふーさん🐻」の頭脳（ブラウザ / Node 共通・純粋関数）
 * - たとえ：お題ごとの目盛り（npc-scales.js）から、自分の数字にいちばん近い言葉を選ぶ（ふつう＝少しブレる）
 * - 自作お題（目盛りなし）：数字の帯ごとの決まり文句で答える
 * - 出すタイミング：場の最大値・他の人の残り枚数・ならべボード上の位置・待ち時間から「自分が最小っぽい」かを判断
 * - ボード：自分の数字の大きさに合わせた位置へ自分のチップを置く
 * NPCが知っているのは自分の数字と公開情報だけ（他人の数字は見ません）。
 */
(function (root) {
  'use strict';
  var SC = (typeof module !== 'undefined' && module.exports) ? require('./npc-scales.js') : root.TatoeScales;
  var LEVELS = { easy: { exprSd: 2.5, exprMax: 5, offPick: 0, perceiveSd: 0, label: 'やさしい' }, normal: { exprSd: 7, exprMax: 18, offPick: 0.15, perceiveSd: 5, label: 'ふつう' } };
  function lv(level) { return LEVELS[level] || LEVELS.normal; }
  function gauss(rng) { var u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function parseScale(s) { return String(s).split('|').map(function (x) { var i = x.lastIndexOf(':'); return { w: x.slice(0, i), v: +x.slice(i + 1) }; }); }
  function scaleFor(title) { return title && SC && SC[title] ? parseScale(SC[title]) : null; }

  // 目盛りのない自作お題用：帯ごとの決まり文句（数字は使わない）
  var BANDS = [
    { max: 10, w: ['ほぼゼロ…いちばん下のほう！', 'かなりかなり低め！'] },
    { max: 25, w: ['低め…だと思う', 'けっこう控えめかな'] },
    { max: 40, w: ['ちょっと低めかな？', 'まんなかより下くらい'] },
    { max: 60, w: ['まんなかあたり…かな', 'ふつう、って感じ'] },
    { max: 75, w: ['うーん…ちょっと高めかな？', 'まんなかより上くらい'] },
    { max: 90, w: ['けっこう高め！', 'かなり上のほう！'] },
    { max: 100, w: ['最高クラス！てっぺん近い！', 'これ以上ないくらい高い！'] }
  ];
  function fallbackExpr(n, rng, taken) {
    rng = rng || Math.random; taken = taken || [];
    for (var i = 0; i < BANDS.length; i++) if (n <= BANDS[i].max) {
      var a = BANDS[i].w, free = a.filter(function (w) { return taken.indexOf(w) < 0; });
      if (!free.length) free = a;                        // 同じ帯の札が多いときは重複を許す
      return free[Math.floor(rng() * free.length)];
    }
    return BANDS[6].w[0];
  }

  // たとえを選ぶ：{ w: 言葉, v: 目盛りの値 or null, fallback: bool }
  function pickExpr(themeTitle, n, level, rng, taken) {
    rng = rng || Math.random; taken = taken || [];
    var sc = scaleFor(themeTitle), L = lv(level);
    if (!sc) return { w: fallbackExpr(n, rng, taken), v: null, fallback: true };
    var target = n + clamp(gauss(rng) * L.exprSd, -L.exprMax, L.exprMax);
    var sorted = sc.slice().sort(function (a, b) { return Math.abs(a.v - target) - Math.abs(b.v - target); });
    var free = sorted.filter(function (e) { return taken.indexOf(e.w) < 0; });
    if (!free.length) free = sorted;
    var pick = free[0];
    if (L.offPick && free.length > 1 && rng() < L.offPick) pick = free[1];     // たまに少しズレた言葉を選ぶ（人間らしさ）
    return { w: pick.w, v: pick.v, fallback: false };
  }
  var LINES = ['『%』…かなぁ🐾', 'ぼくは『%』だよ🐻', 'うーん…『%』って感じ！', '『%』…どうかな？🍯', 'ふーさん的には『%』！'];
  function cuteLine(w, rng) { rng = rng || Math.random; return LINES[Math.floor(rng() * LINES.length)].replace('%', w); }

  // ボード上の置き場所：自分の数字の大きさに比例した位置（0〜len）
  function boardIndex(n, len) { return clamp(Math.round((n / 100) * len), 0, len); }

  // 「自分が最小」っぽさ（0〜1）。perceived＝ブレを含む自分の数字の感覚、top＝場の最大値、others＝他人の手札の残り枚数
  function lowestChance(perceived, top, others) {
    if (others <= 0) return 1;
    var span = Math.max(1, 100 - top), room = clamp(100 - perceived, 0, span);
    return Math.pow(room / span, others);
  }
  // 今出すべきか。info: { n, top, others, idleSec, ahead (ボードで自分より前にある他人のチップ数 or null), waited (待ったされた回数), perceived }
  function wantsPlay(info) {
    var p = lowestChance(info.perceived != null ? info.perceived : info.n, info.top, info.others);
    if (info.ahead === 0) p = p * 0.6 + 0.4;                 // みんなが自分を先頭に並べている → 出そう
    else if (info.ahead > 0) p = p * Math.pow(0.6, info.ahead); // 前に誰かいる → 待とう
    // 待つほどハードルが下がり、最後は必ず出す（高い札だけが残っても止まらない）。残りがふーさんだけなら早めに
    var thr = clamp(0.75 - info.idleSec / (info.onlyNpcs ? 30 : 90), 0, 0.75) + 0.15 * (info.waited || 0);
    return { p: p, thr: thr, go: p >= thr };
  }
  function perceive(n, level, rng) { var L = lv(level); return L.perceiveSd ? clamp(Math.round(n + gauss(rng || Math.random) * L.perceiveSd), 1, 100) : n; }
  function npcName(i, count) { return count > 1 ? 'ふーさん🐻' + (i + 1) : 'ふーさん🐻'; }

  var api = { LEVELS: LEVELS, BANDS: BANDS, parseScale: parseScale, scaleFor: scaleFor, fallbackExpr: fallbackExpr, pickExpr: pickExpr, cuteLine: cuteLine,
    boardIndex: boardIndex, lowestChance: lowestChance, wantsPlay: wantsPlay, perceive: perceive, npcName: npcName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TatoeNPC = api;
})(this);
