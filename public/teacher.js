/* 선생님 조작 화면(/)과 TV 화면(/tv)이 함께 쓰는 코드. TV 화면은 window.TV_MODE = true */
const TV=!!window.TV_MODE;
const DEF={maxNum:24,skip:'16',start:100,cap:100,growth:50,maxCatch:3,rounds:10,eat:1,out:'empty'};
const app=document.getElementById('app'),modal=document.getElementById('modal');
let L=TV?{}:loadLocal();
L.settings={...DEF,...(L.settings||{})};
if(L.hide==null)L.hide=false;
let V=null,es=null,lastKey='',connected=false,gone=false,rosterDraft=null;
const rosterTarget=()=>rosterDraft||L.settings;

function loadLocal(){try{return JSON.parse(localStorage.getItem('fish-teacher'))||{}}catch(e){return{}}}
function saveLocal(){if(TV)return;try{localStorage.setItem('fish-teacher',JSON.stringify(L))}catch(e){}}
function tvURL(){return location.origin+'/tv?c='+V.code+'&v='+V.viewKey}
function joinURL(){return location.origin+'/s'}
/* 학급 학생 수: 마지막 번호 + 결번(번호를 눌러 켜고 끄기) */
function skipSet(st){return new Set((String(st.skip).match(/\d+/g)||[]).map(Number).filter(n=>n>=1&&n<=st.maxNum))}
function rosterHTML(st,inModal){const skip=skipSet(st),n=st.maxNum-skip.size;let g='';
  for(let i=1;i<=st.maxNum;i++)g+=`<button class="rnum ${skip.has(i)?'off':''}" data-act="rosterToggle" data-n="${i}" title="${skip.has(i)?'결번 (누르면 다시 넣어요)':'누르면 결번으로 빼요'}">${i}</button>`;
  return `<div class="rhead"><h2>👩‍🏫 우리 반 학생 수</h2><span class="pill">학생 <b>${n}</b>명</span>${skip.size?`<span class="muted">결번: ${[...skip].sort((a,b)=>a-b).join(', ')}번</span>`:''}</div>
    <div class="limitrow" style="background:#e6f4ff">마지막 번호 <button data-act="rosterMax" data-d="-1">−</button><b style="color:#2a86c4">${st.maxNum}</b><button data-act="rosterMax" data-d="1">+</button> 번</div>
    <p class="muted" style="margin:10px 0 6px">전학 갔거나 없는 번호는 눌러서 빼 주세요. 다시 누르면 돌아와요.</p>
    <div class="rgrid">${g}</div>
    ${inModal?`<div class="startrow"><button class="btn" data-act="cancel">취소</button><button class="btn primary" data-act="rosterSave">이대로 바꾸기</button></div>`:''}`}
function numsOf(st){const skip=new Set((String(st.skip).match(/\d+/g)||[]).map(Number));const a=[];for(let i=1;i<=st.maxNum;i++)if(!skip.has(i))a.push(i);return a}
function label(i){const num=V.settings.nums[i],s=V.seats[num];return s&&s.nick?`${num}번 ${s.nick}`:`${num}번`}
const isAlive=i=>!V.game.alive||V.game.alive[i];
const aliveCount=()=>V.game.alive?V.game.alive.filter(Boolean).length:V.settings.n;

/* ---------- 연결 ---------- */
async function boot(){
  if(TV){const qs=new URLSearchParams(location.search),c=qs.get('c'),v=qs.get('v');if(c&&/^\d{6}$/.test(c)&&v&&/^[a-f0-9]{16}$/.test(v)){L.auth={code:c,view:v};connect()}else renderTVCode();return}
  if(L.auth){
    try{const r=await fetch(`/api/check?c=${L.auth.code}&key=${L.auth.key}`);if(r.ok){connect();return}}catch(e){}
    L.auth=null;saveLocal();
  }
  renderIntro();
}
function connect(){
  if(es)es.close();
  gone=false;
  es=new EventSource(TV?`/api/events?c=${L.auth.code}&role=d&v=${L.auth.view}`:`/api/events?c=${L.auth.code}&role=t&key=${L.auth.key}`);
  es.onmessage=ev=>{connected=true;V=JSON.parse(ev.data);update()};
  es.onerror=async()=>{connected=false;setConn();
    try{if(TV){const r=await fetch(`/api/info?c=${L.auth.code}`);if(r.status===404){es.close();V=null;renderTVCode('방이 사라졌어요. 선생님 화면에서 새 방을 만든 뒤, 새 코드를 넣어 주세요.')}return}
      const r=await fetch(`/api/check?c=${L.auth.code}&key=${L.auth.key}`);
      if(r.status===404){es.close();gone=true;L.auth=null;saveLocal();V=null;renderIntro('서버가 다시 시작되어 방이 사라졌어요. 새 방을 만들어 주세요. (학생들도 새 코드로 다시 들어와야 해요)')}}catch(e){}};
}
function setConn(){const el=document.getElementById('conn');if(el){el.className='conn'+(connected?'':' off');el.lastChild.textContent=connected?' 연결됨':' 다시 연결 중…'}}
async function act(action,extra){if(!L.auth||TV)return;const r=await post('/api/teacher',{c:L.auth.code,key:L.auth.key,action,...(extra||{})});
  if(!r.ok&&r.status===404){renderIntro('방을 찾을 수 없어요. 새 방을 만들어 주세요.')}}

function update(){
  const g=V.game,key=[V.phase,g.no,g.round,g.status,V.hint,V.locked,V.settings.n,V.settings.maxNum].join('|');
  if(key!==lastKey){lastKey=key;render();return}
  if(V.phase==='pick')renderGrid();
  else if(V.phase==='lobby')renderSeats();
  setConn();
}
function render(){
  modal.innerHTML='';
  if(!V)return TV?renderTVCode():renderIntro();
  if(V.phase==='lobby')renderLobby();
  else if(V.phase==='pick')renderPlay();
  else if(V.phase==='result'){renderPlay();showRoundModal()}
  else renderEnd();
  setConn();
}

/* ---------- 공통 머리 ---------- */
function topHTML(){let dots='';
  if(V&&V.phase!=='lobby'){const g=V.game,st=V.settings;
    for(let r=1;r<=st.rounds;r++){let c='';
      if(g.status==='collapsed'&&r>=g.collapseRound)c=r===g.collapseRound?'now':'dead';
      else if(g.status==='success'||r<g.round)c='done';else if(r===g.round)c='now';
      dots+=`<div class="rdot ${c}">${r}</div>`}}
  return `<div class="top"><div class="logo"><img class="logobadge" src="/img/badge.png" alt="물고기 마을의 호수 배지">
    <div><h1>물고기 마을의 호수</h1><small>공유지의 비극 체험 게임</small></div></div>
    <div class="rounds">${dots}</div>
    ${V?`<button class="codechip" data-act="qr">참여 코드 <b>${V.code}</b></button>
      <span class="conn" id="conn"><i></i> 연결됨</span>
      ${TV?'':`<a class="btn small" href="${tvURL()}" target="_blank" rel="noopener" style="text-decoration:none">📺 TV 화면 열기</a>
      <button class="btn small" data-act="leave">🚪 방 나가기</button>`}`:''}</div>`}
function tvTip(){return TV?'':`<div class="rulebar" style="background:#e6f4ff;border-color:var(--blue)"><b>🧑‍🏫 선생님 조작 화면</b><span>학생들이 고른 숫자가 보이는 화면이에요. 반 전체에는 <a href="${tvURL()}" target="_blank" rel="noopener"><b>📺 TV 화면</b></a>(${esc(tvURL())})을 띄워 주세요.</span></div>`}
function ruleBar(){return tvTip()+(V?pactBar(V.game.pact,V.rule):'')}
const isBanned=i=>!!(V.game.banned&&V.game.banned[i]);
function pactDraft(){if(!L.pactDraft){const P=V&&V.pact;L.pactDraft=pactOn(P)?{...P}:{limit:1,reveal:false,ret:true,ban:false,grad:false,cap:false}}return L.pactDraft}

/* ---------- 처음 화면 ---------- */
function renderIntro(notice){
  V=null;lastKey='';const st=L.settings,nums=numsOf(st),n=nums.length;
  const sim={...st};
  app.innerHTML=topHTML()+`
  ${notice?`<div class="rulebar" style="background:var(--coral2);border-color:var(--coral)">⚠️ ${esc(notice)}</div>`:''}
  <div class="card hero">
    <div>
      <h2>호수의 물고기는<br><em>모두의 것</em>이에요.</h2>
      <p class="story">우리 반 <b>${n}명</b>은 작은 섬마을의 어부예요. 마을에는 호수가 딱 하나 있고, 지금 물고기가 <b>${st.start}마리</b> 살고 있어요.
      물고기를 많이 잡을수록 부자가 되지만, 호수가 텅 비어 버리면 마을 사람 <b>모두</b>가 살아갈 수 없어요.<br>
      <b>${st.rounds}라운드</b>가 끝날 때까지 다 함께 물고기를 잡을 수 있을까요?</p>
    </div>
    ${lakeHTML(st.start,st.cap)}
  </div>
  <div class="rules">
    <div class="rule r1"><span class="num">규칙 1</span><h3>몰래 정해요</h3>라운드마다 내 기기에서 물고기를 <b>0~${st.maxCatch}마리</b> 중에 몇 마리 잡을지 몰래 골라요.</div>
    <div class="rule r2"><span class="num">규칙 2</span><h3>물고기가 늘어나요</h3>잡고 남은 물고기의 <b>${st.growth}%</b>만큼 새끼가 태어나요. 단, 호수에는 최대 <b>${st.cap}마리</b>까지만 살 수 있어요.</div>
    <div class="rule r3"><span class="num">규칙 3</span><h3>텅 비면 모두 아웃</h3>잡으려는 물고기가 호수의 물고기보다 많아 <b>호수가 텅 비면</b> 마을 모두의 수명 아웃! 잡아 둔 물고기도 모두 사라져요.</div>
    ${st.eat>0?`<div class="rule r5"><span class="num">규칙 4</span><h3>먹고 살아요</h3>라운드가 끝날 때마다 살기 위해 내 물고기 <b>${st.eat}마리</b>를 먹어요. ${st.out==='zero'?'먹고 나서 내 물고기가 <b>0마리</b>면 탈락!':'먹을 물고기가 <b>없으면</b> 탈락! (먹고 0마리가 되는 건 괜찮아요)'} 탈락하면 다음 라운드에 나갈 수 없어요.</div>`:''}
    <div class="rule r4"><span class="num">규칙 ${st.eat>0?5:4}</span><h3>끝까지 살아남기</h3><b>${st.rounds}라운드</b>까지 호수를 지키면, ${st.eat>0?'먹고 남은':'그동안 잡은'} 물고기가 내 점수가 돼요.</div>
  </div>
  <div class="introgrid">
    <div class="card tips"><h3>🧑‍🏫 진행 방법</h3><ol>
      <li><b>방 만들기</b>를 누르면 참여 코드와 QR이 나와요. 학생은 크롬북이나 휴대폰으로 <b>${esc(joinURL())}</b>에 들어와 <b>번호</b>를 골라요. (닉네임은 넣어도 되고 안 넣어도 돼요)</li>
      <li>라운드를 시작하면 학생들이 자기 기기에서 몰래 고르고, 화면에는 <b>누가 냈는지</b>만 보여요.</li>
      <li>기기가 없는 학생은 선생님이 그 학생 칸을 눌러 대신 입력할 수 있어요.</li>
      <li>처음 몇 라운드는 <b>대화 금지</b>로 하고, 호수가 줄어들기 시작하면 <b>마을 회의</b> 시간을 줘 보세요.</li>
      <li>끝나면 토론하고, <b>우리 반 약속</b>을 정해 다시 해요. 학생들은 다시 들어올 필요 없이 그대로 이어서 해요.</li>
    </ol></div>
    <div class="card">
      <details class="settings"><summary>게임 설정 바꾸기</summary>
      <p class="muted" style="margin:6px 0 0">번호 범위와 결번, 라운드, 물고기 수를 바꿀 수 있어요. 방을 만든 뒤에는 바꿀 수 없어요.</p>
      <div class="sgrid">
        <label>라운드 수<input type="number" min="3" max="20" data-set="rounds" value="${st.rounds}"></label>
        <label>1인당 최대 잡기<input type="number" min="1" max="5" data-set="maxCatch" value="${st.maxCatch}"></label>
        <label>처음 물고기 수<input type="number" min="5" max="300" data-set="start" value="${st.start}"></label>
        <label>호수 최대 물고기 수<input type="number" min="10" max="300" data-set="cap" value="${st.cap}"></label>
        <label>번식률 (남은 물고기의 %)<input type="number" min="0" max="100" data-set="growth" value="${st.growth}"></label>
        <label>라운드마다 먹는 물고기 (0이면 끔)<input type="number" min="0" max="3" data-set="eat" value="${st.eat}"></label>
        <label>탈락 기준<select data-set="out" style="border:2px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;font-size:16px;color:var(--ink)">
          <option value="empty" ${st.out!=='zero'?'selected':''}>먹을 물고기가 없을 때 (추천)</option>
          <option value="zero" ${st.out==='zero'?'selected':''}>먹고 나서 0마리가 될 때</option></select></label>
      </div>
      <p class="muted">호수가 가득 찼을 때 반 전체가 한 라운드에 <b>${safeCatch(sim,st.cap)}마리</b>까지 잡아야 호수가 줄지 않아요. (모두 1마리씩이면 ${n}마리, 모두 2마리씩이면 ${n*2}마리) <button class="btn small" data-act="resetSettings">기본값으로</button></p>
      </details>
      <p class="muted" style="margin-top:10px">지금 설정: 1~${st.maxNum}번${String(st.skip).trim()?` (결번 ${esc(st.skip)})`:''} · <b>${n}명</b> · ${st.rounds}라운드 · 물고기 ${st.start}/${st.cap}마리 · 번식률 ${st.growth}% · 1인당 최대 ${st.maxCatch}마리</p>
    </div>
  </div>
  <div class="card" style="margin-top:16px" id="rosterCard">${rosterHTML(st)}</div>
  <div class="startrow"><button class="btn big primary" data-act="create">🎣 방 만들기</button></div>
  <p class="credit">배지·아이콘·썸네일: Google Gemini로 생성한 이미지</p>`;
}

function renderTVCode(notice){V=null;lastKey='';
  app.innerHTML=topHTML()+`${notice?`<div class="rulebar" style="background:var(--coral2);border-color:var(--coral)">⚠️ ${esc(notice)}</div>`:''}
  <div class="card" style="max-width:560px;margin:40px auto;text-align:center">
    <div style="font-size:54px">📺</div><h2 style="font-size:30px;margin:8px 0">TV 화면</h2>
    <p style="font-size:17px;line-height:1.7">TV 화면은 <b>선생님 조작 화면</b> 위쪽의<br><b>📺 TV 화면 열기</b> 버튼으로 열어 주세요.</p>
    <p class="muted">보안을 위해 참여 코드만으로는 TV 화면을 열 수 없어요.</p></div>`}

/* ---------- 대기실 ---------- */
function renderLobby(){const st=V.settings,g=V.game;
  app.innerHTML=topHTML()+ruleBar()+`
  <div class="card">
    <div class="joinpanel">
      <div class="qr" id="qrBox"></div>
      <div>
        <div class="muted" style="font-size:16px">크롬북·휴대폰으로 들어오세요</div>
        <div class="joinurl">${esc(joinURL())}</div>
        <div class="muted" style="font-size:16px;margin-top:10px">참여 코드</div>
        <div class="bigcode">${V.code}</div>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="rhead"><h2>${g.no>1?`${g.no}판째 · `:''}들어온 친구들</h2><span class="pill">들어옴 <b id="joinedCnt">0</b> / ${st.n}명</span>
      <span class="muted">기기가 없는 친구는 게임 중에 선생님이 대신 입력할 수 있어요.</span>
      ${!TV&&g.no===1?`<button class="btn small" data-act="rosterOpen" style="margin-left:auto">👩‍🏫 학생 수 바꾸기</button>`:''}</div>
    <div class="seatgrid" id="seats"></div>
    ${TV?`<p class="muted" style="text-align:center;margin-top:18px;font-size:17px">모두 들어오면 선생님이 1라운드를 시작해요 🐟</p>`:`<div class="startrow">${lockBtn()}<button class="btn big primary" data-act="open">🎣 ${g.no>1?'다시 ':''}1라운드 시작!</button></div>`}
  </div>`;
  drawQR(document.getElementById('qrBox'),220);
  renderSeats();
}
function lockBtn(small){return TV?'':`<button class="btn ${small?'small':'big'} ${V.locked?'on':''}" data-act="lock" title="잠그면 새 기기는 들어올 수 없어요. 이미 들어온 친구는 다시 연결할 수 있어요.">${V.locked?'🔒 입장 잠김 (풀기)':'🔓 입장 잠그기'}</button>`}
function renderSeats(){const box=document.getElementById('seats');if(!box)return;const st=V.settings;let h='',cnt=0;
  st.nums.forEach(num=>{const s=V.seats[num];if(s)cnt++;
    h+=s?`<div class="seat in ${s.online?'':'away'}"><b>${num}번</b><span class="dot ${s.online?'':'away'}"></span>${esc(s.nick||'')}${s.online?'':' (나감)'}${TV?'':`<button class="x" data-act="kick" data-num="${num}" title="자리 비우기">✕</button>`}</div>`
             :`<div class="seat"><b>${num}번</b>기다리는 중</div>`});
  box.innerHTML=h;document.getElementById('joinedCnt').textContent=cnt}
function drawQR(el,size){if(!el)return;el.innerHTML='';const url=joinURL()+'?c='+V.code;
  el.innerHTML=`<img src="/api/qr?t=${encodeURIComponent(url)}" width="${size}" height="${size}" alt="참여 QR 코드">`}

/* ---------- 게임 ---------- */
function renderPlay(){const g=V.game,st=V.settings,pct=g.fish/st.cap,safe=safeCatch(st,g.fish),picking=V.phase==='pick';
  app.innerHTML=topHTML()+ruleBar()+`
  <div class="play">
    <section class="card">
      ${lakeHTML(g.fish,st.cap)}
      <div class="fishcount"><div><div class="lbl">지금 호수의 물고기</div><div class="n">${g.fish}<small> / ${st.cap}마리</small></div></div>
        <div style="text-align:right"><div class="lbl">라운드</div><div class="jua" style="font-size:34px">${g.round} <small style="font-size:18px;color:var(--sub)">/ ${st.rounds}</small></div></div></div>
      <div class="health"><i style="width:${pct*100}%;background:${healthColor(pct)}"></i></div>
      ${TV?'':`<div style="margin-top:12px"><button class="btn small ${V.hint?'on':''}" data-act="hint">💡 호수 지킴 힌트 ${V.hint?'숨기기 (TV에서도 사라져요)':'TV에 보여 주기'}</button></div>`}
      ${V.hint?`<div class="hintbox">호수를 지금처럼 <b>${g.fish}마리</b>로 지키려면, 이번 라운드에 반 전체가 <b>${safe}마리</b>까지만 잡아야 해요.<br>${aliveCount()}명이 나누면 1인당 약 <b>${(safe/aliveCount()).toFixed(1)}마리</b>예요.${st.eat>0?`<br>그런데 한 사람이 라운드마다 <b>${st.eat}마리</b>를 먹고도 <b>1마리 이상</b> 남아 있어야 탈락하지 않아요.`:''}</div>`:''}
      <div class="chartwrap"><h3>📈 호수 기록</h3>${chartHTML(g.history,g.fish,st)}</div>
    </section>
    <section class="card ${TV||L.hide?'hidemode':''}">
      <div class="rhead"><h2>🎣 ${g.round}라운드: ${picking?'몰래 고르는 중…':'결과 발표'}</h2>
        <span class="pill">제출 <b id="cntDone">0</b> / <span id="cntAlive">${aliveCount()}</span>명</span>
        <span class="pill">잡으려는 물고기 합계 <b id="cntSum">0</b></span></div>
      ${TV?'':`<div class="tools">
        <button class="btn small ${L.hide?'on':''}" data-act="hide">👀 ${L.hide?'선택 가리는 중':'선택 보이는 중'}</button>
        <button class="btn small" data-act="fillEmpty" data-v="0">안 낸 친구 0마리로</button>
        <button class="btn small" data-act="clear">🧹 모두 지우기</button>
        ${lockBtn(true)}
      </div>`}
      <div class="grid" id="grid"></div>
      ${TV?`<p class="muted" style="margin-top:14px;font-size:16px">자기 기기에서 몰래 골라요. 모두 내면 선생님이 결과를 보여 줘요.</p>`:`<div class="actbar"><button class="btn big primary" data-act="resolve" ${picking?'':'disabled'}>🎣 결과 보기</button><div id="warnBox"></div></div>`}
    </section>
  </div>`;
  renderGrid();
}
function renderGrid(){const box=document.getElementById('grid');if(!box)return;const g=V.game,st=V.settings;let h='';
  st.nums.forEach((num,i)=>{const p=g.picks[i],s=V.seats[num];let b='';
    if(!isAlive(i)){h+=`<div class="st dead"><div class="nm"><b title="${esc(label(i))}">${esc(label(i))}</b><span>😵</span></div><div class="dev">${g.deadRound[i]}라운드에 탈락</div><div class="deadmsg">물고기 0마리 😵</div></div>`;return}
    if(!TV&&isBanned(i)){h+=`<div class="st banned"><div class="nm"><b title="${esc(label(i))}">${esc(label(i))}</b><span>모은 🐟 ${g.totals[i]}</span></div><div class="dev">약속 ${g.strikes[i]}번 어김</div><div class="deadmsg" style="color:#c5503f">⛔ 이번 라운드 출어 금지</div></div>`;return}
    if(TV)b=`<div class="muted" style="text-align:center;padding:6px 0;font-size:15px">${p!=null?'<b style="color:#2a86c4">제출했어요 ✓</b>':'고르는 중…'}</div>`;
    else for(let v=0;v<=st.maxCatch;v++)b+=`<button class="${p===v?'sel c'+v:''}" data-act="set" data-i="${i}" data-v="${v}" ${g.pact&&g.pact.cap&&v>g.pact.limit?'disabled style="opacity:.3"':''}>${v}</button>`;
    const dev=s?`<span class="dot ${s.online?'':'away'}"></span>${s.online?'기기로 참여':'기기 연결 끊김'}`:(TV?'아직 안 들어옴':'선생님이 입력');
    h+=`<div class="st ${p!=null?'done':''} ${s?'byDevice':''}"><div class="chk">✓</div><div class="nm"><b title="${esc(label(i))}">${esc(label(i))}</b><span>${TV?'':`모은 🐟 ${g.totals[i]}`}</span></div><div class="dev">${dev}${!TV&&g.strikes&&g.strikes[i]?`<span class="strike">⚠️ 약속 ${g.strikes[i]}번 어김</span>`:''}</div>${TV?b:`<div class="opts">${b}</div>`}</div>`});
  box.innerHTML=h;
  document.getElementById('cntDone').textContent=g.picks.filter((p,i)=>(p!=null||isBanned(i))&&isAlive(i)).length;
  const ca=document.getElementById('cntAlive');if(ca)ca.textContent=aliveCount();
  document.getElementById('cntSum').textContent=TV||L.hide?'?':sum(g.picks);
  const w=document.getElementById('warnBox');if(w)w.innerHTML='';
}
function tryResolve(force){const g=V.game,need=i=>g.picks[i]==null&&isAlive(i)&&!isBanned(i),missing=g.picks.filter((p,i)=>need(i)).length;
  if(missing&&!force){const who=V.settings.nums.filter((n,i)=>need(i)).map(n=>n+'번').join(', ');
    document.getElementById('warnBox').innerHTML=`<div class="warn">아직 안 낸 친구 <b>${missing}명</b>: ${esc(who)} <button class="btn small" data-act="resolveForce">0마리로 하고 진행</button></div>`;return}
  if(missing)act('fillEmpty',{v:0}).then(()=>act('resolve'));else act('resolve')}

function showRoundModal(){const g=V.game,st=V.settings,e=g.history[g.history.length-1];if(!e)return;const m=roundMsg(e,g.status,st);
  const nextLabel=g.status==='collapsed'?'결과 보러 가기':g.status==='success'?'🎉 최종 결과 보기':`${g.round+1}라운드 시작 ▶`;
  modal.innerHTML=`<div class="back"><div class="box">
    <h2 style="font-size:30px">${e.round}라운드 결과</h2>
    <div class="steps">
      <div class="step" style="background:#e6f4ff;animation-delay:.05s"><div class="e">🐟</div><div class="v">${e.before}</div><div class="l">처음 호수 물고기</div></div>
      <div class="step" style="background:var(--coral2);animation-delay:.45s"><div class="e">🎣</div><div class="v">−${e.caught}</div><div class="l">우리 반이 잡은 물고기${e.demand>e.before?`<br>(잡으려던 수 ${e.demand})`:''}</div></div>
      <div class="step" style="background:var(--mint2);animation-delay:.85s"><div class="e">🥚</div><div class="v">+${e.born}</div><div class="l">남은 ${e.left}마리가 낳은 새끼</div></div>
      ${st.eat>0&&e.eaten!=null&&g.status!=='collapsed'||e.starved&&e.starved.length?`<div class="step" style="background:#f1ebff;animation-delay:1.05s"><div class="e">🍚</div><div class="v">${e.eaten}</div><div class="l">살기 위해 먹은 물고기<br>(각자 모은 물고기에서)</div></div>`:''}
      <div class="step" style="background:var(--yellow2);animation-delay:1.25s"><div class="e">${e.after>0?'🏞️':'🏜️'}</div><div class="v">${e.after}</div><div class="l">${g.status==='play'?'다음 라운드 물고기':'라운드 후 호수'}${e.left+e.born>st.cap?`<br>(최대 ${st.cap}마리)`:''}</div></div>
    </div>
    <div class="msg ${m.cls}">${m.msg}</div>
    ${penaltyHTML(e,g)}
    ${e.starved&&e.starved.length?`<div class="msg bad" style="margin-top:10px">😵 ${st.out==='zero'?'먹고 나니 물고기가 0마리!':'먹을 물고기가 모자랐어요!'} <b>${e.starved.length}명</b>이 탈락해서 다음 라운드에 나갈 수 없어요: ${e.starved.map(i=>esc(label(i))).join(', ')}</div>`:''}
    <div style="text-align:center;margin-top:20px">${TV?`<p class="muted" style="font-size:16px">선생님이 다음으로 넘길 때까지 잠깐 이야기해 봐요.</p>`:`<button class="btn big ${g.status==='collapsed'?'primary':'blue'}" data-act="next">${nextLabel}</button>`}</div>
  </div></div>`}

function penaltyHTML(e,g){const P=g.pact;if(!pactOn(P)||P.cap)return '';
  const names=arr=>arr.map(i=>esc(label(i))).join(', ');
  const vc=e.violators?e.violators.length:e.violatorsCount,bc=e.banNext?e.banNext.length:e.banNextCount,lines=[];
  if(vc!=null)lines.push(vc?`🚨 약속(1인당 ${P.limit}마리)을 어긴 친구 <b>${vc}명</b>${!TV&&e.violators?` <span class="muted">(${names(e.violators)})</span>`:''}`:`🌟 이번 라운드는 <b>모두 약속을 지켰어요!</b>`);
  if(e.returned)lines.push(`↩️ 약속보다 더 잡아서 호수로 돌려놓은 물고기 <b>${e.returned}마리</b>`);
  if(bc)lines.push(`⛔ 다음 라운드 출어 금지 <b>${bc}명</b>${!TV&&e.banNext?` <span class="muted">(${names(e.banNext)})</span>`:''}`);
  if(!lines.length&&!TV&&e.violators&&!e.violators.length)lines.push('🌟 이번 라운드는 모두 약속을 지켰어요!');
  return lines.length?`<div class="penal">${lines.join('<br>')}</div>`:''}

/* ---------- 끝 ---------- */
function simEqual(st,k){const e=st.eat||0;let N=st.start;for(let r=1;r<=st.rounds;r++){const d=st.n*k;if(d>=N)return{ok:false,round:r,why:'lake'};if(e>0&&(st.out==='zero'?k<=e:k<e))return{ok:false,round:r,why:'starve'};N=growWith(st,N-d).after}return{ok:true,per:(k-e)*st.rounds}}
function simBest(st){let N=st.start,tot=0,first=null;const lim=st.n*st.maxCatch;for(let r=1;r<=st.rounds;r++){const c=Math.min(safeCatch(st,N),lim);if(first==null)first=c;tot+=c;N=growWith(st,N-c).after}return{tot,first,per:(tot-st.n*(st.eat||0)*st.rounds)/st.n,okEat:first>=st.n*(st.eat||0)}}
function pastHTML(){return `<ul class="past" style="padding:0;margin:6px 0 0">${V.past.map(p=>`<li>${p.no}판 · ${p.ok?`<span class="tag ok">성공</span> ${p.rounds}라운드 완주 · 반 전체 ${p.total}마리`:`<span class="tag no">호수 붕괴</span> ${p.round}라운드에서 텅 빔`}${p.pact&&pactOn(p.pact)?` · 약속 ${p.pact.limit}마리 (${PACT_INFO.filter(x=>p.pact[x.k]).map(x=>x.t).join(', ')})`:''}${p.alive!=null&&p.ok?` · 생존 ${p.alive}명`:''}${p.rule?` · “${esc(p.rule.length>24?p.rule.slice(0,24)+'…':p.rule)}”`:''}</li>`).join('')}</ul>`}
function renderEnd(){const g=V.game,st=V.settings,ok=g.status==='success',tot=sum(g.totals),best=simBest(st);
  const rows=[];for(let k=1;k<=st.maxCatch;k++){const r=simEqual(st,k);rows.push(`<tr><td>모두 ${k}마리씩</td><td>${r.ok?`<span class="tag ok">${st.rounds}라운드 완주</span>`:r.why==='starve'?`<span class="tag no">${r.round}라운드에 모두 탈락</span>`:`<span class="tag no">${r.round}라운드에 붕괴</span>`}</td><td>${r.ok?r.per+'마리':'0마리'}</td></tr>`)}
  rows.push(`<tr><td>호수를 지키며 최대로<br><span class="muted">(매 라운드 반 전체 ${best.first}마리 정도)</span></td><td><span class="tag ok">${st.rounds}라운드 완주</span></td><td>약 ${Math.max(0,best.per).toFixed(1)}마리</td></tr>`);
  rows.push(`<tr class="us"><td>우리 반 실제 결과</td><td>${ok?`<span class="tag ok">${st.rounds}라운드 완주</span>`:`<span class="tag no">${g.collapseRound}라운드에 붕괴</span>`}</td><td>${ok?(aliveCount()<st.n?`살아남은 ${aliveCount()}명 평균 ${(tot/Math.max(1,aliveCount())).toFixed(1)}마리`:(tot/st.n).toFixed(1)+'마리 (평균)'):'0마리'}</td></tr>`);
  const order=g.totals.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),mx=Math.max(1,...g.totals),anon=!!g.totalsSorted;
  const rank=order.map((o,j)=>`<div class="rk ${ok&&(anon||isAlive(o.i))?'':'lost'}"><span class="muted">${j+1}</span><span class="nm">${anon?'':(isAlive(o.i)?'':'😵 ')+esc(label(o.i))}</span><span class="bar"><i style="width:${o.v/mx*100}%"></i></span><span class="v">${o.v}</span></div>`).join('');
  app.innerHTML=topHTML()+ruleBar()+`
  <div class="card">
    <div class="endhead"><div class="emo">${ok?'🎉':'😵'}</div>
      <h2>${ok?`${st.rounds}라운드까지 호수를 지켜냈어요!`:g.reason==='starved'?`${g.collapseRound}라운드에서 모두 탈락했어요…`:`${g.collapseRound}라운드에서 호수가 텅 비었어요…`}</h2>
      <p>${ok?(aliveCount()<st.n?`호수는 지켰지만 <b>${st.n-aliveCount()}명</b>은 물고기가 0마리가 되어 탈락했어요. 살아남은 친구는 먹고 남은 물고기가 점수예요.`:'마을 사람 모두가 끝까지 물고기를 먹으며 살아남았어요. 먹고 남은 물고기가 점수예요.'):g.reason==='starved'?'호수에 물고기는 남았지만, 모두 물고기가 0마리가 되어 탈락했어요.':'물고기가 더 이상 태어날 수 없어 마을 사람 <b>모두의 수명이 아웃</b>! 그동안 잡아 둔 물고기도 모두 사라졌어요.'}</p></div>
    <div class="endstats">
      <div class="es"><div class="v">${ok?tot:`<s style="color:#b3bccb">${tot}</s>`}</div><div class="l">${ok?'먹고 남은 물고기 (반 전체)':'잡았지만 사라진 물고기'}</div></div>
      ${st.eat>0&&ok?`<div class="es"><div class="v">${aliveCount()} / ${st.n}</div><div class="l">살아남은 사람</div></div>`:''}
      <div class="es"><div class="v">${ok?st.rounds:g.collapseRound-1} / ${st.rounds}</div><div class="l">무사히 끝낸 라운드</div></div>
      <div class="es"><div class="v">${g.fish}</div><div class="l">호수에 남은 물고기</div></div>
      <div class="es"><div class="v">${best.tot}</div><div class="l">호수를 지키며 잡을 수 있었던 최대</div></div>
    </div>
    <div style="max-width:520px;margin:0 auto">${chartHTML(g.history,g.fish,st)}</div>
  </div>
  <div class="endgrid">
    <div class="card cmp"><h3>🤔 이렇게 했다면?</h3><p class="muted">1인당 마지막에 가질 수 있는 물고기</p>
      <table><tr><th>방법</th><th>호수는?</th><th>1인당</th></tr>${rows.join('')}</table>
      <p class="muted" style="margin-top:10px">욕심내서 많이 잡으면 그 순간엔 내가 더 많이 갖지만, 호수가 무너지면 모두 0마리가 돼요.${st.eat>0?' 그렇다고 너무 적게 잡으면 먹을 물고기가 없어 내가 탈락해요. 살아남을 만큼만 잡는 게 핵심이에요.':''}</p></div>
    <div class="card"><h3>${ok?'🏅 잡은 물고기':'🫥 잡았지만 사라진 물고기'}</h3><p class="muted">${ok?'많이 잡은 친구와 적게 잡은 친구가 있다면, 그건 공평했을까요?':'가장 많이 잡은 친구도 결국 0마리가 되었어요.'}${TV?' (TV에는 이름 없이 보여요)':''}</p><div class="rank">${rank}</div></div>
  </div>
  <div class="concept"><h3>💡 공유지의 비극</h3>
    <p>여러 사람이 <b>함께 쓰는 자원</b>(호수, 바다, 숲, 공기…)을 저마다 “나 하나쯤이야” 하며 자기 이익만 생각해 쓰면, 결국 자원이 망가져 <b>모두가 손해</b>를 보게 되는 일을 말해요.</p>
    <p>막으려면 ① 자원이 얼마나 다시 회복되는지 알고 ② 다 함께 쓸 만큼을 <b>약속</b>으로 정하고 ③ 그 약속을 서로 지키는 것이 필요해요.</p></div>
  <div class="endgrid">
    <div class="card qs"><h3>🗣️ 함께 이야기해 봐요</h3><ol>
      <li>호수의 물고기는 왜 줄어들었을까요? “나 하나쯤 더 잡아도 괜찮겠지”라고 생각한 적이 있나요?</li>
      <li>나만 적게 잡으면 손해라고 느꼈나요? 그때 어떤 마음이 들었나요?</li>
      <li>모두가 ${st.rounds}라운드까지 물고기를 잡으려면 한 라운드에 반 전체가 몇 마리까지 잡아야 할까요?</li>
      <li>약속을 어기고 더 많이 잡는 친구가 있다면 어떻게 하면 좋을까요?</li>
      <li>실제 세상에도 이런 일이 있을까요? (바다의 물고기, 숲, 깨끗한 공기, 학교의 공용 물건…)</li>
    </ol></div>
    ${TV?`<div class="card promise"><h3>📜 우리 반 약속 정하기</h3><p style="font-size:18px;line-height:1.7">모두가 끝까지 물고기를 잡으려면 <b>한 사람당 몇 마리까지</b> 잡기로 약속할까요? 약속을 어기면 어떤 벌칙이 좋을까요?</p>
      <div class="pactgrid">${PACT_INFO.map((x,n)=>`<div class="pact"><span class="pe">${x.e}</span><span><span class="pt">${n+1}. ${x.t}</span>${x.d}</span><span></span></div>`).join('')}</div>
      ${V.past.length?`<h3 style="margin-top:16px;font-size:18px">📚 지금까지의 게임</h3>${pastHTML()}`:''}</div>`:`<div class="card promise" id="promiseCard">${promiseHTML()}</div>`}
  </div>`;
}
function promiseHTML(){const st=V.settings,d=pactDraft();
  const cards=PACT_INFO.map((x,n)=>`<button class="pact ${d[x.k]?'on':''}" data-act="pact" data-k="${x.k}"><span class="pe">${x.e}</span><span><span class="pt">${n+1}. ${x.t}${x.rec?'<span class="rec">추천</span>':''}</span>${x.d}</span><span class="pbox">${d[x.k]?'✓':''}</span></button>`).join('');
  return `<h3>📜 우리 반 약속 정하기</h3><p class="muted">회의로 약속을 정하고, 어겼을 때의 벌칙을 골라요. 여러 개를 함께 고를 수 있어요. (단계적 벌칙과 어획 한도는 따로 써요)</p>
      <div class="limitrow">한 라운드에 1인당 <button data-act="limit" data-d="-1">−</button><b>${d.limit}</b><button data-act="limit" data-d="1">+</button> 마리까지만 잡기</div>
      ${st.eat>0&&(st.out==='zero'?d.limit<=st.eat:d.limit<st.eat)?`<div class="err">이 약속을 지키면 먹을 물고기가 모자라 모두 탈락할 수 있어요. 약속 마리 수를 다시 생각해 봐요.</div>`:''}
      <div class="pactgrid">${cards}</div>
      <textarea id="ruleTxt" placeholder="그 밖의 약속을 적어요. 예) 호수가 50마리보다 적으면 모두 1마리만 잡기">${esc(L.ruleDraft!=null?L.ruleDraft:V.rule)}</textarea>
      <div class="startrow" style="justify-content:flex-start;margin-top:12px">
        <button class="btn mint" data-act="restartRule">📜 약속 지키며 다시 하기</button>
        <button class="btn" data-act="restart">🔁 약속 없이 다시 하기</button></div>
      ${V.past.length?`<h3 style="margin-top:16px;font-size:18px">📚 지금까지의 게임</h3>${pastHTML()}`:''}`}

/* ---------- 작은 창 ---------- */
function confirmBox(html,onYes){modal.innerHTML=`<div class="back"><div class="box" style="max-width:440px;text-align:center"><p style="font-size:18px;line-height:1.6">${html}</p>
  <div class="startrow"><button class="btn" data-act="cancel">취소</button><button class="btn primary" data-act="yes">확인</button></div></div></div>`;confirmBox.cb=onYes}
function qrModal(){modal.innerHTML=`<div class="back" data-act="cancel"><div class="box" style="max-width:520px;text-align:center">
  <div class="qr" id="qrBig" style="margin:0 auto"></div><div class="joinurl" style="margin-top:14px">${esc(joinURL())}</div>
  <div class="bigcode" style="margin-top:6px">${V.code}</div><div class="startrow"><button class="btn" data-act="cancel">닫기</button></div></div></div>`;
  drawQR(document.getElementById('qrBig'),300)}

/* ---------- 이벤트 ---------- */
document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='cancel'&&ev.target!==b&&b.classList.contains('back'))return; // 바깥 클릭만 닫기
  switch(a){
    case 'create':{b.disabled=true;const r=await post('/api/room',{settings:L.settings});
      if(r.ok){L.auth={code:r.data.code,key:r.data.key};L.ruleDraft=null;saveLocal();connect()}else{b.disabled=false;renderIntro('방을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.')}break}
    case 'resetSettings':L.settings={...DEF};saveLocal();renderIntro();break;
    case 'leave':confirmBox('이 방에서 나갈까요?<br><span class="muted">학생들의 연결도 더 이상 쓰지 않게 돼요.</span>',()=>{if(es)es.close();L.auth=null;saveLocal();renderIntro()});break;
    case 'qr':qrModal();break;
    case 'open':act('open');break;
    case 'kick':act('kick',{num:+b.dataset.num});break;
    case 'set':{const i=+b.dataset.i,v=+b.dataset.v;V.game.picks[i]=V.game.picks[i]===v?null:v;renderGrid();act('set',{i,v:V.game.picks[i]});break}
    case 'fillEmpty':act('fillEmpty',{v:+b.dataset.v});break;
    case 'clear':confirmBox('모든 친구의 선택을 지울까요?',()=>act('clear'));break;
    case 'hide':L.hide=!L.hide;saveLocal();renderPlay();break;
    case 'hint':act('hint');break;
    case 'lock':act('lock');break;
    case 'rosterToggle':case 'rosterMax':{const st=rosterTarget();
      if(a==='rosterMax')st.maxNum=Math.max(2,Math.min(40,st.maxNum+ +b.dataset.d));
      else{const sk=skipSet(st),k=+b.dataset.n;if(sk.has(k))sk.delete(k);else if(st.maxNum-sk.size>2)sk.add(k);st.skip=[...sk].sort((x,y)=>x-y).join(', ')}
      const sk=skipSet(st);st.skip=[...sk].sort((x,y)=>x-y).join(', ');
      if(rosterDraft){document.getElementById('rosterBox').innerHTML=rosterHTML(st,true)}else{saveLocal();renderIntro()}break}
    case 'rosterOpen':rosterDraft={maxNum:V.settings.maxNum,skip:V.settings.skip};
      modal.innerHTML=`<div class="back"><div class="box" id="rosterBox" style="max-width:640px">${rosterHTML(rosterDraft,true)}</div></div>`;break;
    case 'rosterSave':{const d=rosterDraft;rosterDraft=null;modal.innerHTML='';L.settings.maxNum=d.maxNum;L.settings.skip=d.skip;saveLocal();
      act('roster',{maxNum:d.maxNum,skip:d.skip});break}
    case 'resolve':tryResolve(false);break;
    case 'resolveForce':tryResolve(true);break;
    case 'next':modal.innerHTML='';act('next');window.scrollTo({top:0,behavior:'smooth'});break;
    case 'restartRule':{const rule=document.getElementById('ruleTxt').value,pact={...pactDraft()};L.ruleDraft=null;L.pactDraft=null;saveLocal();act('newgame',{rule,pact});break}
    case 'restart':L.ruleDraft=null;L.pactDraft=null;saveLocal();act('newgame',{rule:'',pact:{limit:1}});break;
    case 'pact':{const d=pactDraft(),k=b.dataset.k;d[k]=!d[k];
      if(d[k]&&k==='cap'){d.reveal=d.ret=d.ban=d.grad=false}
      if(d[k]&&k==='grad'){d.reveal=d.ret=d.ban=d.cap=false}
      if(d[k]&&['reveal','ret','ban'].includes(k)){d.grad=d.cap=false}
      saveLocal();document.getElementById('promiseCard').innerHTML=promiseHTML();break}
    case 'limit':{const d=pactDraft();d.limit=Math.max(0,Math.min(V.settings.maxCatch,d.limit+ +b.dataset.d));saveLocal();document.getElementById('promiseCard').innerHTML=promiseHTML();break}
    case 'cancel':modal.innerHTML='';rosterDraft=null;break;
    case 'yes':modal.innerHTML='';confirmBox.cb&&confirmBox.cb();break;
  }});
document.addEventListener('input',ev=>{if(ev.target.id==='ruleTxt'){L.ruleDraft=ev.target.value;saveLocal()}});
document.addEventListener('change',ev=>{const t=ev.target;if(!t.dataset.set)return;const k=t.dataset.set,st=L.settings;
  if(k==='skip')st.skip=t.value;
  else if(k==='out')st.out=t.value==='zero'?'zero':'empty';
  else{const lim={maxNum:[2,40],rounds:[3,20],start:[5,300],cap:[10,300],growth:[0,100],maxCatch:[1,5],eat:[0,3]}[k];let v=parseInt(t.value,10);if(isNaN(v))v=DEF[k];st[k]=Math.max(lim[0],Math.min(lim[1],v))}
  if(st.start>st.cap)st.start=st.cap;
  saveLocal();renderIntro();document.querySelector('details.settings').open=true});
boot();
