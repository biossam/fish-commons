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
    const c = String(crypto.randomInt(100000, 1000000)); // 6자리: 맞히기 어렵게
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
// 방이 가득 차면, 아무도 접속해 있지 않고 30분 넘게 안 쓴 방부터 정리
function makeSpace() {
  if (rooms.size < MAX_ROOMS) return true;
  let oldest = null;
  for (const r of rooms.values()) if (r.clients.size === 0 && Date.now() - r.touched > 30 * 60e3 && (!oldest || r.touched < oldest.touched)) oldest = r;
  if (oldest) { rooms.delete(oldest.code); return true; }
  return false;
}
function createRoom(settings) {
  const room = {
    code: newCode(), key: rid(12), viewKey: rid(8), locked: false, settings: clampSettings(settings), rule: '', pact: null,
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
  return { role: 't', code: room.code, settings: room.settings, phase: room.phase, rule: room.rule, pact: room.pact, hint: room.hint, locked: room.locked, viewKey: room.viewKey, seats, game: room.game, past: room.past };
}
// TV 화면: 누가 냈는지만 보이고, 몇 마리 골랐는지는 보내지 않음
function displayView(room) {
  const v = teacherView(room);
  const g = room.game;
  v.role = 'd';
  delete v.viewKey;
  // 출어 금지인 친구도 TV에서는 '제출'로 보여서 누가 벌칙을 받는지 드러나지 않게 함
  const show = !!(g.pact.reveal || g.pact.grad);
  v.game = {
    ...g, picks: g.picks.map((p, i) => (p != null || g.banned[i] ? true : null)),
    banned: g.banned.map(() => false), strikes: g.strikes.map(() => 0),
    totals: [...g.totals].sort((a, b) => b - a), totalsSorted: true, // 누가 몇 마리인지 연결 못 하게
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
      room.rule = cleanMulti(b.rule, 300);
      if (b.pact) room.pact = clampPact(b.pact, st);
      freshGame(room);
      break;
    case 'hint':
      room.hint = !room.hint;
      break;
    case 'lock':
      room.locked = !room.locked;
      break;
    case 'roster': {
      // 학생 수(마지막 번호·결번)는 첫 판 시작 전 대기실에서만 바꿀 수 있음
      if (room.phase !== 'lobby' || g.history.length || room.gameNo !== 1) break;
      room.settings = clampSettings({ ...st, maxNum: b.maxNum, skip: cleanText(b.skip, 120) });
      for (const n in room.seats) if (!room.settings.nums.includes(+n)) delete room.seats[n];
      room.pact = clampPact(room.pact, room.settings);
      room.gameNo--;
      freshGame(room);
      break;
    }
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
  const nick = cleanText(b.nick, 10);
  let sid = typeof b.sid === 'string' && /^[a-f0-9]{24}$/.test(b.sid) ? b.sid : null;
  // 입장 잠금: 이미 들어와 있던 기기(같은 sid)만 다시 들어올 수 있음
  if (room.locked && !(sid && seatOf(room, sid))) return [423, { error: '선생님이 입장을 잠갔어요. 선생님께 말해 주세요.' }];
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

/* ---------- 보안: 접속 횟수 제한 · 키 확인 · 입력 정리 ---------- */
// 한 반(23명)이 학교의 같은 공인 IP로 들어오는 것을 생각해 넉넉하게 잡음
const LIMITS = {
  room: [30, 60 * 60e3],    // 방 만들기: 1시간에 30번
  join: [300, 10 * 60e3],   // 들어가기
  pick: [4000, 10 * 60e3],  // 고르기
  info: [800, 10 * 60e3],   // 방 정보
  events: [800, 10 * 60e3], // 실시간 연결
  teacher: [3000, 10 * 60e3],
};
// 없는 방 코드를 '서로 다른 코드로' 여러 번 넣으면 잠시 막음 (코드 맞히기 막기).
// 서버가 다시 시작되어 반 전체가 같은 옛 코드로 404를 받는 경우는 코드가 1개라 막히지 않음
const MISS_CODES = 30, MISS_WINDOW = 10 * 60e3;
const misses = new Map();
const MAX_ROOMS = 300, MAX_CLIENTS_PER_ROOM = 120;
const hits = new Map();
function clientIp(req) {
  const h = req.headers;
  return String(h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
}
function overLimit(req, bucket) {
  if (hits.size > 50000) hits.clear(); // 아주 많은 주소로 공격해도 메모리가 넘치지 않게
  const [max, win] = LIMITS[bucket];
  const k = bucket + '|' + clientIp(req), now = Date.now();
  let h = hits.get(k);
  if (!h || now > h.reset) { h = { n: 0, reset: now + win }; hits.set(k, h); }
  h.n++;
  return h.n > max;
}
function noteMiss(req, code) {
  if (misses.size > 50000) misses.clear();
  const ip = clientIp(req), now = Date.now();
  let m = misses.get(ip);
  if (!m || now > m.reset) { m = { codes: new Set(), reset: now + MISS_WINDOW }; misses.set(ip, m); }
  if (m.codes.size < 1000) m.codes.add(String(code).slice(0, 12));
}
function blockedForGuessing(req) {
  const m = misses.get(clientIp(req));
  return !!m && Date.now() <= m.reset && m.codes.size > MISS_CODES;
}
function keyOk(room, key) {
  if (!room || typeof key !== 'string' || key.length !== room.key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(room.key));
}
// 글자 수와 위험한 기호를 정리 (화면에서도 한 번 더 escape 함)
const BIDI = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g; // 글자 방향을 뒤집거나 숨기는 문자
const cleanText = (t, n) => String(t == null ? '' : t).replace(BIDI, '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanMulti = (t, n) => String(t == null ? '' : t).replace(BIDI, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>`]/g, '').slice(0, n);

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    let big = false;
    req.on('data', ch => { if (big) return; d += ch; if (d.length > 20000) { big = true; d = ''; finish({}); } });
    req.on('end', () => { if (big) return; try { finish(JSON.parse(d || '{}')); } catch (e) { finish({}); } });
    req.on('error', () => finish({}));
    req.on('close', () => finish({}));
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

// connectionsCheckingInterval: 느린 연결을 2초마다 검사 (기본 30초라 slowloris에 약함)
const server = http.createServer({ headersTimeout: 10e3, requestTimeout: 15e3, connectionsCheckingInterval: 2e3 }, async (req, res) => {
  for (const k in SEC_HEADERS) res.setHeader(k, SEC_HEADERS[k]);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, q = url.searchParams;
  const tooMany = () => json(res, 429, { error: '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.' });
  const noRoom = (msg, code) => { noteMiss(req, code); return json(res, 404, { error: msg }); };
  try {
    if (p.startsWith('/api/') && blockedForGuessing(req) && p !== '/api/qr') return tooMany();
    if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n'); }
    if (p === '/favicon.ico' || p === '/favicon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 26"><path d="M38 13 L28 4 Q27 13 28 22 Z" fill="#ff8a7a"/><ellipse cx="16" cy="13" rx="15" ry="10" fill="#ff8a7a"/><circle cx="9" cy="10.5" r="2.6" fill="#2e3a59"/></svg>');
    }
    if (p === '/healthz') return json(res, 200, { ok: true });
    // 다른 사이트에서 몰래 보내는 요청(CSRF) 막기: POST는 JSON으로만 받음
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'json only' });

    if (p === '/api/qr') {
      const t = String(q.get('t') || '').slice(0, 120);
      if (!/^https?:\/\/[a-z0-9.:-]+\/s\?c=\d{6}$/i.test(t)) return json(res, 400, { error: 'qr' }); // 참여 주소만 QR로 만듦
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      return res.end(qrSVG(t));
    }
    if (p === '/api/room' && req.method === 'POST') {
      if (overLimit(req, 'room')) return tooMany();
      if (!makeSpace()) return json(res, 503, { error: '지금은 방을 더 만들 수 없어요. 잠시 뒤 다시 해 주세요.' });
      const b = await readBody(req);
      const room = createRoom(b.settings);
      return json(res, 200, { code: room.code, key: room.key });
    }
    if (p === '/api/check') {
      const room = rooms.get(q.get('c'));
      return json(res, keyOk(room, q.get('key')) ? 200 : 404, { ok: !!room });
    }
    if (p === '/api/info') {
      if (overLimit(req, 'info')) return tooMany();
      const room = rooms.get(q.get('c'));
      if (!room) return noRoom('그런 방이 없어요. 코드를 다시 확인해 주세요.', q.get('c') || '');
      return json(res, 200, { nums: room.settings.nums, taken: Object.keys(room.seats).map(Number) });
    }
    if (p === '/api/teacher' && req.method === 'POST') {
      if (overLimit(req, 'teacher')) return tooMany();
      const b = await readBody(req);
      const room = rooms.get(String(b.c));
      if (!keyOk(room, b.key)) return noRoom('방이 없어요.', 'key:' + b.c);
      const ok = teacherAct(room, b);
      if (ok) broadcast(room);
      return json(res, ok ? 200 : 400, { ok });
    }
    if (p === '/api/join' && req.method === 'POST') {
      if (overLimit(req, 'join')) return tooMany();
      const b = await readBody(req);
      const room = rooms.get(String(b.c));
      if (!room) return noRoom('그런 방이 없어요. 코드를 다시 확인해 주세요.', b.c);
      const [code, out] = joinSeat(room, b);
      if (code === 200) broadcast(room);
      return json(res, code, out);
    }
    if (p === '/api/pick' && req.method === 'POST') {
      if (overLimit(req, 'pick')) return tooMany();
      const b = await readBody(req);
      const room = rooms.get(String(b.c));
      if (!room) return noRoom('방이 없어요.', b.c);
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
      if (overLimit(req, 'events')) return tooMany();
      const room = rooms.get(q.get('c'));
      const role = q.get('role');
      if (!room) return noRoom('no room', q.get('c'));
      if (role === 't' && !keyOk(room, q.get('key'))) return noRoom('key', 'key:' + q.get('c'));
      if (role !== 't' && role !== 's' && role !== 'd') return json(res, 400, { error: 'role' });
      // TV 화면은 선생님 화면이 준 보기용 키가 있어야 함 (코드만 알아서는 못 봄)
      if (role === 'd' && !(typeof q.get('v') === 'string' && q.get('v') === room.viewKey)) return noRoom('view', 'view:' + q.get('c'));
      const sid = role === 's' ? String(q.get('sid') || '') : null;
      // 자리가 없는 학생 기기: '자리 비움'을 한 번 알리고 바로 끊음 (연결만 쌓아 두는 공격 막기)
      if (role === 's' && !seatOf(room, sid)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(`retry: 600000\ndata: ${JSON.stringify({ role: 's', kicked: true, code: room.code })}\n\n`);
        return;
      }
      // 같은 기기(학생 sid / 선생님 / TV)가 연결을 여러 개 열면 오래된 것부터 끊음
      const same = [...room.clients].filter(x => x.role === role && (role !== 's' || x.sid === sid));
      const maxSame = role === 's' ? 2 : 4;
      while (same.length >= maxSame) { const old = same.shift(); room.clients.delete(old); try { old.res.end(); } catch (e) { /* noop */ } }
      if (room.clients.size >= MAX_CLIENTS_PER_ROOM) return tooMany();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      const c = { res, role, sid };
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
    if (req.method === 'GET') {
      let dp;
      try { dp = decodeURIComponent(p); } catch (e) { res.writeHead(400); return res.end(); }
      return serveStatic(req, res, dp);
    }
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: '서버 오류' });
  }
});

// 오래된 접속 기록 정리
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (now > h.reset) hits.delete(k);
  for (const [k, m] of misses) if (now > m.reset) misses.delete(k);
}, 5 * 60e3);
// 예상하지 못한 오류가 나도 서버가 꺼지지 않게 (수업 중 방이 사라지지 않도록)
process.on('uncaughtException', e => console.error('uncaught', e && e.message));
process.on('unhandledRejection', e => console.error('unhandled', e && e.message));

// 8시간 넘게 쓰지 않은 방 정리
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > 8 * 3600e3 && room.clients.size === 0) rooms.delete(code);
  }
}, 10 * 60e3);

// 느리게 보내서 연결을 붙잡아 두는 공격(slowloris) 막기. 실시간 연결(SSE)은 응답이라 영향 없음
server.keepAliveTimeout = 65e3;
server.listen(PORT, () => console.log(`물고기 마을의 호수: http://localhost:${PORT}`));
