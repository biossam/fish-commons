/* 교사·학생 화면이 함께 쓰는 그림 함수 */
(function(){
  const sym=`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="fishSym" viewBox="0 0 42 26">
    <path d="M38 13 L28 4 Q27 13 28 22 Z" fill="currentColor"/>
    <ellipse cx="16" cy="13" rx="15" ry="10" fill="currentColor"/>
    <ellipse cx="17" cy="16" rx="9" ry="4.5" fill="#fff" opacity=".35"/>
    <circle cx="9" cy="10.5" r="2.6" fill="#2e3a59"/><circle cx="9.8" cy="9.6" r=".9" fill="#fff"/>
    <path d="M4 15.5 q2.5 2 5 .2" stroke="#2e3a59" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <circle cx="14" cy="15" r="1.8" fill="#ff7a8a" opacity=".55"/></symbol></defs></svg>`;
  document.body.insertAdjacentHTML('afterbegin',sym);
})();
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=a=>a.reduce((x,y)=>x+(y||0),0);
function growWith(st,left){if(left<=0)return{born:0,after:0};const born=Math.floor(left*st.growth/100);return{born,after:Math.min(st.cap,left+born)}}
function safeCatch(st,N){for(let c=N;c>=0;c--){const left=N-c;if(left<=0)continue;if(growWith(st,left).after>=N)return c}return 0}
const POS=(()=>{let s=20261116;const r=()=>(s=(s*16807)%2147483647)/2147483647;
  const colors=['#ff9f80','#ffc857','#ff8fb1','#7cc8ff','#8fe0bd','#c3a6ff','#ffb36b'];
  return Array.from({length:150},()=>({x:7+r()*86,y:12+r()*76,c:colors[Math.floor(r()*colors.length)],d:(r()*4).toFixed(2),f:r()<.5?-1:1,s:(0.75+r()*0.5).toFixed(2)}))})();
function lakeHTML(N,cap){const per=cap>150?Math.ceil(cap/150):1;const cnt=Math.min(150,Math.ceil(N/per));
  let h='<div class="wave" style="top:22%;left:15%;right:55%"></div><div class="wave" style="top:70%;left:50%;right:18%"></div>';
  for(let i=0;i<cnt;i++){const p=POS[i];h+=`<span class="fish" style="left:${p.x}%;top:${p.y}%;color:${p.c};--d:${p.d};--s:${p.s};--f:${p.f}"><svg viewBox="0 0 42 26"><use href="#fishSym"/></svg></span>`}
  return `<div class="lake ${N<=0?'empty':''}">${h}${N<=0?'<div class="emptymsg">텅…</div>':''}${per>1?`<div class="per">그림 1마리 = ${per}마리</div>`:''}</div>`}
function healthColor(p){return p>.66?'var(--mint)':p>.33?'var(--yellow)':'var(--coral)'}
function chartHTML(hist,fishNow,st){const R=st.rounds,W=420,H=170,pl=30,pr=10,pt=12,pb=26;
  const slots=R+1,sw=(W-pl-pr)/slots,y=v=>pt+(H-pt-pb)*(1-v/st.cap),x=i=>pl+sw*(i+.5);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="라운드별 호수 물고기 수">`;
  [0,.5,1].forEach(f=>{const v=Math.round(st.cap*f);s+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="#e8eef7"/><text x="${pl-5}" y="${y(v)+4}" font-size="10" text-anchor="end" fill="#8a96b0">${v}</text>`});
  const pts=[];hist.forEach((h,i)=>{const bh=(H-pt-pb)*Math.min(1,h.demand/st.cap);
    s+=`<rect x="${x(i)-sw*.28}" y="${H-pb-bh}" width="${sw*.56}" height="${bh}" rx="4" fill="#ffd2c9"/>`;pts.push([x(i),y(h.before)])});
  if(hist.length){pts.push([x(hist.length),y(hist[hist.length-1].after)])}else pts.push([x(0),y(fishNow)]);
  if(pts.length>1)s+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#3a9ad9" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach(p=>s+=`<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#fff" stroke="#3a9ad9" stroke-width="2.5"/>`);
  for(let i=0;i<slots;i++)s+=`<text x="${x(i)}" y="${H-8}" font-size="11" text-anchor="middle" fill="#8a96b0">${i<R?i+1:'끝'}</text>`;
  return s+'</svg><div class="muted">파란 선: 라운드 시작 때 호수의 물고기 · 분홍 막대: 그 라운드에 잡은 물고기</div>'}
function roundMsg(e,status,st){
  if(status==='collapsed')return{cls:'bad',msg:e.demand>e.before?`잡으려던 물고기는 <b>${e.demand}마리</b>인데, 호수에는 <b>${e.before}마리</b>밖에 없었어요! 호수가 텅 비어서 더 이상 물고기가 태어날 수 없어요. 😵`:`호수의 물고기를 모두 잡아 버렸어요! 새끼를 낳을 물고기가 한 마리도 남지 않았어요. 😵`};
  if(e.after>=e.before)return{cls:'good',msg:`호수가 건강해요! 물고기가 <b>${e.after}마리</b> 있어요. 😊`};
  const drop=e.before-e.after;return{cls:e.after<st.cap*.4?'bad':'warn',msg:`호수의 물고기가 <b>${drop}마리</b> 줄었어요. 이대로 계속 잡으면 어떻게 될까요? 🤔`}}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let j={};try{j=await r.json()}catch(e){}return{ok:r.ok,status:r.status,data:j}}
