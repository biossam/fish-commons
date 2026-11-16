// 공격자 시나리오 실험 (로컬 서버 대상)
import http from 'node:http';
import net from 'node:net';
// 사용법: PORT=3123 node server.js 를 켠 뒤 node tools/security-check.mjs
// ⚠️ 실제 수업 서버(onrender.com)에는 돌리지 마세요. 내 IP가 10분 동안 막힐 수 있어요.
const B = process.env.BASE || 'http://localhost:3123';
let ipn = 1; const freshIp = () => `10.0.${Math.floor(ipn / 250)}.${(ipn++ % 250) + 1}`;
const T = (ip) => ({ 'Content-Type': 'application/json', 'X-Forwarded-For': ip });
const post = async (u, b, ip, ct) => { const r = await fetch(B + u, { method: 'POST', headers: { ...T(ip), ...(ct ? { 'Content-Type': ct } : {}) }, body: typeof b === 'string' ? b : JSON.stringify(b) }); let d = {}; try { d = await r.json(); } catch {} return { s: r.status, d }; };
const get = async (u, ip) => { const r = await fetch(B + u, { headers: { 'X-Forwarded-For': ip } }); return r; };
const sseFirst = (u, ip, ms = 3000) => new Promise(res => {
  const req = http.get(B + u, { headers: { 'X-Forwarded-For': ip } }, r => {
    let buf = ''; const t = setTimeout(() => { req.destroy(); res({ s: r.statusCode, data: null, open: true }); }, ms);
    r.on('data', ch => { buf += ch; const m = buf.match(/data: (.*)\n\n/); if (m) { clearTimeout(t); res({ s: r.statusCode, data: JSON.parse(m[1]), res: r, req }); } });
    r.on('end', () => { clearTimeout(t); res({ s: r.statusCode, data: null, ended: true }); });
  });
  req.on('error', () => res({ s: 0 }));
});
const out = []; const ok = (name, pass, detail = '') => out.push(`${pass ? '✅ 막힘' : '❌ 뚫림'}  ${name}${detail ? '  — ' + detail : ''}`);

const T_IP = freshIp();
const room = await post('/api/room', { settings: { maxNum: 24, skip: '16' } }, T_IP);
const { code, key } = room.d;
const tview = await sseFirst(`/api/events?c=${code}&role=t&key=${key}`, T_IP); const viewKey = tview.data.viewKey; tview.req.destroy();
const S_IP = freshIp();
const s1 = await post('/api/join', { c: code, num: 1, nick: '정상학생' }, S_IP);

// 1. 방 코드 맞히기
{ const ip = freshIp(); let last; for (let i = 0; i < 40; i++) last = await post('/api/join', { c: String(100000 + i), num: 1 }, ip);
  const after = await post('/api/join', { c: code, num: 2 }, ip);
  ok('방 코드 맞히기 (한 기기에서 서로 다른 코드 40개)', after.s === 429, `40번째 뒤엔 진짜 코드도 ${after.s}`); }
// 1-b. 옛 코드 하나로 반 전체가 404 (서버 재시작 상황)
{ const ip = freshIp(); for (let i = 0; i < 60; i++) await get('/api/info?c=999999', ip); const r = await get(`/api/info?c=${code}`, ip);
  ok('서버 재시작 뒤 같은 옛 코드 60번 (반 전체 상황은 막지 않아야 함)', r.status === 200, `진짜 코드 응답 ${r.status}`); }
// 2. TV 몰래 보기
{ const ip = freshIp(); const a = await sseFirst(`/api/events?c=${code}&role=d`, ip); const b = await sseFirst(`/api/events?c=${code}&role=d&v=0000000000000000`, ip);
  ok('참여 코드만으로 TV 화면 엿보기', a.s === 404 && b.s === 404, `키 없음 ${a.s}, 가짜 키 ${b.s}`); }
// 3. 선생님 행세
{ const ip = freshIp(); const a = await post('/api/teacher', { c: code, key: 'x'.repeat(24), action: 'kick', num: 1 }, ip);
  const b = await sseFirst(`/api/events?c=${code}&role=t&key=abc`, ip);
  ok('선생님 키 없이 조작·엿보기', a.s === 404 && b.s === 404, `조작 ${a.s}, 엿보기 ${b.s}`); }
// 4. 다른 학생 자리 빼앗기
{ const ip = freshIp(); const a = await post('/api/join', { c: code, num: 1, nick: '가짜' }, ip);
  ok('이미 들어온 번호 빼앗기', a.s === 409, `${a.s}`); }
// 5. 숫자 조작
{ const bad = [-1, 99, 1.5, '2; DROP', null, '9999999999']; const rs = [];
  await post('/api/teacher', { c: code, key, action: 'open' }, T_IP);
  for (const v of bad) rs.push((await post('/api/pick', { c: code, sid: s1.d.sid, v }, S_IP)).s);
  const st = (await sseFirst(`/api/events?c=${code}&role=s&sid=${s1.d.sid}`, S_IP)); st.req && st.req.destroy();
  ok('물고기 수 조작 (-1, 99, 1.5, 문자, 빈값)', st.data.myPick == null || (st.data.myPick >= 0 && st.data.myPick <= 3), `응답 ${rs.join(',')} / 저장된 값 ${st.data.myPick}`); }
// 6. 다른 학생 선택 엿보기
{ await post('/api/pick', { c: code, sid: s1.d.sid, v: 3 }, S_IP);
  const s2 = await post('/api/join', { c: code, num: 2, nick: '엿보기' }, S_IP);
  const v = await sseFirst(`/api/events?c=${code}&role=s&sid=${s2.d.sid}`, S_IP); v.req && v.req.destroy();
  const txt = JSON.stringify(v.data);
  ok('학생 기기에서 다른 친구 선택 엿보기', !('picks' in v.data) && !txt.includes('"key"') && !txt.includes('viewKey'), `받은 항목: ${Object.keys(v.data).slice(0, 8).join(',')}…`);
  const tv = await sseFirst(`/api/events?c=${code}&role=d&v=${viewKey}`, freshIp()); tv.req && tv.req.destroy();
  ok('TV 데이터에서 선택 숫자 엿보기', tv.data.game.picks.every(p => p === null || p === true) && !JSON.stringify(tv.data).includes(key), 'TV에는 제출 여부(true)만'); }
// 7. 연결 폭탄
{ const ip = freshIp(); const conns = []; for (let i = 0; i < 30; i++) conns.push(await sseFirst(`/api/events?c=${code}&role=s&sid=${'f'.repeat(24)}`, ip, 800));
  ok('가짜 학생으로 연결 30개 붙잡기', conns.every(c => c.ended || (c.data && c.data.kicked)), '자리 없는 기기는 바로 끊김');
  const mine = []; for (let i = 0; i < 10; i++) { const c = await sseFirst(`/api/events?c=${code}&role=s&sid=${s1.d.sid}`, S_IP, 800); mine.push(c); }
  await new Promise(r => setTimeout(r, 300)); const alive = mine.filter(c => c.res && !c.res.readableEnded && !c.res.destroyed && !c.res.complete).length;
  mine.forEach(c => c.req && c.req.destroy());
  ok('진짜 학생 sid로 연결 10개 열기', alive <= 2, `살아 있는 연결 ${alive}개 (최대 2)`); }
// 8. CSRF (다른 사이트에서 폼으로 몰래 보내기)
{ const a = await post('/api/join', `{"c":"${code}","num":3}`, freshIp(), 'text/plain');
  ok('다른 사이트에서 폼으로 몰래 요청 (CSRF)', a.s === 415, `${a.s}`); }
// 9. 별명으로 화면 공격 (XSS, 글자 뒤집기)
{ const nick = '<script>alert(1)</script>‮거꾸로'; const a = await post('/api/join', { c: code, num: 4, nick }, freshIp());
  const tv = await sseFirst(`/api/events?c=${code}&role=t&key=${key}`, T_IP); tv.req && tv.req.destroy(); const saved = tv.data.seats[4].nick;
  ok('별명에 스크립트·글자 뒤집기 문자 넣기', !/[<>‮]/.test(saved), `저장된 별명: "${saved}"`); }
// 10. 입장 잠금
{ await post('/api/teacher', { c: code, key, action: 'lock' }, T_IP);
  const a = await post('/api/join', { c: code, num: 5 }, freshIp()); const b = await post('/api/join', { c: code, num: 1, sid: s1.d.sid }, S_IP);
  ok('입장 잠근 뒤 낯선 기기 들어오기', a.s === 423 && b.s === 200, `낯선 기기 ${a.s}, 원래 학생 다시 연결 ${b.s}`);
  await post('/api/teacher', { c: code, key, action: 'lock' }, T_IP); }
// 11. 설정 조작 (터무니없는 값, __proto__)
{ const r = await post('/api/room', JSON.parse('{"settings":{"maxNum":99999,"start":-5,"rounds":1e9,"maxCatch":100,"__proto__":{"admin":true}}}'), freshIp());
  const v = await sseFirst(`/api/events?c=${r.d.code}&role=t&key=${r.d.key}`, freshIp()); v.req && v.req.destroy(); const st = v.data.settings;
  ok('터무니없는 설정값·__proto__ 넣기', st.maxNum <= 40 && st.start >= 5 && st.rounds <= 20 && st.maxCatch <= 5 && ({}).admin === undefined, `maxNum ${st.maxNum}, 라운드 ${st.rounds}, 최대 ${st.maxCatch}`); }
// 12. 큰 요청
{ const big = JSON.stringify({ c: code, nick: 'a'.repeat(200000) }); const a = await post('/api/join', big, freshIp());
  ok('아주 큰 요청 보내기 (200KB)', a.s >= 400 && a.s < 500, `${a.s}`); }
// 13. 서버 파일 훔치기
{ const rs = []; for (const u of ['/../server.js', '/%2e%2e/server.js', '/%2e%2e%2fserver.js', '/..%5cserver.js', '/vendor/QRCode/index.js', '/.git/config']) { const r = await new Promise(res => http.get({ host: new URL(B).hostname, port: +new URL(B).port || 80, path: u }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res({ s: r.statusCode, leak: b.includes('createServer') || b.includes('[core]') })); })); rs.push(r); }
  ok('서버 코드·설정 파일 훔치기 (경로 조작)', rs.every(r => !r.leak), rs.map(r => r.s).join(',')); }
// 14. QR 생성기 악용
{ const r = await get('/api/qr?t=' + encodeURIComponent('https://evil.example/phish'), freshIp());
  ok('QR 만들기를 피싱 주소에 악용', r.status === 400, `${r.status}`); }
// 15. 방 만들기 폭탄
{ const ip = freshIp(); let last; for (let i = 0; i < 35; i++) last = await post('/api/room', {}, ip);
  ok('한 기기에서 방 35개 만들기', last.s === 429, `35번째 ${last.s}`); }
// 16. slowloris (머리글을 아주 느리게 보내기)
{ const closed = await new Promise(res => { const s = net.connect(+new URL(B).port || 80, new URL(B).hostname, () => { s.write('GET / HTTP/1.1\r\nHost: x\r\n'); }); const t = setTimeout(() => { s.destroy(); res(false); }, 20000); s.resume(); s.on('close', () => { clearTimeout(t); res(true); }); s.on('error', () => {}); });
  ok('머리글을 끝내지 않고 연결 붙잡기 (slowloris)', closed, closed ? '10초 안에 서버가 끊음' : '20초 넘게 붙잡힘'); }
// 17. 정상 실시간 연결은 오래 유지되는지 (보안 설정의 부작용 확인)
{ const c = await sseFirst(`/api/events?c=${code}&role=s&sid=${s1.d.sid}`, S_IP); await new Promise(r => setTimeout(r, 17000));
  const alive = c.res && !c.res.complete && !c.res.destroyed; c.req && c.req.destroy();
  ok('(부작용 점검) 정상 학생 연결이 17초 뒤에도 유지', alive, alive ? '유지됨' : '끊김'); }
console.log(out.join('\n'));
