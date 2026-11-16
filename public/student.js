/* 학생 기기 화면 */
const app=document.getElementById('app');
let me=loadMe(),V=null,es=null,info=null,form={code:'',num:null,nick:''},lastFish=null,lastKey='',sending=false;

function loadMe(){try{return JSON.parse(localStorage.getItem('fish-student'))||null}catch(e){return null}}
function saveMe(){try{me?localStorage.setItem('fish-student',JSON.stringify(me)):localStorage.removeItem('fish-student')}catch(e){}}

function boot(){
  const c=new URLSearchParams(location.search).get('c');
  if(me&&(!c||c===me.code)){connect();return}
  form.code=c&&/^\d{4}$/.test(c)?c:'';
  if(form.code)loadInfo();else renderJoin();
}

/* ---------- 들어가기 ---------- */
async function loadInfo(){info=null;renderJoin();
  if(!/^\d{4}$/.test(form.code))return;
  try{const r=await fetch('/api/info?c='+form.code);const j=await r.json();
    if(!r.ok){renderJoin(j.error||'그런 방이 없어요.');return}info=j;renderJoin()}
  catch(e){renderJoin('연결이 안 돼요. 잠시 뒤 다시 해 보세요.')}}
function renderJoin(err){
  let nums='';
  if(info)nums=info.nums.map(n=>`<button class="${form.num===n?'sel':''}" data-num="${n}" ${info.taken.includes(n)&&!(me&&me.num===n)&&form.oldNum!==n?'disabled':''}>${n}</button>`).join('');
  app.innerHTML=`
  <div class="mehead"><div class="logo"><div class="badge"><svg viewBox="0 0 42 26"><use href="#fishSym"/></svg></div><div><h1 style="font-size:22px">물고기 마을의 호수</h1><small>마을에 들어가기</small></div></div></div>
  <div class="card">
    <h3 style="font-size:19px">① 참여 코드</h3>
    <input class="field codefield" id="code" inputmode="numeric" maxlength="4" placeholder="0000" value="${esc(form.code)}" autocomplete="off">
    ${info?`<h3 style="font-size:19px;margin-top:18px">② 내 번호</h3><div class="numgrid">${nums}</div>
      <p class="muted" style="margin:0">흐린 번호는 이미 친구가 들어온 번호예요.</p>
      <h3 style="font-size:19px;margin-top:18px">③ 닉네임 <span class="muted">(안 써도 돼요)</span></h3>
      <input class="field" id="nick" maxlength="10" placeholder="예) 고등어왕" value="${esc(form.nick)}" autocomplete="off">
      <div class="startrow"><button class="btn big primary" data-act="join" ${form.num?'':'disabled'}>🐟 들어가기</button></div>`
      :`<p class="muted" style="text-align:center">선생님 TV에 나온 숫자 4자리를 넣어 주세요.</p>`}
    ${err?`<div class="err">${esc(err)}</div>`:''}
  </div>`;
  const ci=document.getElementById('code');
  ci.addEventListener('input',()=>{form.code=ci.value.replace(/\D/g,'').slice(0,4);ci.value=form.code;if(form.code.length===4)loadInfo()});
  const ni=document.getElementById('nick');if(ni)ni.addEventListener('input',()=>{form.nick=ni.value});
  if(!info)ci.focus();
}
async function join(){if(sending)return;sending=true;
  const r=await post('/api/join',{c:form.code,num:form.num,nick:form.nick,sid:me&&me.code===form.code?me.sid:(form.code===form.oldCode?form.oldSid:null)});sending=false;
  if(!r.ok){info=null;await loadInfo();renderJoin(r.data.error||'들어가지 못했어요.');return}
  me={code:form.code,sid:r.data.sid,num:r.data.num};saveMe();history.replaceState(null,'','/s?c='+form.code);connect()}

/* ---------- 연결 ---------- */
function connect(){if(es)es.close();lastKey='';lastFish=null;
  app.innerHTML=`<div class="waitbox"><div class="e">🐟</div><h2>마을로 가는 중…</h2></div>`;
  es=new EventSource(`/api/events?c=${me.code}&role=s&sid=${me.sid}`);
  es.onmessage=ev=>{V=JSON.parse(ev.data);
    if(V.kicked){leave('선생님이 자리를 비웠어요. 번호를 다시 골라 주세요.');return}
    setConn(true);render()};
  es.onerror=async()=>{setConn(false);
    try{const r=await fetch('/api/info?c='+me.code);if(r.status===404)leave('방이 사라졌어요. 선생님이 알려 주는 새 코드로 다시 들어와 주세요.')}catch(e){}};
}
function leave(msg){if(es)es.close();const code=me&&me.code;me=null;saveMe();V=null;form={code:code||'',num:null,nick:''};
  if(msg&&msg.startsWith('방이'))form.code='';
  info=null;if(form.code)loadInfo().then(()=>{});renderJoin(msg)}
function setConn(on){const el=document.getElementById('conn');if(el)el.style.display=on?'none':'block'}

/* ---------- 화면 ---------- */
function render(){const st=V.settings,key=[V.phase,V.gameNo,V.round,V.status].join('|');
  if(key!==lastKey||!document.getElementById('main')){
    lastKey=key;lastFish=null;
    app.innerHTML=`
    <div class="mehead"><div class="who">${V.num}번${V.nick?' '+esc(V.nick):''}</div><div class="mine">내 물고기 🐟 <span id="myTotal">${V.myTotal}</span></div></div>
    <div id="conn" class="err" style="display:none;margin:0 0 10px">연결이 끊겼어요. 다시 연결하는 중…</div>
    ${V.rule.trim()?`<div class="rulebar"><b>📜 약속</b><span>${esc(V.rule).replace(/\n/g,'<br>')}</span></div>`:''}
    <div class="card"><div id="lakeBox"></div>
      <div class="fishcount" style="margin-top:14px"><div><div class="lbl">호수의 물고기</div><div class="n" style="font-size:42px">${V.fish}<small> / ${st.cap}마리</small></div></div>
      <div style="text-align:right"><div class="lbl">라운드</div><div class="jua" style="font-size:28px">${Math.min(V.round,st.rounds)} <small style="font-size:16px;color:var(--sub)">/ ${st.rounds}</small></div></div></div>
      <div class="health"><i style="width:${V.fish/st.cap*100}%;background:${healthColor(V.fish/st.cap)}"></i></div></div>
    <div class="card" id="main" style="margin-top:14px"></div>
    <p class="muted" style="text-align:center;margin-top:16px"><button class="btn small" data-act="out">번호 바꾸기</button></p>`;
  }
  if(lastFish!==V.fish){lastFish=V.fish;document.getElementById('lakeBox').innerHTML=lakeHTML(V.fish,st.cap)}
  document.getElementById('myTotal').textContent=V.myTotal;
  const main=document.getElementById('main');
  if(V.phase==='lobby')main.innerHTML=`<div class="waitbox"><div class="e">🎣</div><h2>들어왔어요!</h2><p>선생님이 시작할 때까지 기다려요.</p><p>지금 <b>${V.joined}명</b>이 마을에 있어요.</p></div>`;
  else if(V.alive===false&&V.phase!=='end')main.innerHTML=outHTML();
  else if(V.phase==='pick')main.innerHTML=pickHTML();
  else if(V.phase==='result')main.innerHTML=resultHTML(true);
  else main.innerHTML=endHTML();
}
function outHTML(){const last=V.history[V.history.length-1];
  return `<div class="waitbox"><div class="e">😵</div><h2>탈락했어요</h2>
    <p>${V.deadRound}라운드가 끝나고 먹고 나니 내 물고기가 <b>0마리</b>가 되었어요.<br>다음 라운드에는 나갈 수 없어요.</p>
    <p>친구들이 호수를 끝까지 지킬 수 있을지 TV를 보며 응원해요.</p></div>
  ${V.phase==='result'&&last?resultHTML(false):''}`}
function pickHTML(){const st=V.settings,eat=st.eat||0;let b='';
  for(let v=0;v<=st.maxCatch;v++){const after=V.myTotal+v-eat,out=eat>0&&after<=0;
    b+=`<button class="${V.myPick===v?'sel':''}" data-pick="${v}">${v}마리 ${eat>0?`<small>${out?'→ 0마리, 탈락!':`→ 먹고 ${after}마리`}</small>`:v===0?'<small>쉬기</small>':''}</button>`}
  return `<h2 style="font-size:24px">🎣 ${V.round}라운드: 몇 마리 잡을까요?</h2>
  <p class="muted" style="margin:6px 0 0">친구에게 보여 주지 말고 몰래 골라요.${st.eat>0?`<br>라운드가 끝나면 <b>${st.eat}마리</b>를 먹어요. 먹고 나서 <b>0마리</b>면 탈락!`:''}</p>
  <div class="bigpick">${b}</div>
  <div class="msg ${V.myPick!=null?'good':'warn'}" style="margin-top:14px;font-size:16px">${V.myPick!=null?`<b>${V.myPick}마리</b>로 냈어요! 결과가 나오기 전까지는 바꿀 수 있어요.`:'아직 고르지 않았어요.'}<br><span class="muted">우리 반 ${V.submitted} / ${V.aliveCount}명 냈어요</span></div>`}
function resultHTML(waiting){const st=V.settings,e=V.history[V.history.length-1];if(!e)return '';const m=roundMsg(e,V.status,st);
  return `<h2 style="font-size:24px">${e.round}라운드 결과</h2>
  <div class="ministeps">
    <div class="step" style="background:var(--coral2)"><div class="v">−${e.caught}</div><div class="l">우리 반이 잡은 물고기</div></div>
    <div class="step" style="background:var(--mint2)"><div class="v">+${e.born}</div><div class="l">새로 태어난 물고기</div></div>
    <div class="step" style="background:#e6f4ff"><div class="v">${e.after}</div><div class="l">지금 호수 물고기</div></div>
    <div class="step" style="background:var(--yellow2)"><div class="v">${e.mine==null?0:e.mine}</div><div class="l">내가 잡으려 한 물고기</div></div>
  </div>
  ${st.eat>0&&V.status!=='collapsed'&&(V.alive||e.meStarved)?`<div class="msg ${e.meStarved?'bad':'good'}" style="font-size:16px;margin-bottom:10px">🍚 살기 위해 ${st.eat}마리를 먹었어요. ${e.meStarved?'내 물고기가 <b>0마리</b>! 탈락이에요. 😵':`내 물고기는 <b>${V.myTotal}마리</b> 남았어요.`}</div>`:''}
  ${e.starvedCount&&!e.meStarved?`<div class="msg warn" style="font-size:16px;margin-bottom:10px">😵 이번 라운드에 <b>${e.starvedCount}명</b>이 탈락했어요.</div>`:''}
  <div class="msg ${m.cls}" style="font-size:16px">${m.msg}</div>
  ${waiting&&V.status==='play'?`<p class="muted" style="text-align:center;margin-top:12px">선생님이 다음 라운드를 열 때까지 기다려요.</p>`:''}`}
function endHTML(){const st=V.settings,ok=V.status==='success';
  return `<div class="waitbox"><div class="e">${ok?'🎉':'😵'}</div>
    <h2>${ok?(V.alive?`${st.rounds}라운드까지 살아남았어요!`:'호수는 지켰지만 나는 탈락했어요'):V.reason==='starved'?'모두 탈락했어요…':'호수가 텅 비었어요…'}</h2>
    ${ok&&!V.alive?`<p>${V.deadRound}라운드에 물고기가 0마리가 되어 탈락했어요.</p>`:ok?`<p>내 점수는 <b style="font-size:26px;color:var(--coral)">${V.myTotal}마리</b>예요.</p>`
        :`<p>마을 모두의 수명이 아웃!<br>내가 모은 물고기 <s>${V.myTotal}마리</s>도 모두 사라졌어요.</p>`}
    <p>TV 화면을 보며 함께 이야기해 봐요.</p></div>
  <div class="chartwrap">${chartHTML(V.history,V.fish,st)}</div>`}

/* ---------- 이벤트 ---------- */
document.addEventListener('click',async ev=>{
  const n=ev.target.closest('[data-num]');if(n){form.num=+n.dataset.num;renderJoin();return}
  const p=ev.target.closest('[data-pick]');
  if(p&&V&&V.phase==='pick'){const v=+p.dataset.pick;V.myPick=v;render();
    const r=await post('/api/pick',{c:me.code,sid:me.sid,v});
    if(!r.ok&&r.data.error==='kicked')leave('선생님이 자리를 비웠어요. 번호를 다시 골라 주세요.');return}
  const a=ev.target.closest('[data-act]');if(!a)return;
  if(a.dataset.act==='join')join();
  if(a.dataset.act==='out'){if(es)es.close();const code=me.code;form={code,num:null,nick:'',oldCode:code,oldSid:me.sid,oldNum:me.num};me=null;saveMe();loadInfo()}
});
boot();
