'use client'
// ================================================
// LINGORA 10.0 — TUTOR /beta
// UX migrated from beta/index.html
// All mentor identities, onboarding, topics,
// schema renderer, artifact system preserved.
// ================================================
export default function BetaPage() {
  return (
    <>
      <style>{CSS}</style>
      <div id="app" dangerouslySetInnerHTML={{ __html: HTML }} />
      <script dangerouslySetInnerHTML={{ __html: JS }} />
    </>
  )
}

const CSS = `
:root{--navy:#080f1f;--navy2:#0d1828;--navy3:#132035;--teal:#00c9a7;--coral:#ff6b6b;--gold:#f5c842;--silver:rgba(255,255,255,.88);--muted:rgba(255,255,255,.42);--dim:rgba(255,255,255,.22);--border:rgba(255,255,255,.08);--card:rgba(255,255,255,.04);--r:18px;--ease:cubic-bezier(.22,1,.36,1)}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--navy);color:var(--silver);min-height:100vh;overflow-x:hidden}
#app{min-height:100vh}

/* ── ONBOARDING ── */
.ob{position:fixed;inset:0;background:var(--navy);z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center}
.ob.hidden{display:none}
.ob h1{font-family:Georgia,serif;font-size:clamp(2rem,5vw,3.5rem);font-weight:400;letter-spacing:-.03em;background:linear-gradient(135deg,#fff 40%,var(--teal));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem}
.ob p{font-size:1rem;color:var(--muted);max-width:420px;line-height:1.7;margin-bottom:2rem}
.ob-section{width:100%;max-width:460px}
.ob-label{font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem;display:block}
.ob-grid{display:grid;gap:.75rem}
.ob-grid.cols2{grid-template-columns:1fr 1fr}
.ob-grid.cols3{grid-template-columns:repeat(3,1fr)}
.ob-card{background:var(--navy2);border:1px solid var(--border);border-radius:var(--r);padding:1.2rem 1rem;cursor:pointer;transition:border-color .2s,transform .2s;text-align:left}
.ob-card:hover,.ob-card.sel{border-color:var(--teal);transform:translateY(-2px)}
.ob-card.sel{background:rgba(0,201,167,.08)}
.ob-card .oc-em{font-size:1.5rem;margin-bottom:.5rem;display:block}
.ob-card .oc-title{font-weight:700;font-size:.9rem;color:#fff;display:block;margin-bottom:.2rem}
.ob-card .oc-sub{font-size:.75rem;color:var(--muted)}
.ob-select{width:100%;background:var(--navy2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;font-size:14px;color:var(--silver);outline:none;transition:border-color .2s}
.ob-select:focus{border-color:var(--teal)}
.ob-select option{background:var(--navy2)}
.btn{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:14px;padding:13px 28px;border-radius:999px;border:none;cursor:pointer;text-decoration:none;transition:all .2s var(--ease)}
.btn-teal{background:var(--teal);color:var(--navy)}
.btn-teal:hover{background:#00a88a;transform:translateY(-2px)}
.btn-outline{background:transparent;color:var(--silver);border:1px solid var(--border)}
.btn-outline:hover{border-color:rgba(255,255,255,.3)}
.ob-progress{display:flex;gap:6px;margin-bottom:2rem}
.ob-progress span{height:3px;border-radius:3px;background:var(--border);flex:1;transition:background .3s}
.ob-progress span.done{background:var(--teal)}

/* ── CHAT ── */
#chat-screen{display:none;flex-direction:column;height:100vh;max-width:760px;margin:0 auto}
#chat-screen.active{display:flex}
.ch-header{padding:16px 20px;background:var(--navy2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.av{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
.av-s{background:linear-gradient(135deg,#7c3aed,#a78bfa)}
.av-a{background:linear-gradient(135deg,#0891b2,var(--teal))}
.av-n{background:linear-gradient(135deg,#d97706,#fbbf24)}
.av-ln{background:linear-gradient(135deg,var(--teal),#0891b2);color:var(--navy);font-weight:700;font-size:.85rem}
.ch-name{font-weight:700;font-size:15px;color:#fff}
.ch-spec{font-size:12px;color:var(--muted)}
.ch-actions{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
.ch-btn{padding:6px 12px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--silver);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap}
.ch-btn:hover{border-color:var(--teal);color:var(--teal)}
.ch-btn.active{border-color:var(--teal);color:var(--teal);background:rgba(0,201,167,.08)}
.token-badge{background:var(--gold);color:var(--navy);border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700}

.ch-msgs{flex:1;overflow-y:auto;padding:20px 16px;display:flex;flex-direction:column;gap:14px}
.ch-msgs::-webkit-scrollbar{width:4px}
.ch-msgs::-webkit-scrollbar-track{background:transparent}
.ch-msgs::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

.msg{display:flex;align-items:flex-end;gap:10px;max-width:88%}
.msg.user{flex-direction:row-reverse;margin-left:auto}
.msg-av{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;flex-shrink:0}
.bubble{padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.55}
.bubble.bot{background:var(--navy2);border:1px solid var(--border);color:var(--silver);border-bottom-left-radius:4px}
.bubble.user{background:var(--teal);color:var(--navy);font-weight:500;border-bottom-right-radius:4px}
.bubble code{background:rgba(0,0,0,.3);padding:1px 5px;border-radius:4px;font-size:.85em}
.bubble strong{color:#fff}
.bubble em{color:var(--teal)}
.bubble table{border-collapse:collapse;font-size:13px;margin:.5rem 0}
.bubble th,.bubble td{border:1px solid var(--border);padding:4px 8px}
.bubble th{background:var(--navy3)}

.typing{display:flex;gap:4px;padding:10px 14px;background:var(--navy2);border:1px solid var(--border);border-radius:16px;border-bottom-left-radius:4px;width:fit-content}
.typing span{width:5px;height:5px;border-radius:50%;background:var(--teal);animation:tdot 1.2s infinite}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes tdot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}

.ch-input{padding:12px 16px;border-top:1px solid var(--border);background:var(--navy);display:flex;align-items:flex-end;gap:10px}
.ch-textarea{flex:1;background:var(--navy2);border:1px solid var(--border);border-radius:14px;padding:10px 14px;font-size:14px;color:var(--silver);resize:none;outline:none;max-height:120px;line-height:1.5;transition:border-color .2s;font-family:inherit}
.ch-textarea:focus{border-color:rgba(0,201,167,.4)}
.ch-textarea::placeholder{color:var(--dim)}
.ch-hint{font-size:11px;color:var(--dim);text-align:center;padding:4px 0}
.icon-btn{width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .2s;flex-shrink:0}
.icon-btn:hover{border-color:var(--teal);color:var(--teal)}
.send-btn{background:var(--teal);color:var(--navy);border-color:var(--teal)}
.send-btn:hover{background:#00a88a}

/* ── ARTIFACTS ── */
.schema-box{background:var(--navy3);border:1px solid var(--border);border-radius:var(--r);margin-top:10px;overflow:hidden}
.sc-head{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.sc-badge{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--teal);background:rgba(0,201,167,.1);border:1px solid rgba(0,201,167,.2);padding:3px 10px;border-radius:999px}
.sc-title{font-size:16px;font-weight:700;color:#fff;margin:.3rem 0}
.sc-obj{font-size:13px;color:var(--muted);margin-bottom:10px}
.sc-concepts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.sc-tag{background:var(--card);border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:11px;color:var(--muted)}
.sc-subs{padding:0 16px 12px}
.sc-sub{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.sc-sub:last-child{border-bottom:none}
.sc-sub-title{font-weight:700;font-size:13px;color:#fff;margin-bottom:4px}
.sc-sub-body{font-size:13px;color:var(--muted);line-height:1.55}
.sc-takeaway{font-size:12px;color:var(--teal);margin-top:4px}
.sc-quiz{padding:0 16px 14px}
.sc-q{margin-bottom:10px}
.sc-qt{font-size:13px;font-weight:600;color:#fff;margin-bottom:6px}
.sc-opts{display:flex;flex-direction:column;gap:5px}
.sc-opt{font-size:12px;padding:6px 10px;border-radius:8px;border:1px solid var(--border);cursor:pointer;color:var(--muted);transition:all .2s}
.sc-opt:hover{border-color:var(--teal);color:var(--teal)}
.sc-opt.correct{background:rgba(0,201,167,.12);border-color:var(--teal);color:var(--teal)}
.sc-opt.wrong{background:rgba(255,107,107,.1);border-color:var(--coral);color:var(--coral)}
.sc-dl{padding:10px 16px 14px;border-top:1px solid var(--border)}
.sc-dl a{font-size:12px;font-weight:600;color:var(--teal);text-decoration:none}
.art-img{max-width:100%;border-radius:12px;margin-top:10px}
.art-dl{font-size:12px;font-weight:600;color:var(--teal);text-decoration:none;display:block;margin-top:6px}
.pdf-lnk{display:inline-flex;align-items:center;gap:6px;background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.25);color:var(--gold);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;text-decoration:none;margin-top:8px}
.audio-player{margin-top:8px;width:100%;border-radius:8px}
.comm-card{background:rgba(245,200,66,.07);border:1px solid rgba(245,200,66,.15);border-radius:12px;padding:12px 14px;margin-top:10px;font-size:13px;color:var(--muted);line-height:1.55}
.comm-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);margin-bottom:6px}
.system-msg{font-size:12px;color:var(--dim);font-style:italic;text-align:center;padding:4px 0}
@media(max-width:600px){.ch-actions{width:100%}.ob-grid.cols3{grid-template-columns:1fr 1fr}}
`

const HTML = `
<div id="ob1" class="ob">
  <div class="ob-progress"><span id="p1" class="done"></span><span id="p2"></span><span id="p3"></span></div>
  <h1>LINGORA</h1>
  <p>Learn Spanish. Live the culture.</p>
  <div class="ob-section">
    <span class="ob-label">Select your language</span>
    <select class="ob-select" id="langSelect">
      <option value="en">English</option>
      <option value="es">Español</option>
      <option value="no">Norsk</option>
      <option value="fr">Français</option>
      <option value="de">Deutsch</option>
      <option value="it">Italiano</option>
      <option value="pt">Português</option>
      <option value="ar">العربية</option>
      <option value="ja">日本語</option>
    </select>
    <br/><br/>
    <button class="btn btn-teal" onclick="goOb2()">Continue →</button>
  </div>
</div>

<div id="ob2" class="ob hidden">
  <div class="ob-progress"><span id="p1b" class="done"></span><span id="p2b" class="done"></span><span id="p3b"></span></div>
  <h1>Choose your mentor</h1>
  <p>Each mentor brings a different approach to learning Spanish.</p>
  <div class="ob-section">
    <span class="ob-label">Your mentor</span>
    <div class="ob-grid cols3">
      <div class="ob-card" data-mentor="sarah" onclick="selMentor(this,'sarah')">
        <span class="oc-em">📚</span>
        <span class="oc-title">Sarah</span>
        <span class="oc-sub">Grammar · DELE · Structure</span>
      </div>
      <div class="ob-card" data-mentor="alex" onclick="selMentor(this,'alex')">
        <span class="oc-em">🌍</span>
        <span class="oc-title">Alex</span>
        <span class="oc-sub">Travel · Culture · Conversation</span>
      </div>
      <div class="ob-card" data-mentor="nick" onclick="selMentor(this,'nick')">
        <span class="oc-em">💼</span>
        <span class="oc-title">Nick</span>
        <span class="oc-sub">Business · Interviews · Professional</span>
      </div>
    </div>
  </div>
</div>

<div id="ob3" class="ob hidden">
  <div class="ob-progress"><span class="done"></span><span class="done"></span><span class="done"></span></div>
  <h1>What do you want to work on?</h1>
  <div class="ob-section">
    <span class="ob-label">Select a topic</span>
    <div class="ob-grid cols2">
      <div class="ob-card" data-topic="conversation" onclick="selTopic(this,'conversation')">
        <span class="oc-em">💬</span>
        <span class="oc-title">Conversation</span>
      </div>
      <div class="ob-card" data-topic="structured" onclick="selTopic(this,'structured')">
        <span class="oc-em">📖</span>
        <span class="oc-title">Lessons</span>
      </div>
      <div class="ob-card" data-topic="cervantes" onclick="selTopic(this,'cervantes')">
        <span class="oc-em">🏛️</span>
        <span class="oc-title">Cervantes Exam</span>
      </div>
      <div class="ob-card" data-topic="business" onclick="selTopic(this,'business')">
        <span class="oc-em">🤝</span>
        <span class="oc-title">Business</span>
      </div>
      <div class="ob-card" data-topic="travel" onclick="selTopic(this,'travel')">
        <span class="oc-em">✈️</span>
        <span class="oc-title">Travel</span>
      </div>
      <div class="ob-card" data-topic="course" onclick="selTopic(this,'course')">
        <span class="oc-em">🎓</span>
        <span class="oc-title">Full Course</span>
      </div>
      <div class="ob-card" onclick="selTopic(this,'leveltest')" data-topic="leveltest">
        <span class="oc-em">📊</span>
        <span class="oc-title">Level Test</span>
      </div>
    </div>
  </div>
</div>

<div id="chat-screen">
  <div class="ch-header">
    <div id="chAv" class="av av-s"></div>
    <div>
      <div class="ch-name" id="chName">Sarah</div>
      <div class="ch-spec" id="chSpec">Mentora academica · LINGORA</div>
    </div>
    <div class="ch-actions">
      <button class="ch-btn" id="lvlBtn">AO</button>
      <span class="token-badge" id="tokBtn">0</span>
      <button class="ch-btn" id="topicBtn" onclick="showTopicInfo()">Topic</button>
      <button class="ch-btn" onclick="exportChat()">📋 Export</button>
      <button class="ch-btn" onclick="resetChat()">↺ Reset</button>
    </div>
  </div>
  <div class="ch-msgs" id="msgs"></div>
  <div id="typingRow" style="padding:0 16px 4px;display:none">
    <div class="msg"><div class="msg-av av-ln">LN</div><div class="typing"><span></span><span></span><span></span></div></div>
  </div>
  <div class="ch-hint" id="hint">Enter = new line · Ctrl+Enter = send</div>
  <div class="ch-input">
    <button class="icon-btn" id="micBtn" onclick="toggleMic()" title="Voice input">🎤</button>
    <input type="file" id="fileInput" style="display:none" accept="image/*,application/pdf,text/*" onchange="handleFile(event)">
    <button class="icon-btn" onclick="document.getElementById('fileInput').click()" title="Attach file">📎</button>
    <textarea class="ch-textarea" id="msgInput" rows="1" placeholder="Write in your language..."></textarea>
    <button class="icon-btn send-btn" onclick="sendMsg()" title="Send">▶</button>
  </div>
</div>
`

const JS = `
const MMETA = {
  sarah:{code:'SR',emoji:'📚',cls:'av-s',name:'Sarah',spec:'Academic mentor · LINGORA'},
  alex: {code:'AX',emoji:'🌍',cls:'av-a',name:'Alex', spec:'Travel and conversation mentor · LINGORA'},
  nick: {code:'NK',emoji:'💼',cls:'av-n',name:'Nick', spec:'Business mentor · LINGORA'}
};
const TSYS = {
  conversation:'Focus on natural, fluid conversation. Correct gently. Use real cultural anecdotes. Be warm and engaging.',
  structured:'Follow a clear pedagogical structure. Introduce concepts progressively with examples and mini-exercises.',
  cervantes:'Prepare for DELE or CCSE exams. Use official terminology, exam-style questions, timed practice texts.',
  business:'Professional Spanish: emails, meetings, presentations, negotiations, interviews. Formal register. Corporate vocabulary.',
  travel:'Real travel situations: hotels, restaurants, transport, emergencies, shopping. Practical phrases and local customs.',
  course:'Structured course from the user level. Sequence grammar, vocabulary, culture thematically. Advance systematically.',
  leveltest:'Diagnostic evaluation. Ask progressively harder questions to determine the user CEFR level accurately.'
};
const GREETINGS = {
  sarah:{es:'Hola, soy Sarah. Te acompanare con estructura y claridad. Que parte quieres trabajar hoy?',en:"Hi, I'm Sarah. I'll guide you with structure and clarity. What would you like to work on today?",no:'Hei, jeg er Sarah. Jeg skal hjelpe deg med struktur og klarhet. Hva vil du jobbe med i dag?',fr:'Bonjour, je suis Sarah. Je vous accompagnerai avec structure et clarte. Sur quoi voulez-vous travailler?',de:'Hallo, ich bin Sarah. Ich begleite Sie mit Struktur und Klarheit. Womit mochten Sie heute arbeiten?'},
  alex: {es:'Hola, soy Alex. Empecemos con algo real: un viaje, una cultura, una situacion concreta. Por donde empezamos?',en:"Hi, I'm Alex. Let's start with something real: a trip, a culture, a concrete situation. Where shall we begin?",no:'Hei, jeg er Alex. La oss begynne med noe virkelig: en reise, en kultur, en konkret situasjon. Hvor starter vi?',fr:'Bonjour, je suis Alex. Commen\\u00e7ons par quelque chose de concret: un voyage, une culture, une situation reelle.',de:'Hallo, ich bin Alex. Fangen wir mit etwas Konkretem an: eine Reise, eine Kultur, eine echte Situation.'},
  nick: {es:'Hola, soy Nick. Te ayudare con el espanol que necesitas en entornos profesionales. Que situacion tienes en mente?',en:"Hi, I'm Nick. I'll help you with professional Spanish, interviews, and business communication. What do you need today?",no:'Hei, jeg er Nick. Jeg hjelper deg med profesjonell spansk for intervjuer og forretningskommunikasjon. Hva trenger du?',fr:'Bonjour, je suis Nick. Je vous aiderai avec l espagnol professionnel. De quoi avez-vous besoin?',de:'Hallo, ich bin Nick. Ich helfe Ihnen mit professionellem Spanisch fur Vorstellungsgesprache und Geschaftskommunikation.'}
};

let S = {lang:null,mentor:null,topic:null,tokens:0,level:'A0',messages:[],samples:[],sessionId:'s'+Math.random().toString(36).slice(2),commercialOffers:[],lastTask:null,lastArtifact:null};
try{const sv=localStorage.getItem('lng1000');if(sv){const p=JSON.parse(sv);S={...S,...p,sessionId:'s'+Math.random().toString(36).slice(2)}}}catch{}
function save(){try{localStorage.setItem('lng1000',JSON.stringify(S))}catch{}}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function goOb2(){
  S.lang=document.getElementById('langSelect').value||'en';
  document.getElementById('ob1').classList.add('hidden');
  document.getElementById('ob2').classList.remove('hidden');
}
let _mentor=null,_topic=null;
function selMentor(el,m){document.querySelectorAll('[data-mentor]').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');_mentor=m;setTimeout(()=>{document.getElementById('ob2').classList.add('hidden');document.getElementById('ob3').classList.remove('hidden')},300)}
function selTopic(el,t){document.querySelectorAll('[data-topic]').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');_topic=t;setTimeout(startChat,300)}

function startChat(){
  S.mentor=_mentor||'sarah'; S.topic=_topic||'conversation';
  const m=MMETA[S.mentor];
  document.getElementById('chAv').className='av '+m.cls;
  document.getElementById('chAv').textContent=m.emoji;
  document.getElementById('chName').textContent=m.name;
  document.getElementById('chSpec').textContent=m.spec;
  document.getElementById('topicBtn').textContent=S.topic.charAt(0).toUpperCase()+S.topic.slice(1);
  document.querySelectorAll('.ob').forEach(o=>o.classList.add('hidden'));
  const cs=document.getElementById('chat-screen');
  cs.classList.add('active');
  const g=GREETINGS[S.mentor];
  const greet=g[S.lang]||g.en;
  renderMsg(m.code,fmt(greet));
  save();
}

function renderMsg(sender,html){
  const msgs=document.getElementById('msgs');
  const isUser=sender==='USR';
  const isLn=sender==='LN';
  const m=MMETA[S.mentor]||{cls:'av-s',code:'SR'};
  const wrap=document.createElement('div');
  wrap.className='msg'+(isUser?' user':'');
  const av=document.createElement('div');
  av.className='msg-av '+(isUser?'av-ln':isLn?'av-ln':m.cls);
  av.textContent=sender;
  const bub=document.createElement('div');
  bub.className='bubble '+(isUser?'user':'bot');
  bub.innerHTML=html;
  wrap.appendChild(av);wrap.appendChild(bub);
  msgs.appendChild(wrap);
  msgs.scrollTop=msgs.scrollHeight;
  return bub;
}

function fmt(t){
  if(!t)return '';
  t=t.replace(/\\|(.+)\\|\\n\\|[-| :]+\\|\\n((?:\\|.+\\|\\n?)+)/g,(_,h,rows)=>{
    const ths=h.split('|').filter(s=>s.trim()).map(s=>'<th>'+esc(s.trim())+'</th>').join('');
    const trs=rows.trim().split('\\n').map(r=>'<tr>'+r.split('|').filter(s=>s.trim()).map(s=>'<td>'+esc(s.trim())+'</td>').join('')+'</tr>').join('');
    return'<table><thead><tr>'+ths+'</tr></thead><tbody>'+trs+'</tbody></table>';
  });
  t=t.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
  t=t.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
  t=t.replace(/\`(.+?)\`/g,'<code>$1</code>');
  t=t.replace(/\\n/g,'<br>');
  return t;
}

function showTyping(){document.getElementById('typingRow').style.display='block';const m=document.getElementById('msgs');m.scrollTop=m.scrollHeight}
function hideTyping(){document.getElementById('typingRow').style.display='none'}

async function callAPI(payload){
  showTyping();
  const ctrl=new AbortController();
  const to=setTimeout(()=>ctrl.abort(),20000);
  try{
    const body={...payload,state:{...S,activeMentor:S.mentor,language:S.lang,topicSystemPrompt:TSYS[S.topic]||TSYS.conversation}};
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctrl.signal});
    const data=await r.json();
    clearTimeout(to);hideTyping();
    if(!r.ok){renderMsg('LN','Error: '+(data.message||'Something went wrong. Try again.'));return}
    if(data.diagnostic){renderMsg('LN','<pre style="font-size:11px;color:var(--teal)">'+esc(JSON.stringify(data.diagnostic,null,2))+'</pre>');return}
    const text=data.reply||data.message||data.content||null;
    if(!text){renderMsg('LN','No response received. Please try again.');return}
    if(data.state)S={...S,...data.state,samples:S.samples,sessionId:S.sessionId};
    const oldT=S.tokens;
    S.tokens=(S.tokens||0)+1;
    document.getElementById('tokBtn').textContent=S.tokens;
    document.getElementById('lvlBtn').textContent=S.level||'A0';
    const bub=renderMsg(MMETA[S.mentor]?.code||'SR',fmt(text));
    if(data.artifact)bub.appendChild(mkArtifact(data.artifact));
    if(data.commercialOffer){const cc=document.createElement('div');cc.className='comm-card';cc.innerHTML='<div class="comm-label">LINGORA · IMMERSION</div>'+esc(data.commercialOffer);bub.appendChild(cc)}
    S.messages.push({sender:MMETA[S.mentor]?.code||'SR',html:fmt(text)});
    if(data.pronunciationScore!==undefined){const ps=document.createElement('div');ps.style='font-size:12px;color:var(--gold);margin-top:6px';ps.textContent='Pronunciation score: '+data.pronunciationScore+'/10';bub.appendChild(ps)}
    if(oldT>0&&S.tokens%5===0&&!data.artifact){callAPI({message:'',autoSchema:true,state:S}).catch(()=>{})}
    save();
  }catch(e){hideTyping();clearTimeout(to);if(e.name==='AbortError'){renderMsg('LN','Timeout: response took too long. Try again.')}else{renderMsg('LN','Connection error. Check your network and try again.')}}
}

function mkArtifact(art){
  if(!art)return null;
  if(art.type==='schema')return mkSchema(art);
  if(art.type==='illustration'){const w=document.createElement('div');w.innerHTML='<img class="art-img" src="'+esc(art.url)+'" alt="LINGORA visual"><br><a class="art-dl" href="'+esc(art.url)+'" download target="_blank">Download image</a>';return w}
  if(art.type==='pdf'){const a=document.createElement('a');a.className='pdf-lnk';a.href=art.url;a.download='lingora.pdf';a.target='_blank';a.innerHTML='📄 Download PDF';return a}
  if(art.type==='audio'){const p=document.createElement('audio');p.controls=true;p.className='audio-player';p.src=art.url;return p}
  return null;
}

function mkSchema(art){
  const c=art.content||{};
  const div=document.createElement('div');div.className='schema-box';
  const keys=(c.keyConcepts||[]).map(k=>'<span class="sc-tag">'+esc(k)+'</span>').join('');
  const subs=(c.subtopics||[]).map(s=>'<div class="sc-sub"><div class="sc-sub-title">'+esc(s.title)+'</div><div class="sc-sub-body">'+esc(s.content)+'</div>'+(s.keyTakeaway?'<div class="sc-takeaway">80/20: '+esc(s.keyTakeaway)+'</div>':'')+' </div>').join('');
  const qz=(c.quiz||[]).map((q,qi)=>'<div class="sc-q"><div class="sc-qt">'+(qi+1)+'. '+esc(q.question)+'</div><div class="sc-opts">'+(q.options||[]).map((o,oi)=>'<div class="sc-opt" onclick="quizOpt(this,'+(oi===q.correct)+')">'+'ABCDE'[oi]+') '+esc(o)+'</div>').join('')+'</div></div>').join('');
  div.innerHTML='<div class="sc-head"><span class="sc-badge">'+esc(c.block||'LINGORA')+'</span></div><div style="padding:12px 16px"><div class="sc-title">'+esc(c.title||'')+'</div><div class="sc-obj">'+esc(c.objective||'')+'</div><div class="sc-concepts">'+keys+'</div></div>'+(subs?'<div class="sc-subs">'+subs+'</div>':'')+(qz?'<div class="sc-quiz">'+qz+'</div>':'')+'<div class="sc-dl"><a href="#" onclick="exportSchema(event,this)" data-schema="'+esc(JSON.stringify(c))+'">Download schema (.txt)</a></div>';
  return div;
}
window.quizOpt=function(el,correct){if(el.classList.contains('correct')||el.classList.contains('wrong'))return;el.classList.add(correct?'correct':'wrong')}
window.exportSchema=function(e,el){e.preventDefault();const c=JSON.parse(el.dataset.schema||'{}');const txt='LINGORA Schema\\n'+c.title+'\\n\\n'+c.objective+'\\n\\nKey concepts:\\n'+(c.keyConcepts||[]).join(', ')+'\\n\\n'+(c.subtopics||[]).map(s=>s.title+'\\n'+s.content).join('\\n\\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt]));a.download='schema.txt';a.click()}

async function sendMsg(){
  const ta=document.getElementById('msgInput');
  const msg=ta.value.trim();
  if(!msg)return;
  ta.value='';ta.style.height='auto';
  renderMsg('USR',esc(msg));
  S.samples.push(msg);
  await callAPI({message:msg});
}

document.getElementById('msgInput')?.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();sendMsg()}
});
document.getElementById('msgInput')?.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'});

// Voice
let mediaRec=null,audioChunks=[];
async function toggleMic(){
  const btn=document.getElementById('micBtn');
  if(mediaRec&&mediaRec.state==='recording'){mediaRec.stop();btn.style.color='';return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[];mediaRec=new MediaRecorder(stream);
    mediaRec.ondataavailable=e=>audioChunks.push(e.data);
    mediaRec.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:'audio/webm'});
      const b64=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.readAsDataURL(blob)});
      renderMsg('USR','🎤 Audio sent');
      const r=await fetch('/api/audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio:{data:b64,format:'webm'},state:S})});
      const d=await r.json();
      if(d.transcription)S.samples.push(d.transcription);
      const text=d.reply||d.message||d.content||'';
      if(text){const bub=renderMsg(MMETA[S.mentor]?.code||'SR',fmt(text));if(d.artifact)bub.appendChild(mkArtifact(d.artifact))}
      save();
    };
    mediaRec.start();btn.style.color='var(--coral)';
  }catch(e){renderMsg('LN','Microphone not available: '+e.message)}
}

// File
async function handleFile(ev){
  const file=ev.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const b64=reader.result.split(',')[1];
    renderMsg('USR','📎 '+esc(file.name));
    await callAPI({files:[{name:file.name,type:file.type,data:b64,size:file.size}]});
  };
  reader.readAsDataURL(file);
  ev.target.value='';
}

function exportChat(){
  const lines=S.messages.map(m=>m.sender+': '+m.html.replace(/<[^>]+>/g,''));
  const blob=new Blob([lines.join('\\n\\n')],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lingora-chat.txt';a.click();
}
function resetChat(){
  S={...S,tokens:0,level:'A0',messages:[],samples:[],lastTask:null,lastArtifact:null,commercialOffers:[]};
  document.getElementById('msgs').innerHTML='';
  save();
  document.getElementById('chat-screen').classList.remove('active');
  document.querySelectorAll('.ob').forEach(o=>o.classList.add('hidden'));
  document.getElementById('ob1').classList.remove('hidden');
}
function showTopicInfo(){renderMsg('LN','Current topic: <strong>'+esc(S.topic)+'</strong>')}
`
