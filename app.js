/* たとえてナラベ！ オンライン協力ゲーム
 * 構成：WebRTC（PeerJS）P2P。ホストのブラウザが唯一の正（authoritative）。
 * 数字はホストだけが持ち、各プレイヤーには「自分の数字」と公開情報（出された札・よけた札・たとえ）だけを送ります。
 * NPC「ふーさん🐻」もホストの中で動き、自分の数字と公開情報だけで判断します。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var L = TatoeGame, NPC = TatoeNPC, TH = TatoeThemes;
  var Q = new URLSearchParams(location.search);
  var CFG = window.NT_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; });
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'tatoete-narabe-jp-v1-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var NPC_PLAY = Q.get('npcplay') !== '0';            // テスト用：ふーさんの自動プレイを止める
  var HB_MS = 3000, LOST_MS = 10000, MAX_SEATS = 10, MAX_NPC = 9;
  var LS_ID = 'tn-client-id', LS_NAME = 'tn-name', LS_HOST = 'tn-host-room', SS_CLIENT = 'tn-joined';
  var REACTS = ['👍', '🤔', '😱', '🙏', '😂', '⏳'];
  var AVC = ['#ff6b5b', '#17a89b', '#f2a516', '#6c7bff', '#e05aa8', '#3fae4f', '#9a6bd8', '#ff8f3d', '#2c9bd6', '#b8860b'];
  var DEFAULT_OPTS = { stages: 3, ref: true, wait: 3, npc: 'normal' };
  var OPT_DEF = [
    { k: 'stages', label: 'ステージ数', ch: [[3, '3（公式）'], [5, '5'], [99, 'どこまでも']] },
    { k: 'ref', label: 'ステージ3のものさしカード', ch: [[true, 'あり'], [false, 'なし']] },
    { k: 'wait', label: '「ちょっと待って！」タイム', ch: [[3, '3秒'], [5, '5秒'], [0, 'なし']] },
    { k: 'npc', label: 'ふーさんの強さ', ch: [['easy', 'やさしい'], ['normal', 'ふつう']] }
  ];

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  function cleanText(t, n) { return String(t || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); }
  function genCode() { var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) { var u = location.origin + location.pathname + '?room=' + code; if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice')); return u; }
  function catOf(k) { return TH.CATS.filter(function (c) { return c.k === k; })[0] || { e: '✏️', label: 'オリジナル' }; }
  var reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 汎用UI ----------
  var SCREENS = ['title', 'lobby', 'game', 'result', 'final'];
  function show(id) { SCREENS.forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2800); }
  function banner(msg) { $('banner').textContent = msg || ''; $('banner').classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb, noCancel) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes;
    $('cfNo').style.display = noCancel ? 'none' : '';
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb && cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = $('rulesBtn3').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  function vibrate(p) { if (!reducedMotion && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }

  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null;
  function hostId(code) { return ID_PREFIX + code; }
  function newRoom(name) {
    return { code: genCode(), phase: 'lobby', nextSid: 2, gid: 0, opts: Object.assign({}, DEFAULT_OPTS),
      seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }],
      G: null, theme: null, cands: [], votes: {}, board: [], boardBy: null, boardHuman: false, pending: null, pendSeq: 0,
      reacts: [], reactSeq: 0, log: [], evId: 0, ev: null, history: [], used: [], idleFrom: 0, talkFrom: 0, waited: {}, created: Date.now() };
  }
  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, lastReact: {}, tries: 0, opened: false, resuming: !!resumeRoom, npc: {}, pendT: null };
    var R = host.room;
    if (resumeRoom) {
      R.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
      if (R.pending) schedulePending();
      R.idleFrom = Date.now(); R.talkFrom = Math.min(R.talkFrom || 0, Date.now());
    }
    connecting(true, '部屋を準備しています…', 'シグナリングサーバーに接続中');
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
    setInterval(npcTick, TURBO ? 150 : 500);
  }
  function openHostPeer() {
    var R = host.room;
    var peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () { host.opened = true; host.tries = 0; connecting(false); banner(''); hostBroadcast(); });
    peer.on('connection', function (conn) {
      conn.on('data', function (m) { hostOnMessage(conn, m); });
      conn.on('close', function () { hostConnClosed(conn); });
      conn.on('error', function () { hostConnClosed(conn); });
    });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming) { R.code = genCode(); openHostPeer(); return; }
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatBySid(sid) { return host.room.seats.filter(function (s) { return s.sid === sid; })[0]; }
  function nameOf(sid) { var s = seatBySid(sid); return s ? s.name : '?'; }
  function addLog(t) { var R = host.room; R.log.unshift(t); if (R.log.length > 40) R.log.length = 40; }

  function hostOnMessage(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') return hostJoin(conn, m);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return;
    host.lastSeen[conn.clientId] = Date.now();
    if (m.t === 'ping') return;
    if (m.t === 'leave') {
      var R = host.room;
      if (R.phase === 'lobby') R.seats.splice(R.seats.indexOf(seat), 1); else seat.connected = false;
      addLog('👋 ' + seat.name + 'が退出しました');
      delete host.conns[conn.clientId];
      try { conn.close(); } catch (e) {}
      return hostBroadcast();
    }
    hostAction(seat, m, conn);
  }
  function hostJoin(conn, m) {
    var R = host.room;
    var name = cleanName(m.name), cid = String(m.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('名前を入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    if (/ふーさん/.test(name)) return reject('「ふーさん」はNPC用の名前です。別の名前にしてください。');
    var seat = seatByClient(cid);
    if (!seat) { seat = R.seats.filter(function (s) { return s.kind === 'remote' && s.name === name && !s.connected; })[0]; if (seat) seat.clientId = cid; }
    if (seat) {
      var old = host.conns[cid]; if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; addLog('🔌 ' + seat.name + 'が戻ってきました');
    } else {
      if (R.phase !== 'lobby') return reject('この部屋はゲーム中です。前に参加していた人は、同じ名前で入ると元の席に戻れます。');
      if (R.seats.length >= MAX_SEATS) return reject('満員です（最大10人）。ホストがふーさんを外すと入れます。');
      if (R.seats.some(function (s) { return s.name === name; })) return reject('その名前はすでに使われています。別の名前にしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat); addLog('👋 ' + name + 'が参加しました');
    }
    conn.clientId = cid; host.conns[cid] = conn; host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast();
  }
  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; addLog('⚠️ ' + seat.name + 'の接続が切れました'); hostBroadcast(); }
  }
  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }

  // ---- NPC席 ----
  function renameNpcs() {
    var R = host.room, npcs = R.seats.filter(function (s) { return s.kind === 'npc'; });
    npcs.forEach(function (s, i) { s.name = NPC.npcName(i, npcs.length); });
  }
  function addNpc() {
    var R = host.room;
    if (R.phase !== 'lobby') return;
    if (R.seats.length >= MAX_SEATS) return toast('満員です（最大10人）');
    if (R.seats.filter(function (s) { return s.kind === 'npc'; }).length >= MAX_NPC) return;
    R.seats.push({ sid: R.nextSid++, name: 'ふーさん🐻', kind: 'npc', connected: true });
    renameNpcs(); addLog('🐻 ふーさんがやってきた');
    hostBroadcast();
  }

  // ---- 進行 ----
  function rngFor(salt) { return Q.get('seed') ? L.rngFrom(+Q.get('seed') * 7919 + salt) : Math.random; }
  function debugDeck(stage) {   // テスト用：?deck=10,20,30/5,60,12,70 （ステージごとに / 区切り。席順に stage 枚ずつ配る）
    var d = Q.get('deck'); if (!d) return null;
    var part = d.split('/')[stage - 1]; if (!part) return null;
    var seen = {}, out = [];
    part.split(/[ ,]+/).map(Number).forEach(function (x) { if (x >= 1 && x <= 100 && !seen[x]) { seen[x] = 1; out.push(x); } });
    var rest = []; for (var i = 1; i <= 100; i++) if (!seen[i]) rest.push(i);
    return out.concat(L.shuffle(rest, rngFor(stage + 50)));
  }
  function hostStartGame() {
    var R = host.room;
    if (R.seats.length < 2) return toast('2人以上で遊べます（ふーさんを呼んでもOK）');
    var pids = R.seats.map(function (s) { return s.sid; });
    R.G = L.newGame(pids, { maxStage: R.opts.stages, ref: R.opts.ref });
    R.gid++; R.G.gid = R.gid;
    R.history = []; R.log = []; R.reacts = [];
    L.startStage(R.G, rngFor(R.gid * 100 + 1), debugDeck(1));
    addLog('🎉 ゲーム開始！ ステージ1（1人1枚）');
    enterTheme();
  }
  function drawCands(n) {
    var R = host.room, all = TH.THEMES, rng = rngFor(R.gid * 1000 + R.G.stage * 10 + R.used.length);
    var pool = all.filter(function (t) { return R.used.indexOf(t.id) < 0 && (!R.cands || !R.cands.some(function (c) { return c.id === t.id; })); });
    if (pool.length < n) { R.used = []; pool = all.slice(); }
    var out = L.shuffle(pool.slice(), rng).slice(0, n);
    if (Q.get('theme') && R.G.stage === 1 && !R.cands.length) { var f = all.filter(function (t) { return t.id === +Q.get('theme'); })[0]; if (f) out[0] = f; }
    return out.map(function (t) { return { id: t.id, c: t.c, t: t.t, lo: t.lo, hi: t.hi }; });
  }
  function enterTheme() {
    var R = host.room;
    R.phase = 'theme'; R.theme = null; R.cands = []; R.cands = drawCands(2); R.votes = {}; R.pending = null; clearTimeout(host.pendT);
    R.board = []; R.boardBy = null; R.boardHuman = false;
    R.ev = { id: ++R.evId, type: 'stage', stage: R.G.stage };
    host.npc = {};
    hostBroadcast();
  }
  function startTalk(theme) {
    var R = host.room, G = R.G;
    R.theme = theme; if (theme.id) R.used.push(theme.id);
    R.phase = 'talk'; R.talkFrom = R.idleFrom = Date.now(); R.waited = {};
    // ボードの初期順：席順にチップを並べる（ものさしカードは数字に合わせた位置へ）
    var order = [];
    G.pids.forEach(function (pid) { L.handOf(G, pid).forEach(function (c) { order.push(c.cid); }); });
    if (G.ref) order.splice(NPC.boardIndex(G.ref.n, order.length), 0, 'ref');
    R.board = order; R.boardBy = null; R.boardHuman = false;
    addLog('🎯 お題「' + theme.t + '」');
    R.ev = { id: ++R.evId, type: 'talk' };
    hostBroadcast();
  }
  function isHostSeat(seat) { return seat.kind === 'host'; }
  function hostAction(seat, m, conn) {
    var R = host.room, G = R.G;
    function err(msg) { if (conn) conn.send({ t: 'error', msg: msg }); else if (seat.kind === 'host') { toast(msg); hostBroadcast(); } }
    if (m.t === 'react') return hostReact(seat, m.e);
    if (!G || (m.gid != null && m.gid !== R.gid)) return;
    try {
      switch (m.t) {
        case 'vote':
          if (R.phase !== 'theme') return;
          var i = +m.i; if (!(i >= 0 && i < R.cands.length)) return;
          if (R.votes[seat.sid] === i) delete R.votes[seat.sid]; else R.votes[seat.sid] = i;
          return hostBroadcast();
        case 'pick':
          if (R.phase !== 'theme' || !isHostSeat(seat)) return;
          var c = R.cands[+m.i]; if (!c) return;
          return startTalk(c);
        case 'redraw':
          if (R.phase !== 'theme' || !isHostSeat(seat)) return;
          R.cands = drawCands(2); R.votes = {}; return hostBroadcast();
        case 'custom':
          if (R.phase !== 'theme' || !isHostSeat(seat)) return;
          var t = cleanText(m.title, 30), lo = cleanText(m.lo, 12) || '小さい', hi = cleanText(m.hi, 12) || '大きい';
          if (!t) return err('お題を入力してください');
          return startTalk({ id: 0, c: 'custom', t: t, lo: lo, hi: hi, custom: true });
        case 'expr':
          if (R.phase !== 'talk') return;
          L.setExpr(G, seat.sid, m.cid, m.text);
          return hostBroadcast();
        case 'refExpr':
          if (R.phase !== 'talk' || !G.ref) return;
          L.setRefExpr(G, m.text); R.refBy = seat.sid;
          return hostBroadcast();
        case 'board':
          if (R.phase !== 'talk' || !Array.isArray(m.order)) return;
          var cur = R.board.slice().sort().join(','), nw = m.order.map(String);
          if (nw.slice().sort().join(',') !== cur) return conn && conn.send({ t: 'error', msg: 'ボードが更新されていました。もう一度どうぞ' });
          R.board = nw; R.boardBy = seat.sid; if (seat.kind !== 'npc') R.boardHuman = true;
          return hostBroadcast();
        case 'play': return hostPlay(seat, m, err);
        case 'wait':
          if (!R.pending) return;
          var p = R.pending; R.pending = null; clearTimeout(host.pendT);
          if (p.by === seat.sid) addLog('↩️ ' + seat.name + 'が出すのをやめました');
          else { addLog('✋ ' + seat.name + 'が「ちょっと待って！」'); R.waited[p.by] = (R.waited[p.by] || 0) + 1; }
          R.ev = { id: ++R.evId, type: 'wait', by: seat.sid, target: p.by };
          return hostBroadcast();
        case 'next':
          if (!isHostSeat(seat) || R.phase !== 'result') return;
          if (G.phase === 'cleared') {
            var r = L.nextStage(G, rngFor(R.gid * 100 + G.stage + 1), debugDeck(G.stage + 1));
            addLog('➡️ ステージ' + G.stage + '（1人' + G.stage + '枚）' + (r.gained ? '　❤️+1' : ''));
            R.lifeGain = r.gained;
            return enterTheme();
          }
          R.phase = 'final'; R.ev = { id: ++R.evId, type: 'final', won: G.end.won };
          return hostBroadcast();
        case 'proxy':   // 切断した人の札をホストが代わりに出す
          if (!isHostSeat(seat) || R.phase !== 'talk') return;
          var who = seatBySid(+m.sid); if (!who || who.kind !== 'remote' || who.connected) return;
          var h = L.handOf(G, who.sid); if (!h.length) return;
          return hostPlay(who, { cid: h[0].cid, proxy: true }, err);
      }
    } catch (e) { err(e.message); }
  }
  function hostPlay(seat, m, err) {
    var R = host.room, G = R.G;
    if (R.phase !== 'talk' || G.phase !== 'play') return;
    if (R.pending) return err('ほかの人が出そうとしています');
    var h = L.handOf(G, seat.sid);
    if (!h.length) return err('もう札がありません');
    if (h[0].cid !== m.cid) return err('自分のいちばん小さい札から出してください');
    if (R.opts.wait > 0 && !m.proxy) {
      R.pending = { id: ++R.pendSeq, by: seat.sid, cid: m.cid, expr: h[0].expr, until: Date.now() + R.opts.wait * 1000 * (TURBO ? 0.5 : 1) };
      addLog('🙋 ' + seat.name + 'が出そうとしています');
      R.ev = { id: ++R.evId, type: 'pending', by: seat.sid };
      schedulePending();
      return hostBroadcast();
    }
    doPlay(seat.sid, m.cid);
  }
  function schedulePending() {
    var R = host.room; clearTimeout(host.pendT);
    if (!R.pending) return;
    var id = R.pending.id;
    host.pendT = setTimeout(function () {
      if (!R.pending || R.pending.id !== id) return;
      var p = R.pending; R.pending = null;
      try { doPlay(p.by, p.cid); } catch (e) { hostBroadcast(); }
    }, Math.max(0, R.pending.until - Date.now()));
  }
  function doPlay(by, cid) {
    var R = host.room, G = R.G;
    if (!G.field.length && !G.aside.length) R.guess = R.board.filter(function (x) { return x !== 'ref'; });   // 最初に出す瞬間のボード＝みんなの予想順
    var ev = L.play(G, by, cid);
    var drop = [cid].concat(ev.lower.map(function (c) { return c.cid; }));
    R.board = R.board.filter(function (x) { return drop.indexOf(x) < 0; });
    R.idleFrom = Date.now(); R.waited = {};
    if (ev.lower.length) addLog('✋ ストップ！ ' + nameOf(by) + 'の ' + ev.card.n + ' より小さい札が' + ev.lower.length + '枚… ❤️-' + ev.lost);
    else addLog('✅ ' + nameOf(by) + '：' + ev.card.n + (ev.card.expr ? '『' + ev.card.expr + '』' : ''));
    R.ev = { id: ++R.evId, type: 'play', by: by, card: ev.card, lower: ev.lower, lost: ev.lost, livesBefore: ev.livesBefore, livesAfter: ev.livesAfter, cleared: !!ev.cleared, over: !!ev.over };
    if (G.phase !== 'play') {
      R.history.push({ stage: G.stage, theme: R.theme, lives: G.lives, mistakes: G.stageMistakes.length, cleared: G.phase === 'cleared' || (G.end && G.end.won),
        cards: Object.keys(G.cards).map(function (k) { var c = G.cards[k]; return { by: c.by, n: c.n, expr: c.expr, state: c.state, guess: R.guess ? R.guess.indexOf(c.cid) : -1 }; }), ref: G.ref ? { n: G.ref.n, expr: G.ref.expr } : null,
        order: G.field.map(function (c) { return c.cid; }) });
      R.phase = 'result';
      if (G.phase === 'over') addLog(G.end.won ? '🏆 全ステージクリア！' : '💀 ライフがなくなった…');
      else addLog('🎉 ステージ' + G.stage + 'クリア！');
    }
    hostBroadcast();
  }
  function hostReact(seat, e) {
    var R = host.room, now = Date.now();
    if (REACTS.indexOf(e) < 0 || now - (host.lastReact[seat.sid] || 0) < 600) return;
    host.lastReact[seat.sid] = now;
    pushReact(seat.sid, e, null);
    hostBroadcast();
  }
  function pushReact(sid, e, say) {
    var R = host.room;
    R.reacts.push({ id: ++R.reactSeq, by: sid, e: e, say: say || null }); if (R.reacts.length > 8) R.reacts.shift();
  }

  // ---- NPC「ふーさん🐻」の思考（ホスト内。自分の数字と公開情報だけを使う） ----
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function npcTick() {
    if (!host || !host.opened && !host.resuming) return;
    var R = host.room, G = R.G; if (!G) return;
    var now = Date.now(), k = TURBO ? 0.12 : 1, level = R.opts.npc;
    var npcs = R.seats.filter(function (s) { return s.kind === 'npc'; });
    if (!npcs.length) return;
    var changed = false;
    if (R.phase === 'theme') {
      npcs.forEach(function (s) {
        var m = host.npc[s.sid] = host.npc[s.sid] || {};
        if (m.voteKey !== R.gid + ':' + G.stage) { m.voteKey = R.gid + ':' + G.stage; m.voteAt = now + rnd(1500, 4000) * k; m.voted = false; }
        if (!m.voted && now >= m.voteAt && R.cands.length) { m.voted = true; R.votes[s.sid] = Math.floor(Math.random() * R.cands.length); changed = true; }
      });
      if (changed) hostBroadcast();
      return;
    }
    if (R.phase !== 'talk' || G.phase !== 'play') return;
    var key = R.gid + ':' + G.stage;
    var title = R.theme && !R.theme.custom ? R.theme.t : null;
    npcs.forEach(function (s) {
      var m = host.npc[s.sid];
      if (!m || m.key !== key) m = host.npc[s.sid] = { key: key, exprAt: now + rnd(2000, 6000) * k, boardAt: 0, perceived: {}, decideAt: 0 };
      var hand = L.handOf(G, s.sid);
      // 1) たとえを書く
      if (now >= m.exprAt && hand.some(function (c) { return !c.expr; })) {
        var taken = Object.keys(G.cards).map(function (x) { return G.cards[x].expr; }).filter(Boolean);
        var words = [];
        hand.forEach(function (c) { if (!c.expr) { var p = NPC.pickExpr(title, c.n, level, Math.random, taken); try { L.setExpr(G, s.sid, c.cid, p.w); taken.push(p.w); words.push(p.w); } catch (e) {} } });
        if (words.length) { pushReact(s.sid, '🐻', NPC.cuteLine(words.join('』と『'))); addLog('🐻 ' + s.name + '「' + words.join('」「') + '」'); }
        m.boardAt = now + rnd(1500, 3500) * k; changed = true;
      }
      // 2) ボードで自分の位置へ（ステージごとに1回）
      if (m.boardAt && now >= m.boardAt && !m.boardDone) {
        m.boardDone = true;
        var mine = R.board.filter(function (x) { return G.cards[x] && G.cards[x].by === s.sid; });
        var rest = R.board.filter(function (x) { return mine.indexOf(x) < 0; });
        mine.sort(function (a, b) { return G.cards[a].n - G.cards[b].n; }).forEach(function (cid) {
          var idx = NPC.boardIndex(G.cards[cid].n, rest.length);
          // 公開されているものさしカードの数字は使ってよい（基準より前か後か）
          if (G.ref) { var ri = rest.indexOf('ref'); if (ri >= 0) { if (G.cards[cid].n < G.ref.n) idx = Math.min(idx, ri); else idx = Math.max(idx, ri + 1); } }
          rest.splice(idx, 0, cid);
        });
        R.board = rest; R.boardBy = s.sid; changed = true;
      }
      // 3) ものさしカードのたとえが空なら提案
      if (G.ref && !G.ref.expr && s === npcs[0] && now - R.talkFrom > 15000 * k) {
        var rp = NPC.pickExpr(title, G.ref.n, 'easy', Math.random, []);
        try { L.setRefExpr(G, rp.w); R.refBy = s.sid; pushReact(s.sid, '📏', 'ものさしは『' + rp.w + '』でどう？'); changed = true; } catch (e) {}
      }
    });
    // 4) 出すかどうか（同時に1人だけ）
    // 人間がたとえを書き終える（または45秒たつ）までは、ふーさんは出さない
    var humansReady = L.handCards(G).every(function (c) { var st = seatBySid(c.by); return !st || st.kind === 'npc' || c.expr; }) || now - R.talkFrom > 45000 * k;
    if (NPC_PLAY && humansReady && !R.pending && now - R.idleFrom > (TURBO ? 1200 : 9000)) {
      var top = G.field.length ? G.field[G.field.length - 1].n : 0, total = L.handCards(G).length;
      var idleSec = (now - R.idleFrom) / 1000 / k;
      var ready = null;
      npcs.forEach(function (s) {
        var hand = L.handOf(G, s.sid), m = host.npc[s.sid]; if (!hand.length || !m || !hand[0].expr) return;
        var c = hand[0];
        if (m.perceived[c.cid] == null) m.perceived[c.cid] = NPC.perceive(c.n, level, Math.random);
        var ahead = null;
        if (R.boardHuman) { var pos = R.board.indexOf(c.cid); ahead = R.board.slice(0, pos).filter(function (x) { return x !== 'ref' && G.cards[x] && G.cards[x].by !== s.sid; }).length; }
        var d = NPC.wantsPlay({ n: c.n, perceived: m.perceived[c.cid], top: top, others: total - hand.length, idleSec: idleSec, ahead: ahead, waited: R.waited[s.sid] || 0 });
        if (d.go) { if (!m.decideAt) m.decideAt = now + rnd(1200, 3500) * k; if (now >= m.decideAt && (!ready || d.p > ready.p)) ready = { s: s, c: c, p: d.p }; }
        else m.decideAt = 0;
      });
      if (ready) { host.npc[ready.s.sid].decideAt = 0; hostPlay(ready.s, { cid: ready.c.cid }, function () {}); return; }
    }
    if (changed) hostBroadcast();
  }

  // ---- ビュー（見せてよい情報だけ） ----
  function viewFor(sid) {
    var R = host.room, G = R.G;
    var v = { t: 'state', phase: R.phase, code: R.code, you: sid, opts: R.opts, log: R.log.slice(0, 4), ev: R.ev, reacts: R.reacts,
      seats: R.seats.map(function (s) { return { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected }; }) };
    if (!G || R.phase === 'lobby') return v;
    var reveal = R.phase === 'result' || R.phase === 'final';
    v.gid = R.gid; v.stage = G.stage; v.maxStage = G.maxStage; v.lives = G.lives; v.maxLives = L.MAX_LIVES; v.lifeGain = R.lifeGain || 0;
    v.theme = R.theme; v.cands = R.cands; v.votes = R.votes;
    v.seats.forEach(function (s) { s.left = L.handOf(G, s.sid).length; });
    v.cards = Object.keys(G.cards).map(function (k) {
      var c = G.cards[k], o = { cid: c.cid, by: c.by, expr: c.expr, state: c.state };
      if (c.state !== 'hand' || reveal) o.n = c.n;          // 手元の札の数字は公開しない
      return o;
    });
    v.hand = L.handOf(G, sid).map(function (c) { return { cid: c.cid, n: c.n, expr: c.expr }; });   // 自分の札だけ数字つき
    v.field = G.field.map(function (c) { return c.cid; }); v.aside = G.aside.map(function (c) { return c.cid; });
    v.ref = G.ref ? { n: G.ref.n, expr: G.ref.expr } : null;   // ものさしカードは全員に公開
    v.board = R.phase === 'talk' ? R.board : []; v.boardBy = R.boardBy;
    v.pending = R.pending ? { id: R.pending.id, by: R.pending.by, expr: R.pending.expr, left: Math.max(0, R.pending.until - Date.now()) } : null;
    v.gphase = G.phase; v.end = G.end;
    if (reveal) v.history = R.history;
    return v;
  }
  function hostBroadcast() {
    var R = host.room;
    R.seats.forEach(function (s) {
      if (s.kind !== 'remote') return;
      var c = host.conns[s.clientId];
      if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} }
    });
    render(viewFor(1));
    store(LS_HOST, { room: R, saved: Date.now() });
  }

  // ---- ホスト操作（ロビー） ----
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, seat = seatBySid(+b.dataset.sid);
    if (!seat || seat.kind === 'host' || R.phase !== 'lobby') return;
    var rm = function () {
      var c = seat.clientId && host.conns[seat.clientId];
      if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      R.seats.splice(R.seats.indexOf(seat), 1); renameNpcs(); hostBroadcast();
    };
    if (seat.kind === 'npc') rm(); else confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', rm);
  });
  $('addNpc').onclick = function () { if (host) addNpc(); };
  $('opts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-k]'); if (!b || !host || host.room.phase !== 'lobby') return;
    var def = OPT_DEF.filter(function (d) { return d.k === b.dataset.k; })[0]; if (!def) return;
    host.room.opts[def.k] = def.ch[+b.dataset.i][0]; hostBroadcast();
  });
  $('startBtn').onclick = function () { if (host) hostStartGame(); };
  $('againBtn').onclick = function () { if (host) hostStartGame(); };
  $('lobbyBtn').onclick = function () { if (!host) return; var R = host.room; R.phase = 'lobby'; R.G = null; R.ev = null; R.pending = null; addLog('ロビーに戻りました'); hostBroadcast(); };

  // =====================================================================
  //  参加者（クライアント）
  // =====================================================================
  var client = null, received = [];
  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, everJoined: false, lastMsg: Date.now() };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(false); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    peer.on('open', clientConnect);
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') {
        if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); }
        else clientLost();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!client.everJoined) connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
    client.hbTimer = setInterval(function () {
      if (!client) return;
      if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
      if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
    }, HB_MS);
    setTimeout(function () {
      if (client && !client.everJoined && $('connecting').classList.contains('active'))
        $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）';
    }, 15000);
  }
  function clientConnect() {
    if (!client || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }
  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') { client.everJoined = true; connecting(false); banner(''); sstore(SS_CLIENT, { code: client.code, name: client.name }); }
    else if (m.t === 'state') { received.push(m); if (received.length > 4000) received.shift(); render(m); }
    else if (m.t === 'reject') { connecting(false); leaveClient(false); confirmBox('お知らせ', m.msg, 'OK', null, true); }
    else if (m.t === 'kicked') { sstore(SS_CLIENT, null); leaveClient(false); confirmBox('お知らせ', 'ホストによって部屋から外されました。', 'OK', null, true); }
    else if (m.t === 'closed') { sstore(SS_CLIENT, null); leaveClient(false); confirmBox('お知らせ', 'ホストが部屋を閉じました。', 'OK', null, true); }
    else if (m.t === 'error') { playSent = 0; toast(m.msg); if (lastView) render(lastView); }
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return;
      client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false); show('title'); renderTitle();
  }
  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else confirmBox('部屋を出ますか？', 'ゲーム中に出ても、同じ名前で入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = $('menuBtn').onclick = leaveRoom;

  // ---- 自分の操作（ホストは直接、参加者は送信） ----
  var lastView = null, playSent = 0;
  function send(msg) {
    if (lastView && lastView.gid != null) msg.gid = lastView.gid;
    if (host) hostAction(seatBySid(1), msg, null);
    else if (client && client.conn && client.conn.open) client.conn.send(msg);
  }

  // =====================================================================
  //  描画（受け取ったビューだけを使う）
  // =====================================================================
  var lastEvId = null, seenReact = null, revealKey = '', finalKey = '', dragging = null, pendingView = null, pendDeadline = 0, pendId = 0;
  function setHTML(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; return true; } return false; }   // 変化がなければDOMを触らない（タップ中の要素が消えないように）
  function seatOf(v, sid) { return v.seats.filter(function (x) { return x.sid === sid; })[0] || { name: '?', kind: 'remote' }; }
  function seatIdx(v, sid) { for (var i = 0; i < v.seats.length; i++) if (v.seats[i].sid === sid) return i; return 0; }
  function av(v, sid) { var s = seatOf(v, sid); return '<span class="av" style="background:' + AVC[seatIdx(v, sid) % AVC.length] + '">' + (s.kind === 'npc' ? '🐻' : esc(s.name.slice(0, 1))) + '</span>'; }
  function render(v) {
    lastView = v; window.__tn.view = v;
    if (lastEvId === null) { lastEvId = v.ev ? v.ev.id : 0; seenReact = v.reacts && v.reacts.length ? v.reacts[v.reacts.length - 1].id : 0; }
    if (v.phase !== 'theme' && v.phase !== 'talk') $('sayFeed').innerHTML = '';
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); overlay('mistake', false); }
    else if (v.phase === 'theme' || v.phase === 'talk') { show('game'); renderGame(v); }
    else if (v.phase === 'result') { show('result'); renderResult(v); }
    else if (v.phase === 'final') { show('final'); renderFinal(v); }
    if (v.ev && v.ev.id !== lastEvId) { lastEvId = v.ev.id; effect(v, v.ev); }
    if (v.reacts) v.reacts.forEach(function (r) { if (r.id > seenReact) { seenReact = r.id; bubble(r.by, r.e, r.say); } });
  }
  function renderLobby(v) {
    var isHost = !!host;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) {
      try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
      $('qr').dataset.url = url;
    }
    var n = v.seats.length, npcs = v.seats.filter(function (s) { return s.kind === 'npc'; }).length;
    $('seatCount').textContent = n + ' / 10人' + (npcs ? '（うちふーさん' + npcs + '）' : '');
    setHTML($('seatList'), v.seats.map(function (s) {
      var tags = (s.kind === 'host' ? '<span class="tag host">ホスト</span>' : '') + (s.sid === v.you ? '<span class="tag you">あなた</span>' : '') +
        (s.kind === 'npc' ? '<span class="tag npc">NPC</span>' : '') +
        (s.kind === 'remote' ? (s.connected ? '<span class="tag on">接続中</span>' : '<span class="tag off">切断</span>') : '');
      return '<div class="seat' + (s.connected ? '' : ' offline') + '">' + av(v, s.sid) + '<span class="nm">' + esc(s.name) + '</span>' + tags +
        (isHost && s.kind !== 'host' ? '<button class="xbtn" data-sid="' + s.sid + '" aria-label="外す">×</button>' : '') + '</div>';
    }).join(''));
    $('seatHint').textContent = n < 2 ? 'あと' + (2 - n) + '人で遊べます。友だちを招待するか、ふーさん🐻を呼んでね。' : '2〜10人で遊べます。ふーさんは話せませんが、たとえを書いて一緒に遊びます。';
    $('addNpc').disabled = n >= MAX_SEATS;
    setHTML($('opts'), OPT_DEF.map(function (d) {
      return '<div class="opt"><span>' + d.label + '</span><div class="seg">' + d.ch.map(function (c, i) {
        return '<button data-k="' + d.k + '" data-i="' + i + '" class="' + (v.opts[d.k] === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div></div>';
    }).join(''));
    $('startBtn').disabled = n < 2;
    $('startBtn').textContent = 'はじめる（' + n + '人）';
    $('leaveBtn1').textContent = isHost ? '部屋を閉じる' : '部屋を出る';
  }
  function livesHtml(v) { var s = ''; for (var i = 0; i < v.maxLives; i++) s += '<span class="' + (i < v.lives ? '' : 'dead') + '">❤️</span>'; return s; }
  function themeHtml(t) {
    if (!t) return '';
    var c = t.custom ? { e: '✏️', label: 'オリジナルお題' } : catOf(t.c);
    return '<div class="cat">' + c.e + ' ' + esc(c.label) + '</div><div class="tt">' + esc(t.t) + '</div>' +
      '<div class="ends"><span class="lo">1：' + esc(t.lo) + '</span><i class="mid"></i><span class="hi">100：' + esc(t.hi) + '</span></div>';
  }
  function renderGame(v) {
    $('stageNo').textContent = v.stage + '/' + (v.maxStage >= 99 ? '∞' : v.maxStage);
    $('lives').innerHTML = livesHtml(v);
    $('codeChip').textContent = v.code;
    // プレイヤー
    setHTML($('players'), v.seats.map(function (s) {
      return '<div class="pchip' + (s.sid === v.you ? ' me' : '') + (s.connected ? '' : ' off') + '" data-sid="' + s.sid + '">' + av(v, s.sid) + '<span>' + esc(s.name) + '</span>' +
        (v.phase === 'talk' ? '<span class="cnt">🂠' + s.left + '</span>' : '') + '</div>';
    }).join(''));
    var theme = v.phase === 'theme';
    $('themePick').style.display = theme ? '' : 'none';
    $('talk').style.display = theme ? 'none' : '';
    $('boardWrap').style.display = theme ? 'none' : '';
    if (theme) renderCands(v); else $('themeBox').innerHTML = themeHtml(v.theme);
    renderMine(v);
    if (!theme) renderBoard(v);
    renderAction(v);
  }
  function renderCands(v) {
    var counts = {}, voters = {};
    Object.keys(v.votes || {}).forEach(function (sid) { var i = v.votes[sid]; counts[i] = (counts[i] || 0) + 1; (voters[i] = voters[i] || []).push(seatOf(v, +sid).name); });
    setHTML($('cands'), v.cands.map(function (c, i) {
      var mine = v.votes && v.votes[v.you] === i;
      return '<div class="cand">' + themeHtml(c) + '<div class="acts"><button class="vote' + (mine ? ' on' : '') + '" data-vote="' + i + '">👍<span class="vn">' + (counts[i] || 0) + '</span></button>' +
        '<span class="voters">' + esc((voters[i] || []).join('・')) + '</span>' + (host ? '<button class="pick" data-pick="' + i + '">これにする</button>' : '') + '</div></div>';
    }).join(''));
  }
  $('cands').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.vote != null) send({ t: 'vote', i: +b.dataset.vote });
    if (b.dataset.pick != null) send({ t: 'pick', i: +b.dataset.pick });
  });
  $('redrawBtn').onclick = function () { send({ t: 'redraw' }); };
  $('cuBtn').onclick = function () {
    var t = $('cuT').value.trim(); if (!t) { toast('お題を入力してください'); return; }
    send({ t: 'custom', title: t, lo: $('cuLo').value, hi: $('cuHi').value });
    $('cuT').value = $('cuLo').value = $('cuHi').value = '';
  };

  // 自分の数字（入力中の内容を消さないよう、札ごとにDOMを使い回す）
  function renderMine(v) {
    var box = $('mine'), talk = v.phase === 'talk';
    $('mineTtl').querySelector('span').textContent = v.hand.length > 1 ? '🃏 あなたの数字（' + v.hand.length + '枚）' : '🃏 あなたの数字';
    var keyNow = v.gid + ':' + v.stage + ':' + v.phase + ':' + v.hand.map(function (c) { return c.cid; }).join(',');
    if (box.dataset.key !== keyNow) {
      box.dataset.key = keyNow;
      box.innerHTML = v.hand.length ? v.hand.map(function (c, i) {
        return '<div class="mycard" data-cid="' + c.cid + '"><div class="bignum' + (i === 0 ? ' next' : '') + '">' + c.n + '<small>' + (i === 0 && v.hand.length > 1 ? 'つぎに出す' : 'あなたの数字') + '</small></div>' +
          '<div class="ex">' + (talk ? '<label>たとえ（数字はNG）</label><div class="exrow"><input maxlength="30" placeholder="例：' + esc(exampleFor(v.theme, c.n)) + '" data-cid="' + c.cid + '"><button data-save="' + c.cid + '">OK</button></div><div class="exstate"></div>'
            : '<label>お題が決まったら、この数字をたとえよう</label>') + '</div></div>';
      }).join('') : '<div class="done">' + (talk ? '✨ あなたの札はぜんぶ出しました。みんなを応援しよう！' : '') + '</div>';
    }
    v.hand.forEach(function (c) {
      var card = box.querySelector('.mycard[data-cid="' + c.cid + '"]'); if (!card) return;
      var inp = card.querySelector('input'), st = card.querySelector('.exstate');
      if (inp && document.activeElement !== inp && !inp.dataset.dirty) inp.value = c.expr || '';
      if (st) st.textContent = c.expr ? '✓ みんなに見えています' : 'まだ書いていません';
    });
  }
  function exampleFor(theme, n) {
    if (!theme) return '';
    var sc = !theme.custom && NPC.scaleFor(theme.t);
    return sc ? '「' + sc[Math.floor(Math.random() * sc.length)].w + '」など' : 'ことばでたとえる';
  }
  function saveExpr(cid) {
    var inp = $('mine').querySelector('input[data-cid="' + cid + '"]'); if (!inp) return;
    var t = inp.value.trim();
    if (/[0-9０-９]/.test(t)) { toast('数字は使えません（ことばでたとえてね）'); return; }
    delete inp.dataset.dirty;
    send({ t: 'expr', cid: cid, text: t });
  }
  $('mine').addEventListener('click', function (e) { var b = e.target.closest('button[data-save]'); if (b) saveExpr(b.dataset.save); });
  $('mine').addEventListener('input', function (e) { if (e.target.dataset.cid) e.target.dataset.dirty = '1'; });
  $('mine').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.dataset.cid) { e.preventDefault(); saveExpr(e.target.dataset.cid); e.target.blur(); } });
  $('mine').addEventListener('focusout', function (e) { var t = e.target; if (t.dataset && t.dataset.cid && t.dataset.dirty) setTimeout(function () { saveExpr(t.dataset.cid); }, 0); });

  // ならべボード
  function cardOf(v, cid) { return v.cards.filter(function (c) { return c.cid === cid; })[0]; }
  function renderBoard(v) {
    var field = v.field.map(function (cid) { return cardOf(v, cid); });
    var aside = v.aside.map(function (cid) { return cardOf(v, cid); });
    var fieldChanged = setHTML($('field'), '<span class="lbl">場：</span>' + (field.length ? field.map(function (c, i) {
      return (i ? '<span class="arrow">›</span>' : '') + '<span class="tile" data-f="' + c.cid + '" title="' + esc(seatOf(v, c.by).name + '『' + c.expr + '』') + '">' + c.n + '</span>';
    }).join('') : '<span class="lbl" style="font-weight:700">まだ出ていません</span>') +
      (aside.length ? '<span class="lbl" style="margin-left:6px">よけた：</span>' + aside.map(function (c) { return '<span class="tile aside">' + c.n + '</span>'; }).join('') : ''));
    var popped = v.ev && v.ev.type === 'play' && v.ev.card ? v.ev.card.cid : null;
    if (popped && (fieldChanged || $('field').dataset.pop !== String(v.ev.id))) { $('field').dataset.pop = v.ev.id; var t = $('field').querySelector('[data-f="' + popped + '"]'); if (t) t.classList.add('pop'); }
    if (dragging) { pendingView = v; return; }   // ドラッグ中は並びを上書きしない
    var mineN = {}; v.hand.forEach(function (c) { mineN[c.cid] = c.n; });
    var prev = ($('chips').dataset.order || '').split(',');
    var moves = {};
    if ($('chips').dataset.order !== v.board.join(',')) v.board.forEach(function (id, i) { if (prev.length > 1 && prev.indexOf(id) !== i && prev.indexOf(id) >= 0 && v.boardBy !== v.you) moves[id] = 1; });
    setHTML($('chips'), v.board.map(function (id, i) {
      var moved = !!moves[id];
      if (id === 'ref') return '<div class="chip ref' + (moved ? ' moved' : '') + '" data-id="ref"><span class="grip">≡</span><span class="who"><span class="tile" style="font-size:14px;padding:2px 6px;background:var(--sun);color:#5a3b00;box-shadow:none">' + v.ref.n + '</span><span>ものさし</span></span>' +
        '<span class="say' + (v.ref.expr ? '' : ' none') + '">' + (v.ref.expr ? '『' + esc(v.ref.expr) + '』' : 'たとえを決めよう') + '</span>' + mvBtns() + '</div>';
      var c = cardOf(v, id); if (!c) return '';
      var me = c.by === v.you, s = seatOf(v, c.by);
      return '<div class="chip' + (me ? ' me' : '') + (moved ? ' moved' : '') + '" data-id="' + id + '"><span class="grip">≡</span><span class="who">' + av(v, c.by) + '<span>' + esc(s.kind === 'npc' ? s.name.replace('🐻', '') : s.name) + '</span></span>' +
        '<span class="say' + (c.expr ? '' : ' none') + '">' + (c.expr ? '『' + esc(c.expr) + '』' : '（考え中…）') + '</span>' + (me ? '<span class="mynum">' + mineN[id] + '</span>' : '') + mvBtns() + '</div>';
    }).join('') || '<div class="hint" style="text-align:center">ボードは空です</div>');
    $('chips').dataset.order = v.board.join(',');
    $('boardBy').textContent = v.boardBy ? '最後に並べかえた人：' + seatOf(v, v.boardBy).name : '';
    // ものさしカード
    if (v.ref) {
      var rb = $('refBox');
      if (!rb.querySelector('input')) rb.innerHTML = '<div class="refbox"><span class="tile">' + v.ref.n + '</span><div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:800;color:#8a6a00">📏 ものさしカード（全員に公開）のたとえ</div><div class="exrow"><input id="refIn" maxlength="30" placeholder="みんなで決めよう"><button id="refSave">決定</button></div></div></div>';
      rb.querySelector('.tile').textContent = v.ref.n;
      var ri = $('refIn'); if (document.activeElement !== ri && !ri.dataset.dirty) ri.value = v.ref.expr || '';
    } else $('refBox').innerHTML = '';
  }
  function mvBtns() { return '<span class="mv"><button data-mv="-1" aria-label="上へ">▲</button><button data-mv="1" aria-label="下へ">▼</button></span>'; }
  $('refBox').addEventListener('click', function (e) {
    if (e.target.id !== 'refSave') return;
    var ri = $('refIn'), t = ri.value.trim();
    if (/[0-9０-９]/.test(t)) { toast('数字は使えません（ことばでたとえてね）'); return; }
    delete ri.dataset.dirty; send({ t: 'refExpr', text: t });
  });
  $('refBox').addEventListener('input', function (e) { if (e.target.id === 'refIn') e.target.dataset.dirty = '1'; });
  function domOrder() { return [].map.call($('chips').querySelectorAll('.chip'), function (c) { return c.dataset.id; }); }
  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mv]'); if (!b) return;
    var chip = b.closest('.chip'), order = domOrder(), i = order.indexOf(chip.dataset.id), j = i + (+b.dataset.mv);
    if (j < 0 || j >= order.length) return;
    order.splice(j, 0, order.splice(i, 1)[0]);
    send({ t: 'board', order: order });
  });
  // ドラッグ（ポインターイベント。≡をつかんで上下に）
  $('chips').addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.grip'); if (!g) return;
    var chip = g.closest('.chip'); e.preventDefault();
    dragging = { chip: chip, startY: e.clientY, before: domOrder().join(','), pid: e.pointerId };
    try { g.setPointerCapture(e.pointerId); } catch (x) {}
    chip.classList.add('dragging');
  });
  $('chips').addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== dragging.pid) return;
    var chip = dragging.chip, list = $('chips');
    chip.style.transform = 'translateY(' + (e.clientY - dragging.startY) + 'px)';
    var others = [].filter.call(list.querySelectorAll('.chip'), function (c) { return c !== chip; });
    var target = null;
    for (var i = 0; i < others.length; i++) { var r = others[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { target = others[i]; break; } }
    var before = chip.getBoundingClientRect().top;
    if (target) { if (chip.nextSibling !== target) list.insertBefore(chip, target); } else if (list.lastElementChild !== chip) list.appendChild(chip);
    var after = chip.getBoundingClientRect().top;
    if (after !== before) { dragging.startY += (after - before); chip.style.transform = 'translateY(' + (e.clientY - dragging.startY) + 'px)'; }
    // 端に近ければスクロール
    var sc = $('gscroll'), sr = sc.getBoundingClientRect();
    if (e.clientY < sr.top + 40) sc.scrollTop -= 8; else if (e.clientY > sr.bottom - 40) sc.scrollTop += 8;
  });
  function endDrag(e) {
    if (!dragging || (e && e.pointerId !== dragging.pid)) return;
    var d = dragging; dragging = null;
    d.chip.classList.remove('dragging'); d.chip.style.transform = '';
    var order = domOrder();
    if (order.join(',') !== d.before) send({ t: 'board', order: order });
    $('chips')._html = null;   // ローカルで並べ替えたDOMは、次の描画で必ず作り直す
    var pv = pendingView; pendingView = null; if (pv && pv === lastView) renderBoard(pv);
  }
  $('chips').addEventListener('pointerup', endDrag);
  $('chips').addEventListener('pointercancel', endDrag);

  // 下部アクション
  function renderAction(v) {
    var talk = v.phase === 'talk', p = v.pending;
    $('playBtn').style.display = talk && !p ? '' : 'none';
    $('pending').classList.toggle('show', !!(talk && p));
    $('reacts').style.display = '';
    var mine = v.hand[0];
    if (v.phase === 'theme') {
      $('status').innerHTML = host ? 'お題を選んでください（自作もOK）' : 'お題に👍で投票しよう。ホストが決めます';
    } else if (p) {
      if (p.id !== pendId) { pendId = p.id; pendDeadline = Date.now() + p.left; }
      var who = seatOf(v, p.by);
      $('pendTxt').innerHTML = (p.by === v.you ? 'あなたが' : esc(who.name) + 'が') + (p.expr ? '『' + esc(p.expr) + '』を' : '') + '出そうとしています…';
      $('waitBtn').textContent = p.by === v.you ? '↩️ やめる' : '✋ ちょっと待って！';
      tickPending();
      $('status').textContent = '';
    } else if (!mine) {
      $('status').textContent = v.seats.some(function (s) { return s.left; }) ? 'みんなが出すのを見守ろう' : '';
    } else {
      $('status').innerHTML = mine.expr ? '自分がいちばん小さいと思ったら出そう' : 'まずは数字を<b>たとえ</b>で書いてみよう';
    }
    if (mine && talk) $('playBtn').innerHTML = '出す！（<b>' + mine.n + '</b>' + (v.hand.length > 1 ? '・手元でいちばん小さい札' : '') + '）';
    $('playBtn').disabled = !(talk && mine && !p && v.gphase === 'play' && playSent !== v.gid + ':' + v.field.length + ':' + mine.cid);
    // 切断者の札を代わりに出す（ホスト）
    var hb = $('hostbar'), off = talk && host ? v.seats.filter(function (s) { return s.kind === 'remote' && !s.connected && s.left; })[0] : null;
    if (off) { hb.innerHTML = '<span>⚠️ ' + esc(off.name) + 'の接続が切れています</span><button data-proxy="' + off.sid + '">代わりにいちばん小さい札を出す</button>'; hb.classList.add('show'); }
    else hb.classList.remove('show');
  }
  setInterval(tickPending, 200);
  function tickPending() { if (!lastView || !lastView.pending) return; $('pendCd').textContent = Math.max(0, Math.ceil((pendDeadline - Date.now()) / 1000)); }
  $('hostbar').addEventListener('click', function (e) { var b = e.target.closest('button[data-proxy]'); if (b) confirmBox('代わりに出しますか？', '切断した人の手元でいちばん小さい札を出します（数字はホストにも出すまで見えません）。', '出す', function () { send({ t: 'proxy', sid: +b.dataset.proxy }); }); });
  $('playBtn').onclick = function () {
    var v = lastView; if (!v || !v.hand[0]) return;
    var c = v.hand[0];
    var go = function () { playSent = v.gid + ':' + v.field.length + ':' + c.cid; $('playBtn').disabled = true; send({ t: 'play', cid: c.cid }); setTimeout(function () { playSent = 0; if (lastView) renderAction(lastView); }, 4000); };
    if (!c.expr) confirmBox('たとえを書かずに出しますか？', 'あなたの ' + c.n + ' を出します。', '出す', go); else go();
  };
  $('waitBtn').onclick = function () { send({ t: 'wait' }); };
  $('reacts').innerHTML = REACTS.map(function (e) { return '<button data-e="' + e + '">' + e + '</button>'; }).join('');
  $('reacts').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) send({ t: 'react', e: b.dataset.e }); });

  // リアクション：絵文字はプレイヤーチップの中にポップ（チップを覆わない）
  // ふーさんのひとこと：アクションバーのすぐ上の「ひとことフィード」に積み上げて自動で消える（お題・プレイヤー欄は隠さない）
  var SAY_MAX = 3, SAY_MS = TURBO ? 2600 : 4200;
  function bubble(sid, e, say) {
    if (!$('game').classList.contains('active')) return;
    if (say) return sayFeed(sid, e, say);
    var el = $('players').querySelector('.pchip[data-sid="' + sid + '"]'); if (!el) return;
    var old = el.querySelector('.rx'); if (old) old.remove();
    var b = document.createElement('span'); b.className = 'rx'; b.textContent = e; el.appendChild(b);
    setTimeout(function () { b.remove(); }, 2200);
  }
  function placeFeed() {
    var a = $('action'); if (!a) return;
    $('sayFeed').style.bottom = Math.max(8, window.innerHeight - a.getBoundingClientRect().top + 6) + 'px';
  }
  window.addEventListener('resize', placeFeed);
  function sayFeed(sid, e, say) {
    var v = lastView, feed = $('sayFeed'); placeFeed();
    var name = v ? seatOf(v, sid).name : '';
    while (feed.children.length >= SAY_MAX) feed.firstElementChild.remove();
    var it = document.createElement('div'); it.className = 'sayit';
    it.innerHTML = '<span class="sw">' + esc(e) + '</span><b>' + esc(name.replace('🐻', '')) + '</b><span class="st">' + esc(say) + '</span>';
    feed.appendChild(it);
    setTimeout(function () { it.classList.add('out'); setTimeout(function () { it.remove(); }, 400); }, SAY_MS);
    // 話したふーさんのボードの行も光らせる
    if (v && v.cards) v.cards.filter(function (c) { return c.by === sid; }).forEach(function (c) { var ch = $('chips').querySelector('.chip[data-id="' + c.cid + '"]'); if (ch) { ch.classList.remove('talking'); void ch.offsetWidth; ch.classList.add('talking'); } });
  }
  function nice(t) { var f = $('niceFx'); f.textContent = t; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); }
  function confetti(n) {
    if (reducedMotion) return;
    var cols = ['#ff6b5b', '#17a89b', '#ffc94a', '#6c7bff', '#e05aa8'];
    for (var i = 0; i < n; i++) { var c = document.createElement('div'); c.className = 'confetti'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = cols[i % cols.length];
      c.style.animationDuration = (1.8 + Math.random() * 1.8) + 's'; c.style.animationDelay = Math.random() * 0.6 + 's'; document.body.appendChild(c); (function (x) { setTimeout(function () { x.remove(); }, 4200); })(c); }
  }
  var mkT;
  function effect(v, ev) {
    if (ev.type === 'play') {
      var name = seatOf(v, ev.by).name;
      if (ev.lower && ev.lower.length) {
        $('mkPlayed').innerHTML = esc(name) + 'が出した <span class="tile">' + ev.card.n + '</span>' + (ev.card.expr ? '『' + esc(ev.card.expr) + '』' : '');
        $('mkLow').innerHTML = ev.lower.map(function (c) { return '<div class="lowrow"><span class="tile">' + c.n + '</span><span class="w">' + (c.expr ? '『' + esc(c.expr) + '』' : '（たとえなし）') + '</span><span class="nm">' + esc(seatOf(v, c.by).name) + '</span></div>'; }).join('');
        var h = ''; for (var i = 0; i < ev.lost; i++) h += '<span style="animation-delay:' + (0.25 + i * 0.25) + 's">💔</span>';
        $('mkHearts').innerHTML = h || '';
        $('mkLife').textContent = 'ライフ ' + ev.livesBefore + ' → ' + ev.livesAfter + (ev.livesAfter === 0 ? '（ゲームオーバー…）' : '');
        overlay('mistake', true); vibrate([80, 50, 120]);
        var lv = $('lives'); lv.classList.remove('hit'); void lv.offsetWidth; lv.classList.add('hit');
        clearTimeout(mkT); mkT = setTimeout(function () { overlay('mistake', false); }, TURBO ? 2500 : 7000);
      } else { nice('ナイス！ ' + ev.card.n + (ev.card.expr ? '『' + ev.card.expr + '』' : '')); vibrate(30); }
    } else if (ev.type === 'wait') {
      toast('✋ ' + seatOf(v, ev.by).name + (ev.by === ev.target ? 'が出すのをやめました' : 'が「ちょっと待って！」'));
    } else if (ev.type === 'stage' && v.stage > 1) {
      toast('ステージ' + v.stage + '！ 1人' + v.stage + '枚' + (v.lifeGain ? '・ライフ+1' : ''));
    }
  }
  $('mkClose').onclick = function () { overlay('mistake', false); };

  // ステージ結果（全員の数字とたとえを、小さい順に1枚ずつめくる）
  function renderResult(v) {
    var h = v.history[v.history.length - 1]; if (!h) return;
    var over = v.gphase === 'over', won = over && v.end && v.end.won;
    $('rHead').className = 'rhead' + (over && !won ? ' lose' : '');
    $('rIcon').textContent = won ? '🏆' : over ? '💀' : '🎉';
    $('rTitle').textContent = won ? '全ステージクリア！' : over ? 'ゲームオーバー…' : 'ステージ' + h.stage + ' クリア！';
    $('rText').innerHTML = '残りライフ ' + livesHtml(v) + (h.mistakes ? '　ミス ' + h.mistakes + '回' : '　ノーミス！');
    $('rTheme').innerHTML = themeHtml(h.theme);
    var key = v.gid + ':' + h.stage + ':' + v.history.length;
    if (revealKey !== key) {
      revealKey = key;
      var rows = h.cards.slice();
      if (h.ref) rows.push({ by: 0, n: h.ref.n, expr: h.ref.expr, state: 'ref' });
      rows.sort(function (a, b) { return a.n - b.n; });
      // 「えっ!?」：予想順（最初に出した瞬間のボード）と実際の順位がいちばんズレた札
      var real = rows.filter(function (c) { return c.state !== 'ref'; }), surprise = null, best = 1;
      real.forEach(function (c, i) { if (c.guess >= 0 && Math.abs(c.guess - i) > best) { best = Math.abs(c.guess - i); surprise = c; } });
      $('revList').innerHTML = rows.map(function (c) {
        var who = c.state === 'ref' ? '📏 ものさしカード' : esc(seatOf(v, c.by).name);
        var sp = c === surprise ? '<span class="badge wow">えっ!? 予想' + (c.guess + 1) + '番目</span>' : '';
        var badge = sp + (c.state === 'played' ? '<span class="badge">出した</span>' : c.state === 'aside' ? '<span class="badge x">よけた</span>' : c.state === 'hand' ? '<span class="badge x">手元に残った</span>' : '');
        return '<div class="rev ' + c.state + '"><div class="n">?</div><div class="tx"><div class="w' + (c.expr ? '' : ' none') + '">' + (c.expr ? '『' + esc(c.expr) + '』' : '（たとえなし）') + '</div><div class="by">' + (c.state === 'ref' ? '' : av(v, c.by)) + who + badge + '</div></div></div>';
      }).join('');
      var els = $('revList').querySelectorAll('.rev'), gap = TURBO ? 60 : 450;
      [].forEach.call(els, function (el, i) {
        setTimeout(function () { el.classList.add('show'); setTimeout(function () { var n = el.querySelector('.n'); n.textContent = rows[i].n; n.classList.add('flip'); }, gap * 0.6); }, 200 + i * gap);
      });
      if (!over || won) confetti(won ? 70 : 30);
      $('result').querySelector('.col').scrollTop = 0;
    }
    var two = v.seats.length === 2;
    $('rNote').textContent = over ? '' : (two ? '2人プレイなのでライフは回復しません。' : v.lives < v.maxLives ? '次のステージの前にライフが1つ回復します。' : 'ライフは満タン（最大3）です。') + ' 次は1人' + (h.stage + 1) + '枚！';
    $('nextBtn').textContent = over ? '最終結果を見る' : '次のステージへ（1人' + (h.stage + 1) + '枚）';
    $('rWait').innerHTML = 'ホストが進めるのを待っています<span class="dots"></span>';
  }
  $('nextBtn').onclick = function () { send({ t: 'next' }); };

  function renderFinal(v) {
    var won = v.end && v.end.won, H = v.history || [];
    var key = v.gid + ':final';
    $('fHead').className = 'rhead' + (won ? '' : ' lose');
    $('fIcon').textContent = won ? '🏆🐻' : '🐻💤';
    $('fTitle').textContent = won ? 'みんなの勝ち！' : 'おしかった…！';
    var cleared = H.filter(function (h) { return h.cleared; }).length;
    $('fText').textContent = won ? 'ふーさん「みんなの『たとえ』、ばっちり伝わったね！」' : 'ふーさん「ステージ' + (cleared + 1) + 'でライフがなくなっちゃった…また挑戦しよう！」';
    var mist = H.reduce(function (a, h) { return a + h.mistakes; }, 0);
    $('fStats').innerHTML = 'クリアしたステージ：<b>' + cleared + '</b> / ' + (v.maxStage >= 99 ? '∞' : v.maxStage) + '<br>ミスの回数：<b>' + mist + '</b>　残りライフ：' + livesHtml(v) + '<br>プレイヤー：' + v.seats.map(function (s) { return esc(s.name); }).join('・');
    $('fLog').innerHTML = H.map(function (h) {
      var rows = h.cards.slice().sort(function (a, b) { return a.n - b.n; });
      return '<div class="stagelog"><div class="h">ステージ' + h.stage + (h.cleared ? ' ✅' : ' ❌') + '「' + esc(h.theme.t) + '」</div><div class="l">' +
        rows.map(function (c) { return '<b>' + c.n + '</b> ' + esc(seatOf(v, c.by).name) + (c.expr ? '『' + esc(c.expr) + '』' : '') + (c.state === 'aside' ? '（よけた）' : c.state === 'hand' ? '（残り）' : ''); }).join('<br>') + '</div></div>';
    }).join('');
    if (finalKey !== key) { finalKey = key; if (won) confetti(90); $('final').querySelector('.col').scrollTop = 0; }
    $('leaveBtn2').textContent = host ? '部屋を閉じる' : '部屋を出る';
  }

  // ---- 招待URLのコピー・共有 ----
  $('copyBtn').onclick = function () {
    var u = $('inviteUrl').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast('招待URLをコピーしました'); }, function () { toast('コピーできませんでした。URLを長押ししてコピーしてください'); });
  };
  $('shareBtn').onclick = function () {
    var u = $('inviteUrl').textContent;
    if (navigator.share) navigator.share({ title: 'たとえてナラベ！', text: '数字をことばで伝えあう協力ゲームで遊ぼう！', url: u }).catch(function () {});
    else $('copyBtn').click();
  };

  // ---- タイトル ----
  function renderTitle() {
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv; if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true);
    var ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var j = sload(SS_CLIENT);
    $('rejoinBtn').style.display = j ? '' : 'none';
    if (j) $('rejoinBtn').textContent = '部屋 ' + j.code + ' に戻る（' + j.name + '）';
  }
  function getName() { var n = cleanName($('nameIn').value); if (!n) { toast('名前を入力してください'); $('nameIn').focus(); return null; } store(LS_NAME, n); return n; }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () { var s = load(LS_HOST, true); if (s) startHost(s.room.seats[0].name, s.room); };
  function join(code) { var n = getName(); if (!n) return; code = normCode(code); if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; } startClient(code, n); }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });

  // テスト・デバッグ用（数字の秘密情報はホスト以外には存在しません）
  window.__tn = {
    view: null, received: received,
    role: function () { return host ? 'host' : client ? 'client' : 'none'; },
    hostRoom: function () { return host ? host.room : null; },
    sendRaw: function (m) { if (client && client.conn) client.conn.send(m); },
    npcTick: function () { npcTick(); }
  };
  renderTitle();
})();
