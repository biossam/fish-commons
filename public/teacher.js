/* 선생님 조작 화면(/)과 TV 화면(/tv)이 함께 쓰는 코드. TV 화면은 window.TV_MODE = true */
const TV=!!window.TV_MODE;
const DEF={maxNum:24,skip:'16',start:100,cap:100,growth:50,maxCatch:3,rounds:10};
const app=document.getElementById('app'),modal=document.getElementById('modal');
let L=TV?{}:loadLocal();
L.settings={...DEF,...(L.settings||{})};
if(L.hide==null)L.hide=false;
let V=null,es=null,lastKey='',connected=false,gone=false;

function loadLocal(){try{return JSON.parse(localStorage.getItem('fish-teacher'))||{}}catch(e){return{}}}
function saveLocal(){if(TV)return;try{localStorage.setItem('fish-teacher',JSON.stringify(L))}catch(e){}}
function tvURL(){return location.origin+'/tv?c='+V.code}
function joinURL(){return location.origin+'/s'}
function numsOf(st){const skip=new Set((String(st.skip).match(/\d+/g)||[]).map(Number));const a=[];for(let i=1;i<=st.maxNum;i++)if(!skip.has(i))a.push(i);return a}
function label(i){const num=V.settings.nums[i],s=V.seats[num];return s&&s.nick?`${num}번 ${s.nick}`:`${num}번`}

/* ---------- 연결 ---------- */
async function boot(){
  if(TV){const c=new URLSearchParams(location.search).get('c');if(c&&/^\d{4}$/.test(c)){L.auth={code:c};connect()}else renderTVCode();return}
  if(L.auth){
    try{const r=await fetch(`/api/check?c=${L.auth.code}&key=${L.auth.key}`);if(r.ok){connect();return}}catch(e){}
    L.auth=null;saveLocal();
  }
  renderIntro();
}
function connect(){
  if(es)es.close();
  gone=false;
  es=new EventSource(TV?`/api/events?c=${L.auth.code}&role=d`:`/api/events?c=${L.auth.code}&role=t&key=${L.auth.key}`);
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
  const g=V.game,key=[V.phase,g.no,g.round,g.status,V.hint].join('|');
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
  return `<div class="top"><div class="logo"><div class="badge"><svg viewBox="0 0 42 26"><use href="#fishSym"/></svg></div>
    <div><h1>물고기 마을의 호수</h1><small>공유지의 비극 체험 게임</small></div></div>
    <div class="rounds">${dots}</div>
    ${V?`<button class="codechip" data-act="qr">참여 코드 <b>${V.code}</b></button>
      <span class="conn" id="conn"><i></i> 연결됨</span>
      ${TV?'':`<a class="btn small" href="${tvURL()}" target="_blank" rel="noopener" style="text-decoration:none">📺 TV 화면 열기</a>
      <button class="btn small" data-act="leave">🚪 방 나가기</button>`}`:''}</div>`}
function tvTip(){return TV?'':`<div class="rulebar" style="background:#e6f4ff;border-color:var(--blue)"><b>🧑‍🏫 선생님 조작 화면</b><span>학생들이 고른 숫자가 보이는 화면이에요. 반 전체에는 <a href="${tvURL()}" target="_blank" rel="noopener"><b>📺 TV 화면</b></a>(${esc(tvURL())})을 띄워 주세요.</span></div>`}
function ruleBar(){return tvTip()+(V&&V.rule.trim()?`<div class="rulebar"><b>📜 우리 반 약속</b><span>${esc(V.rule).replace(/\n/g,'<br>')}</span></div>`:'')}

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
    <div class="rule r4"><span class="num">규칙 4</span><h3>끝까지 살아남기</h3><b>${st.rounds}라운드</b>까지 호수를 지키면, 그동안 잡은 물고기가 내 점수가 돼요.</div>
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
        <label>마지막 번호<input type="number" min="2" max="40" data-set="maxNum" value="${st.maxNum}"></label>
        <label>결번 (쉼표로 구분)<input type="text" data-set="skip" value="${esc(st.skip)}" placeholder="예) 16"></label>
        <label>라운드 수<input type="number" min="3" max="20" data-set="rounds" value="${st.rounds}"></label>
        <label>1인당 최대 잡기<input type="number" min="1" max="5" data-set="maxCatch" value="${st.maxCatch}"></label>
        <label>처음 물고기 수<input type="number" min="5" max="300" data-set="start" value="${st.start}"></label>
        <label>호수 최대 물고기 수<input type="number" min="10" max="300" data-set="cap" value="${st.cap}"></label>
        <label>번식률 (남은 물고기의 %)<input type="number" min="0" max="100" data-set="growth" value="${st.growth}"></label>
      </div>
      <p class="muted">호수가 가득 찼을 때 반 전체가 한 라운드에 <b>${safeCatch(sim,st.cap)}마리</b>까지 잡아야 호수가 줄지 않아요. (모두 1마리씩이면 ${n}마리, 모두 2마리씩이면 ${n*2}마리) <button class="btn small" data-act="resetSettings">기본값으로</button></p>
      </details>
      <p class="muted" style="margin-top:10px">지금 설정: 1~${st.maxNum}번${String(st.skip).trim()?` (결번 ${esc(st.skip)})`:''} · <b>${n}명</b> · ${st.rounds}라운드 · 물고기 ${st.start}/${st.cap}마리 · 번식률 ${st.growth}% · 1인당 최대 ${st.maxCatch}마리</p>
    </div>
  </div>
  <div class="startrow"><button class="btn big primary" data-act="create">🎣 방 만들기</button></div>`;
}

function renderTVCode(notice){V=null;lastKey='';
  app.innerHTML=topHTML()+`${notice?`<div class="rulebar" style="background:var(--coral2);border-color:var(--coral)">⚠️ ${esc(notice)}</div>`:''}
  <div class="card" style="max-width:560px;margin:40px auto;text-align:center">
    <div style="font-size:54px">📺</div><h2 style="font-size:30px;margin:8px 0">TV 화면</h2>
    <p class="muted" style="font-size:16px">선생님 화면에 나온 참여 코드 4자리를 넣어 주세요.</p>
    <input class="field codefield" id="tvCode" inputmode="numeric" maxlength="4" placeholder="0000">
    <div class="startrow"><button class="btn big primary" data-act="tvGo">보여 주기</button></div></div>`}

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
      <span class="muted">기기가 없는 친구는 게임 중에 선생님이 대신 입력할 수 있어요.</span></div>
    <div class="seatgrid" id="seats"></div>
    ${TV?`<p class="muted" style="text-align:center;margin-top:18px;font-size:17px">모두 들어오면 선생님이 1라운드를 시작해요 🐟</p>`:`<div class="startrow"><button class="btn big primary" data-act="open">🎣 ${g.no>1?'다시 ':''}1라운드 시작!</button></div>`}
  </div>`;
  drawQR(document.getElementById('qrBox'),220);
  renderSeats();
}
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
      ${V.hint?`<div class="hintbox">호수를 지금처럼 <b>${g.fish}마리</b>로 지키려면, 이번 라운드에 반 전체가 <b>${safe}마리</b>까지만 잡아야 해요.<br>${st.n}명이 나누면 1인당 약 <b>${(safe/st.n).toFixed(1)}마리</b>예요.</div>`:''}
      <div class="chartwrap"><h3>📈 호수 기록</h3>${chartHTML(g.history,g.fish,st)}</div>
    </section>
    <section class="card ${TV||L.hide?'hidemode':''}">
      <div class="rhead"><h2>🎣 ${g.round}라운드: ${picking?'몰래 고르는 중…':'결과 발표'}</h2>
        <span class="pill">제출 <b id="cntDone">0</b> / ${st.n}명</span>
        <span class="pill">잡으려는 물고기 합계 <b id="cntSum">0</b></span></div>
      ${TV?'':`<div class="tools">
        <button class="btn small ${L.hide?'on':''}" data-act="hide">👀 ${L.hide?'선택 가리는 중':'선택 보이는 중'}</button>
        <button class="btn small" data-act="fillEmpty" data-v="0">안 낸 친구 0마리로</button>
        <button class="btn small" data-act="clear">🧹 모두 지우기</button>
      </div>`}
      <div class="grid" id="grid"></div>
      ${TV?`<p class="muted" style="margin-top:14px;font-size:16px">자기 기기에서 몰래 골라요. 모두 내면 선생님이 결과를 보여 줘요.</p>`:`<div class="actbar"><button class="btn big primary" data-act="resolve" ${picking?'':'disabled'}>🎣 결과 보기</button><div id="warnBox"></div></div>`}
    </section>
  </div>`;
  renderGrid();
}
function renderGrid(){const box=document.getElementById('grid');if(!box)return;const g=V.game,st=V.settings;let h='';
  st.nums.forEach((num,i)=>{const p=g.picks[i],s=V.seats[num];let b='';
    if(TV)b=`<div class="muted" style="text-align:center;padding:6px 0;font-size:15px">${p!=null?'<b style="color:#2a86c4">제출했어요 ✓</b>':'고르는 중…'}</div>`;
    else for(let v=0;v<=st.maxCatch;v++)b+=`<button class="${p===v?'sel c'+v:''}" data-act="set" data-i="${i}" data-v="${v}">${v}</button>`;
    const dev=s?`<span class="dot ${s.online?'':'away'}"></span>${s.online?'기기로 참여':'기기 연결 끊김'}`:(TV?'아직 안 들어옴':'선생님이 입력');
    h+=`<div class="st ${p!=null?'done':''} ${s?'byDevice':''}"><div class="chk">✓</div><div class="nm"><b title="${esc(label(i))}">${esc(label(i))}</b><span>모은 🐟 ${g.totals[i]}</span></div><div class="dev">${dev}</div>${TV?b:`<div class="opts">${b}</div>`}</div>`});
  box.innerHTML=h;
  document.getElementById('cntDone').textContent=g.picks.filter(p=>p!=null).length;
  document.getElementById('cntSum').textContent=TV||L.hide?'?':sum(g.picks);
  const w=document.getElementById('warnBox');if(w)w.innerHTML='';
}
function tryResolve(force){const g=V.game,missing=g.picks.filter(p=>p==null).length;
  if(missing&&!force){const who=V.settings.nums.filter((n,i)=>g.picks[i]==null).map(n=>n+'번').join(', ');
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
      <div class="step" style="background:var(--yellow2);animation-delay:1.25s"><div class="e">${e.after>0?'🏞️':'🏜️'}</div><div class="v">${e.after}</div><div class="l">${g.status==='play'?'다음 라운드 물고기':'라운드 후 호수'}${e.left+e.born>st.cap?`<br>(최대 ${st.cap}마리)`:''}</div></div>
    </div>
    <div class="msg ${m.cls}">${m.msg}</div>
    <div style="text-align:center;margin-top:20px">${TV?`<p class="muted" style="font-size:16px">선생님이 다음으로 넘길 때까지 잠깐 이야기해 봐요.</p>`:`<button class="btn big ${g.status==='collapsed'?'primary':'blue'}" data-act="next">${nextLabel}</button>`}</div>
  </div></div>`}

/* ---------- 끝 ---------- */
function simEqual(st,k){let N=st.start;for(let r=1;r<=st.rounds;r++){const d=st.n*k;if(d>=N)return{ok:false,round:r};N=growWith(st,N-d).after}return{ok:true,per:k*st.rounds}}
function simBest(st){let N=st.start,tot=0,first=null;const lim=st.n*st.maxCatch;for(let r=1;r<=st.rounds;r++){const c=Math.min(safeCatch(st,N),lim);if(first==null)first=c;tot+=c;N=growWith(st,N-c).after}return{tot,first}}
function pastHTML(){return `<ul class="past" style="padding:0;margin:6px 0 0">${V.past.map(p=>`<li>${p.no}판 · ${p.ok?`<span class="tag ok">성공</span> ${p.rounds}라운드 완주 · 반 전체 ${p.total}마리`:`<span class="tag no">호수 붕괴</span> ${p.round}라운드에서 텅 빔`}${p.rule?` · 약속: “${esc(p.rule.length>30?p.rule.slice(0,30)+'…':p.rule)}”`:''}</li>`).join('')}</ul>`}
function renderEnd(){const g=V.game,st=V.settings,ok=g.status==='success',tot=sum(g.totals),best=simBest(st);
  const rows=[];for(let k=1;k<=st.maxCatch;k++){const r=simEqual(st,k);rows.push(`<tr><td>모두 ${k}마리씩</td><td>${r.ok?`<span class="tag ok">${st.rounds}라운드 완주</span>`:`<span class="tag no">${r.round}라운드에 붕괴</span>`}</td><td>${r.ok?r.per+'마리':'0마리'}</td></tr>`)}
  rows.push(`<tr><td>호수를 지키며 최대로<br><span class="muted">(매 라운드 반 전체 ${best.first}마리 정도)</span></td><td><span class="tag ok">${st.rounds}라운드 완주</span></td><td>약 ${(best.tot/st.n).toFixed(1)}마리</td></tr>`);
  rows.push(`<tr class="us"><td>우리 반 실제 결과</td><td>${ok?`<span class="tag ok">${st.rounds}라운드 완주</span>`:`<span class="tag no">${g.collapseRound}라운드에 붕괴</span>`}</td><td>${ok?(tot/st.n).toFixed(1)+'마리 (평균)':'0마리'}</td></tr>`);
  const order=g.totals.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),mx=Math.max(1,...g.totals);
  const rank=order.map((o,j)=>`<div class="rk ${ok?'':'lost'}"><span class="muted">${j+1}</span><span class="nm">${esc(label(o.i))}</span><span class="bar"><i style="width:${o.v/mx*100}%"></i></span><span class="v">${o.v}</span></div>`).join('');
  app.innerHTML=topHTML()+ruleBar()+`
  <div class="card">
    <div class="endhead"><div class="emo">${ok?'🎉':'😵'}</div>
      <h2>${ok?`${st.rounds}라운드까지 호수를 지켜냈어요!`:`${g.collapseRound}라운드에서 호수가 텅 비었어요…`}</h2>
      <p>${ok?'마을 사람 모두가 끝까지 물고기를 먹으며 살아남았어요. 잡은 물고기가 모두 점수가 돼요.':'물고기가 더 이상 태어날 수 없어 마을 사람 <b>모두의 수명이 아웃</b>! 그동안 잡아 둔 물고기도 모두 사라졌어요.'}</p></div>
    <div class="endstats">
      <div class="es"><div class="v">${ok?tot:`<s style="color:#b3bccb">${tot}</s>`}</div><div class="l">${ok?'반 전체가 잡은 물고기':'잡았지만 사라진 물고기'}</div></div>
      <div class="es"><div class="v">${ok?st.rounds:g.collapseRound-1} / ${st.rounds}</div><div class="l">무사히 끝낸 라운드</div></div>
      <div class="es"><div class="v">${g.fish}</div><div class="l">호수에 남은 물고기</div></div>
      <div class="es"><div class="v">${best.tot}</div><div class="l">호수를 지키며 잡을 수 있었던 최대</div></div>
    </div>
    <div style="max-width:520px;margin:0 auto">${chartHTML(g.history,g.fish,st)}</div>
  </div>
  <div class="endgrid">
    <div class="card cmp"><h3>🤔 이렇게 했다면?</h3><p class="muted">1인당 마지막에 가질 수 있는 물고기</p>
      <table><tr><th>방법</th><th>호수는?</th><th>1인당</th></tr>${rows.join('')}</table>
      <p class="muted" style="margin-top:10px">욕심내서 많이 잡으면 그 순간엔 내가 더 많이 갖지만, 호수가 무너지면 모두 0마리가 돼요.</p></div>
    <div class="card"><h3>${ok?'🏅 잡은 물고기':'🫥 잡았지만 사라진 물고기'}</h3><p class="muted">${ok?'많이 잡은 친구와 적게 잡은 친구가 있다면, 그건 공평했을까요?':'가장 많이 잡은 친구도 결국 0마리가 되었어요.'}</p><div class="rank">${rank}</div></div>
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
    ${TV?`<div class="card promise"><h3>📜 우리 반 약속 정하기</h3><p style="font-size:18px;line-height:1.7">모두가 끝까지 물고기를 잡으려면 어떤 약속이 필요할까요? 회의로 정한 약속은 선생님이 적어서 다음 판에 보여 줘요.</p>
      ${V.past.length?`<h3 style="margin-top:16px;font-size:18px">📚 지금까지의 게임</h3>${pastHTML()}`:''}</div>`:`<div class="card promise"><h3>📜 우리 반 약속 정하기</h3><p class="muted">회의로 정한 약속을 적고 다시 해 보세요. 선생님 화면과 학생 기기 화면 위에 계속 보여요.</p>
      <textarea id="ruleTxt" placeholder="예) 한 라운드에 한 사람당 1마리만 잡기. 호수가 80마리보다 적으면 모두 0마리 쉬기.">${esc(L.ruleDraft!=null?L.ruleDraft:V.rule)}</textarea>
      <div class="startrow" style="justify-content:flex-start;margin-top:12px">
        <button class="btn mint" data-act="restartRule">📜 약속 지키며 다시 하기</button>
        <button class="btn" data-act="restart">🔁 그냥 다시 하기</button></div>
      ${V.past.length?`<h3 style="margin-top:16px;font-size:18px">📚 지금까지의 게임</h3>${pastHTML()}`:''}</div>`}
  </div>`;
}

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
    case 'tvGo':{const c=(document.getElementById('tvCode').value||'').trim();if(!/^\d{4}$/.test(c))break;
      const r=await fetch('/api/info?c='+c);if(!r.ok){renderTVCode('그런 방이 없어요. 코드를 다시 확인해 주세요.');break}
      history.replaceState(null,'','/tv?c='+c);L.auth={code:c};connect();break}
    case 'resolve':tryResolve(false);break;
    case 'resolveForce':tryResolve(true);break;
    case 'next':modal.innerHTML='';act('next');window.scrollTo({top:0,behavior:'smooth'});break;
    case 'restartRule':{const rule=document.getElementById('ruleTxt').value;L.ruleDraft=null;saveLocal();act('newgame',{rule});break}
    case 'restart':L.ruleDraft=null;saveLocal();act('newgame',{rule:V.rule});break;
    case 'cancel':modal.innerHTML='';break;
    case 'yes':modal.innerHTML='';confirmBox.cb&&confirmBox.cb();break;
  }});
document.addEventListener('input',ev=>{if(ev.target.id==='ruleTxt'){L.ruleDraft=ev.target.value;saveLocal()}});
document.addEventListener('change',ev=>{const t=ev.target;if(!t.dataset.set)return;const k=t.dataset.set,st=L.settings;
  if(k==='skip')st.skip=t.value;
  else{const lim={maxNum:[2,40],rounds:[3,20],start:[5,300],cap:[10,300],growth:[0,100],maxCatch:[1,5]}[k];let v=parseInt(t.value,10);if(isNaN(v))v=DEF[k];st[k]=Math.max(lim[0],Math.min(lim[1],v))}
  if(st.start>st.cap)st.start=st.cap;
  saveLocal();renderIntro();document.querySelector('details.settings').open=true});
boot();
