'use strict';
// 물고기 마을의 호수 — 공유지의 비극 교실 게임 서버
// 의존성 없음: Node 18+ 에서 `node server.js`
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('./vendor/QRCode');
const QRErrorCorrectLevel = require('./vendor/QRCode/QRErrorCorrectLevel');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

const DEF = { maxNum: 24, skip: '16', start: 100, cap: 100, growth: 50, maxCatch: 3, rounds: 10, eat: 1 };
const LIM = { maxNum: [2, 40], rounds: [3, 20], start: [5, 300], cap: [10, 300], growth: [0, 100], maxCatch: [1, 5], eat: [0, 3] };
const rooms = new Map();

/* ---------- 규칙 ---------- */
function clampSettings(s) {
  s = s || {};
  const o = {};
  for (const k of Object.keys(LIM)) {
    let v = parseInt(s[k], 10);
    if (isNaN(v)) v = DEF[k];
    o[k] = Math.max(LIM[k][0], Math.min(LIM[k][1], v));
  }
  if (o.start > o.cap) o.start = o.cap;
  const skip = String(s.skip == null ? DEF.skip : s.skip).match(/\d+/g) || [];
  const skipSet = new Set(skip.map(Number).filter(n => n >= 1 && n <= o.maxNum));
  o.nums = [];
  for (let i = 1; i <= o.maxNum; i++) if (!skipSet.has(i)) o.nums.push(i);
  if (o.nums.length < 2) o.nums = [1, 2];
  o.skip = [...skipSet].sort((a, b) => a - b).join(', ');
  o.n = o.nums.length;
  // 탈락 기준 — empty: 먹을 물고기가 없을 때 탈락(먹고 0마리는 괜찮음) / zero: 먹고 나서 0마리면 탈락
  o.out = s.out === 'zero' ? 'zero' : 'empty';
  return o;
}
// 우리 반 약속: 1인당 limit마리까지. 어기면 고른 벌칙 적용
// reveal 알리기 · ret 돌려놓기 · ban 출어 금지 · grad 단계적 벌칙 · cap 어획 한도
const PACT_KEYS = ['reveal', 'ret', 'ban', 'grad', 'cap'];
function clampPact(p, st) {
  p = p || {};
  let limit = parseInt(p.limit, 10);
  if (isNaN(limit)) limit = 1;
  const o = { limit: Math.max(0, Math.min(st.maxCatch, limit)) };
  for (const k of PACT_KEYS) o[k] = !!p[k];
  if (o.cap) { o.reveal = o.ret = o.ban = o.grad = false; }
  if (o.grad) { o.reveal = o.ret = o.ban = false; }
  return o;
}
const pactActive = P => !!P && PACT_KEYS.some(k => P[k]);
function grow(st, left) {
  if (left <= 0) return { born: 0, after: 0 };
  const born = Math.floor(left * st.growth / 100);
  return { born, after: Math.min(st.cap, left + born) };
}
const rid = n => crypto.randomBytes(n).toString('hex');
function newCode() {
  for (;;) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
}
function freshGame(room) {
  const st = room.settings;
  room.gameNo++;
  room.game = {
    no: room.gameNo, round: 1, fish: st.start, history: [],
    totals: Array(st.n).fill(0), picks: Array(st.n).fill(null),
    alive: Array(st.n).fill(true), deadRound: Array(st.n).fill(null),
    strikes: Array(st.n).fill(0), banned: Array(st.n).fill(false),
    pact: { ...room.pact },
    status: 'play', collapseRound: null, reason: null,
  };
  room.phase = 'lobby';
}
function createRoom(settings) {
  const room = {
    code: newCode(), key: rid(12), settings: clampSettings(settings), rule: '', pact: null,
    seats: {}, clients: new Set(), gameNo: 0, hint: false, past: [], touched: Date.now(),
  };
  room.pact = clampPact({}, room.settings);
  freshGame(room);
  rooms.set(room.code, room);
  return room;
}
const idxOf = (room, num) => room.settings.nums.indexOf(num);
function seatOf(room, sid) {
  for (const n in room.seats) if (room.seats[n].sid === sid) return +n;
  return 0;
}
function resolveRound(room) {
  const g = room.game, st = room.settings;
  const P = g.pact, active = pactActive(P);
  const playing = i => g.alive[i] && !g.banned[i];
  let picks = g.picks.map((p, i) => (playing(i) ? p || 0 : 0));
  if (P.cap) picks = picks.map(v => Math.min(v, P.limit));
  // 약속 어김 판정과 벌칙
  const violators = [], banNext = [], confiscated = Array(st.n).fill(0);
  if (active && !P.cap) {
    picks.forEach((v, i) => {
      if (v <= P.limit) return;
      violators.push(i);
      g.strikes[i]++;
      let conf = false, ban = false;
      if (P.grad) { conf = g.strikes[i] >= 2; ban = g.strikes[i] >= 3; }
      else { conf = P.ret; ban = P.ban; }
      if (conf) confiscated[i] = v - P.limit;
      if (ban) banNext.push(i);
    });
  }
  const returned = confiscated.reduce((a, b) => a + b, 0);
  const kept = picks.map((v, i) => v - confiscated[i]);
  const demand = picks.reduce((a, b) => a + b, 0);
  const take = demand - returned; // 돌려놓은 물고기는 호수에 그대로 남음
  const before = g.fish;
  const left = Math.max(0, before - take);
  if (take < before) kept.forEach((p, i) => { g.totals[i] += p; });
  const { born, after } = grow(st, left);
  // 라운드가 끝나면 살아 있는 사람마다 생존 식량(eat마리)을 먹음.
  // out 'empty': 먹을 물고기가 모자라면 탈락 / out 'zero': 먹고 나서 0마리면 탈락
  let eaten = 0;
  const starved = [];
  if (left > 0 && st.eat > 0) {
    g.alive.forEach((on, i) => {
      // 출어 금지 라운드에는 먹지 않음 (출어 금지가 곧 탈락이 되지 않게)
      if (!on || g.banned[i]) return;
      const enough = g.totals[i] >= st.eat;
      const ate = Math.min(st.eat, g.totals[i]);
      g.totals[i] -= ate;
      eaten += ate;
      const out = st.out === 'zero' ? g.totals[i] <= 0 : !enough;
      if (out) { g.totals[i] = 0; g.alive[i] = false; g.deadRound[i] = g.round; starved.push(i); }
    });
  }
  g.banned = Array(st.n).fill(false);
  banNext.forEach(i => { if (g.alive[i]) g.banned[i] = true; });
  g.history.push({
    round: g.round, before, demand, caught: Math.min(take, before), left, born, after, picks, kept, eaten, starved,
    violators, returned, banNext: banNext.filter(i => g.alive[i]), confiscated,
  });
  g.fish = after;
  if (left <= 0) { g.status = 'collapsed'; g.collapseRound = g.round; g.reason = 'lake'; }
  else if (!g.alive.some(Boolean)) { g.status = 'collapsed'; g.collapseRound = g.round; g.reason = 'starved'; }
  else if (g.round >= st.rounds) g.status = 'success';
  room.phase = 'result';
}

/* ---------- 화면에 보낼 상태 ---------- */
function onlineSids(room) {
  const s = new Set();
  for (const c of room.clients) if (c.role === 's' && c.sid) s.add(c.sid);
  return s;
}
function teacherView(room) {
  const on = onlineSids(room);
  const seats = {};
  for (const n in room.seats) seats[n] = { nick: room.seats[n].nick, online: on.has(room.seats[n].sid) };
  return { role: 't', code: room.code, settings: room.settings, phase: room.phase, rule: room.rule, pact: room.pact, hint: room.hint, seats, game: room.game, past: room.past };
}
// TV 화면: 누가 냈는지만 보이고, 몇 마리 골랐는지는 보내지 않음
function displayView(room) {
  const v = teacherView(room);
  const g = room.game;
  v.role = 'd';
  // 출어 금지인 친구도 TV에서는 '제출'로 보여서 누가 벌칙을 받는지 드러나지 않게 함
  const show = !!(g.pact.reveal || g.pact.grad);
  v.game = {
    ...g, picks: g.picks.map((p, i) => (p != null || g.banned[i] ? true : null)),
    banned: g.banned.map(() => false), strikes: g.strikes.map(() => 0),
    history: g.history.map(({ picks, kept, violators, banNext, confiscated, ...h }) => ({
      ...h, violatorsCount: show ? violators.length : null, banNextCount: banNext.length,
    })),
  };
  return v;
}
function studentView(room, sid) {
  const num = seatOf(room, sid);
  if (!num) return { role: 's', kicked: true, code: room.code };
  const g = room.game, st = room.settings, i = idxOf(room, num);
  return {
    role: 's', code: room.code, phase: room.phase, rule: room.rule, settings: st,
    num, nick: room.seats[num].nick, gameNo: g.no,
    round: g.round, fish: g.fish, status: g.status, collapseRound: g.collapseRound,
    history: g.history.map(h => ({
      round: h.round, before: h.before, demand: h.demand, caught: h.caught, left: h.left, born: h.born, after: h.after,
      mine: h.picks[i], eaten: h.eaten, starvedCount: h.starved.length, meStarved: h.starved.includes(i),
      meViolated: h.violators.includes(i), myReturned: h.confiscated[i], meBanNext: h.banNext.includes(i),
      violatorsCount: g.pact.reveal || g.pact.grad ? h.violators.length : null, returned: h.returned, banNextCount: h.banNext.length,
    })),
    pact: g.pact, myStrikes: g.strikes[i], banned: g.banned[i],
    myPick: g.picks[i], myTotal: g.totals[i], alive: g.alive[i], deadRound: g.deadRound[i], reason: g.reason,
    aliveCount: g.alive.filter(Boolean).length,
    playingCount: g.alive.filter((a, j) => a && !g.banned[j]).length,
    submitted: g.picks.filter((p, j) => p != null && g.alive[j] && !g.banned[j]).length, joined: Object.keys(room.seats).length,
  };
}
function sendTo(c, room) {
  const v = c.role === 't' ? teacherView(room) : c.role === 'd' ? displayView(room) : studentView(room, c.sid);
  try { c.res.write(`data: ${JSON.stringify(v)}\n\n`); } catch (e) { /* 끊긴 연결 */ }
}
function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) sendTo(c, room);
}

/* ---------- 동작 ---------- */
function teacherAct(room, b) {
  const g = room.game, st = room.settings;
  switch (b.action) {
    case 'open':
      if (room.phase === 'lobby') room.phase = 'pick';
      break;
    case 'set': {
      if (room.phase !== 'pick') break;
      const i = +b.i, v = b.v == null ? null : +b.v;
      if (i >= 0 && i < st.n && g.alive[i] && !g.banned[i] && (v === null || !g.pact.cap || v <= g.pact.limit) && (v === null || (v >= 0 && v <= st.maxCatch))) g.picks[i] = v;
      break;
    }
    case 'fillEmpty': {
      if (room.phase !== 'pick') break;
      const v = Math.max(0, Math.min(st.maxCatch, +b.v || 0));
      g.picks = g.picks.map((p, i) => (p == null && g.alive[i] && !g.banned[i] ? v : p));
      break;
    }
    case 'clear':
      if (room.phase === 'pick') g.picks = g.picks.map(() => null);
      break;
    case 'resolve':
      if (room.phase === 'pick') resolveRound(room);
      break;
    case 'next':
      if (room.phase !== 'result') break;
      if (g.status === 'play') {
        g.round++;
        g.picks = Array(st.n).fill(null);
        room.phase = 'pick';
      } else {
        room.phase = 'end';
        room.past.push({
          no: g.no, ok: g.status === 'success', round: g.collapseRound, rounds: st.rounds,
          total: g.totals.reduce((a, c) => a + c, 0), rule: room.rule.trim(), pact: g.pact,
          alive: g.alive.filter(Boolean).length,
        });
      }
      break;
    case 'newgame':
      room.rule = String(b.rule || '').slice(0, 300);
      if (b.pact) room.pact = clampPact(b.pact, st);
      freshGame(room);
      break;
    case 'hint':
      room.hint = !room.hint;
      break;
    case 'kick':
      delete room.seats[+b.num];
      break;
    default:
      return false;
  }
  return true;
}
function joinSeat(room, b) {
  const st = room.settings;
  const num = parseInt(b.num, 10);
  if (!st.nums.includes(num)) return [400, { error: '번호를 다시 골라 주세요.' }];
  const nick = String(b.nick || '').trim().replace(/\s+/g, ' ').slice(0, 10);
  let sid = typeof b.sid === 'string' && /^[a-f0-9]{24}$/.test(b.sid) ? b.sid : null;
  const cur = room.seats[num];
  if (cur && cur.sid !== sid) return [409, { error: `${num}번에는 이미 누가 들어와 있어요. 선생님께 말해 주세요.` }];
  if (!sid) sid = rid(12);
  const old = seatOf(room, sid);
  if (old && old !== num) delete room.seats[old];
  room.seats[num] = { nick, sid };
  return [200, { sid, num }];
}

/* ---------- QR (외부 서비스 없이 서버에서 그림) ---------- */
function qrSVG(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#2e3a59"/></svg>`;
}

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', ch => { d += ch; if (d.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/s' || pathname === '/s/') pathname = '/s.html';
  if (pathname === '/tv' || pathname === '/tv/') pathname = '/tv.html';
  const fp = path.normalize(path.join(PUB, pathname));
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('찾을 수 없어요'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, q = url.searchParams;
  try {
    if (p === '/favicon.ico' || p === '/favicon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 26"><path d="M38 13 L28 4 Q27 13 28 22 Z" fill="#ff8a7a"/><ellipse cx="16" cy="13" rx="15" ry="10" fill="#ff8a7a"/><circle cx="9" cy="10.5" r="2.6" fill="#2e3a59"/></svg>');
    }
    if (p === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });

    if (p === '/api/qr') {
      const t = String(q.get('t') || '').slice(0, 200);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      return res.end(qrSVG(t));
    }
    if (p === '/api/room' && req.method === 'POST') {
      const b = await readBody(req);
      const room = createRoom(b.settings);
      return json(res, 200, { code: room.code, key: room.key });
    }
    if (p === '/api/check') {
      const room = rooms.get(q.get('c'));
      return json(res, room && room.key === q.get('key') ? 200 : 404, { ok: !!room });
    }
    if (p === '/api/info') {
      const room = rooms.get(q.get('c'));
      if (!room) return json(res, 404, { error: '그런 방이 없어요. 코드를 다시 확인해 주세요.' });
      return json(res, 200, { nums: room.settings.nums, taken: Object.keys(room.seats).map(Number) });
    }
    if (p === '/api/teacher' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.c));
      if (!room || room.key !== b.key) return json(res, 404, { error: '방이 없어요.' });
      const ok = teacherAct(room, b);
      if (ok) broadcast(room);
      return json(res, ok ? 200 : 400, { ok });
    }
    if (p === '/api/join' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.c));
      if (!room) return json(res, 404, { error: '그런 방이 없어요. 코드를 다시 확인해 주세요.' });
      const [code, out] = joinSeat(room, b);
      if (code === 200) broadcast(room);
      return json(res, code, out);
    }
    if (p === '/api/pick' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.c));
      if (!room) return json(res, 404, { error: '방이 없어요.' });
      const num = seatOf(room, b.sid);
      if (!num) return json(res, 404, { error: 'kicked' });
      if (room.phase !== 'pick') return json(res, 409, { error: '지금은 고를 수 없어요.' });
      const v = parseInt(b.v, 10);
      if (!(v >= 0 && v <= room.settings.maxCatch)) return json(res, 400, { error: '숫자를 다시 골라 주세요.' });
      const gi = idxOf(room, num);
      if (!room.game.alive[gi]) return json(res, 409, { error: '탈락해서 더 이상 물고기를 잡을 수 없어요.' });
      if (room.game.banned[gi]) return json(res, 409, { error: '이번 라운드는 출어 금지예요.' });
      if (room.game.pact.cap && v > room.game.pact.limit) return json(res, 409, { error: `약속 한도는 ${room.game.pact.limit}마리예요.` });
      room.game.picks[idxOf(room, num)] = v;
      broadcast(room);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/events') {
      const room = rooms.get(q.get('c'));
      const role = q.get('role');
      if (!room) return json(res, 404, { error: 'no room' });
      if (role === 't' && room.key !== q.get('key')) return json(res, 403, { error: 'key' });
      if (role !== 't' && role !== 's' && role !== 'd') return json(res, 400, { error: 'role' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      const c = { res, role, sid: role === 's' ? q.get('sid') : null };
      room.clients.add(c);
      if (role === 's') broadcast(room); else sendTo(c, room);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* noop */ } }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        room.clients.delete(c);
        if (role === 's') broadcast(room);
      });
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res, decodeURIComponent(p));
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: '서버 오류' });
  }
});

// 8시간 넘게 쓰지 않은 방 정리
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > 8 * 3600e3 && room.clients.size === 0) rooms.delete(code);
  }
}, 10 * 60e3);

server.listen(PORT, () => console.log(`물고기 마을의 호수: http://localhost:${PORT}`));
