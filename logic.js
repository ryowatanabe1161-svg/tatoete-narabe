/* たとえてナラベ！ ― ルールエンジン（ブラウザ / Node 共通）
 * 協力モード：数字 1〜100（各1枚）。ステージnでは各自n枚（cards:'one' なら毎ステージ各自1枚）。ライフ3（共有・上限3）。
 * 遊び方は2つ：
 *  - 一斉オープン（標準）：全員の札をボードに並べて「この順番で決定」→ 上（小さい側）から1枚ずつめくる。
 *    それまでにめくった最大の数字より小さい札は「ミス」で、1枚につきライフ1を失う（最後までめくる）。ライフが残ればステージクリア。
 *  - 1枚ずつ出す：小さい順に1枚ずつ出す。出した札より小さい札が誰かの手札に残っていたら、その札をすべて脇へよけ、枚数ぶんライフを失う。
 *    全員の手札がなくなり、ライフが残っていればステージクリア。次のステージ開始時にライフ+1（2人プレイでは回復なし）。
 * ステージ3ではヒントカード（公開の数字1枚）をみんなでたとえる。
 */
(function (root) {
  'use strict';
  var MAX_LIVES = 3;
  function rngFrom(seed) { var a = (seed >>> 0) || 1; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function stageCap(n) { return Math.max(1, Math.floor(99 / n)); }       // 1〜100で配れる最大ステージ（ヒント1枚ぶん残す）
  function handSize(G) { return G.oneCard ? 1 : G.stage; }                // そのステージで1人に配る枚数
  function sanitizeExpr(text) {
    var s = String(text == null ? '' : text).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
    if (/[0-9０-９]/.test(s)) throw new Error('数字は使えません（ことばでたとえてね）');
    return s;
  }

  function newGame(pids, opts) {
    opts = opts || {};
    if (pids.length < 2 || pids.length > 10) throw new Error('2〜10人で遊べます');
    var G = { pids: pids.slice(), lives: MAX_LIVES, stage: 0, oneCard: opts.cards === 'one', maxStage: Math.min(opts.maxStage || 3, opts.cards === 'one' ? 99 : stageCap(pids.length)), useRef: opts.ref !== false,
      phase: 'idle', cards: {}, field: [], aside: [], ref: null, history: [], seq: 0, end: null, mistakesTotal: 0, stagesCleared: 0 };
    return G;
  }
  function newCid(G, rng) { G.seq++; return 'c' + G.seq.toString(36) + Math.floor(rng() * 1e8).toString(36); }   // 数字と無関係なID
  function startStage(G, rng, presetDeck) {
    rng = rng || Math.random;
    G.stage++;
    var deck = presetDeck ? presetDeck.slice() : shuffle(range(1, 100), rng);
    G.cards = {}; G.field = []; G.aside = []; G.ref = null; G.stageMistakes = [];
    G.pids.forEach(function (pid) {
      for (var k = 0, hs = handSize(G); k < hs; k++) { var n = deck.shift(); var cid = newCid(G, rng); G.cards[cid] = { cid: cid, n: n, by: pid, expr: '', state: 'hand' }; }
    });
    if (G.useRef && G.stage === 3) G.ref = { n: deck.shift(), expr: '' };
    G.phase = 'play';
    return G;
  }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  function handOf(G, pid) { return Object.keys(G.cards).map(function (k) { return G.cards[k]; }).filter(function (c) { return c.by === pid && c.state === 'hand'; }).sort(function (a, b) { return a.n - b.n; }); }
  function handCards(G) { return Object.keys(G.cards).map(function (k) { return G.cards[k]; }).filter(function (c) { return c.state === 'hand'; }); }
  function setExpr(G, pid, cid, text) {
    var c = G.cards[cid];
    if (!c || c.by !== pid) throw new Error('あなたの札ではありません');
    if (c.state !== 'hand') throw new Error('出した札・めくった札のたとえは変えられません');
    c.expr = sanitizeExpr(text);
    return c.expr;
  }
  function setRefExpr(G, text) { if (!G.ref) throw new Error('ヒントカードはありません'); G.ref.expr = sanitizeExpr(text); return G.ref.expr; }

  // 札を出す（自分の手札でいちばん小さい札のみ。大きい方を先に出すのは必ず自滅になるため）
  function play(G, pid, cid) {
    if (G.phase !== 'play') throw new Error('いまは札を出せません');
    var c = G.cards[cid];
    if (!c || c.by !== pid || c.state !== 'hand') throw new Error('その札は出せません');
    var mine = handOf(G, pid);
    if (mine[0].cid !== cid) throw new Error('自分のいちばん小さい札から出してください');
    c.state = 'played'; G.field.push(c);
    var lower = handCards(G).filter(function (h) { return h.n < c.n; }).sort(function (a, b) { return a.n - b.n; });
    lower.forEach(function (h) { h.state = 'aside'; h.at = c.n; G.aside.push(h); });
    var before = G.lives;
    G.lives = Math.max(0, G.lives - lower.length);
    var ev = { card: pick(c), lower: lower.map(pick), lost: before - G.lives, livesBefore: before, livesAfter: G.lives };
    if (lower.length) { G.stageMistakes.push(ev); G.mistakesTotal++; }
    G.history.push(ev);
    if (G.lives <= 0) { G.phase = 'over'; G.end = { won: false, stage: G.stage }; ev.over = true; }
    else if (!handCards(G).length) {
      G.stagesCleared = G.stage;
      if (G.stage >= G.maxStage) { G.phase = 'over'; G.end = { won: true, stage: G.stage }; ev.over = true; }
      else { G.phase = 'cleared'; ev.cleared = true; }
    }
    return ev;
  }
  // 一斉オープン：order（上＝小さい側からの札IDの並び。'ref' などは無視）で全札をめくって判定する
  function revealOrder(G, order) {
    if (G.phase !== 'play') throw new Error('いまはめくれません');
    var cids = (order || []).filter(function (x, i, a) { return G.cards[x] && G.cards[x].state === 'hand' && a.indexOf(x) === i; });
    if (cids.length !== handCards(G).length) throw new Error('すべての札をボードに並べてください');
    var top = 0, before = G.lives, steps = [];
    cids.forEach(function (cid, i) {
      var c = G.cards[cid], miss = c.n < top, drop = miss ? top - c.n : 0, topBefore = top;
      if (miss) G.lives = Math.max(0, G.lives - 1);
      top = Math.max(top, c.n);
      c.state = miss ? 'miss' : 'ok'; c.pos = i; G.field.push(c);
      steps.push({ cid: cid, n: c.n, by: c.by, expr: c.expr, miss: miss, drop: drop, topBefore: topBefore, livesAfter: G.lives });
    });
    var misses = steps.filter(function (x) { return x.miss; });
    G.stageMistakes = misses; G.mistakesTotal += misses.length;
    var ev = { mode: 'reveal', steps: steps, misses: misses.length, lost: before - G.lives, livesBefore: before, livesAfter: G.lives };
    G.history.push(ev);
    if (G.lives <= 0) { G.phase = 'over'; G.end = { won: false, stage: G.stage }; ev.over = true; }
    else {
      G.stagesCleared = G.stage;
      if (G.stage >= G.maxStage) { G.phase = 'over'; G.end = { won: true, stage: G.stage }; ev.over = true; }
      else { G.phase = 'cleared'; ev.cleared = true; }
    }
    return ev;
  }
  // 「えっ!?」：ミスの中で、それまでの最大値からいちばん大きく下がった札（ミスなしなら null）
  function biggestSurprise(steps) {
    var best = null; (steps || []).forEach(function (x) { if (x.miss && (!best || x.drop > best.drop)) best = x; }); return best;
  }
  function cardsOf(G, pid) { return Object.keys(G.cards).map(function (k) { return G.cards[k]; }).filter(function (c) { return c.by === pid; }).sort(function (a, b) { return a.n - b.n; }); }
  function pick(c) { return { cid: c.cid, n: c.n, by: c.by, expr: c.expr }; }
  function willRecover(G) { return G.pids.length > 2 && G.lives < MAX_LIVES; }
  function nextStage(G, rng, presetDeck) {
    if (G.phase !== 'cleared') throw new Error('まだ次のステージには進めません');
    var gained = 0;
    if (G.pids.length > 2) { gained = Math.min(MAX_LIVES, G.lives + 1) - G.lives; G.lives += gained; }   // 2人プレイは回復なし
    startStage(G, rng, presetDeck);
    return { gained: gained };
  }

  var api = { MAX_LIVES: MAX_LIVES, rngFrom: rngFrom, shuffle: shuffle, stageCap: stageCap, handSize: handSize, sanitizeExpr: sanitizeExpr, newGame: newGame, startStage: startStage,
    handOf: handOf, handCards: handCards, setExpr: setExpr, setRefExpr: setRefExpr, play: play, revealOrder: revealOrder, biggestSurprise: biggestSurprise, cardsOf: cardsOf, nextStage: nextStage, willRecover: willRecover };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TatoeGame = api;
})(this);
