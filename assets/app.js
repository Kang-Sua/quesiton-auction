/* 질문 경매장 — 우리 학교가 사라진대요!
   독서인문 수업용 도구. GitHub Pages 등 정적 호스팅에서 동작합니다. */

const CFG   = window.QA_CONFIG || {};
const PURSE = CFG.purse || 1000;
const STEP  = CFG.step  || 100;

const PHASES = [
  { id:'lobby',  label:'모이기' },
  { id:'write',  label:'질문 쓰기' },
  { id:'fact',   label:'사실 질문' },
  { id:'bid',    label:'경매' },
  { id:'result', label:'낙찰' }
];

const TABS = [
  { k:'fact',    name:'사실',  field:'fact',
    hint:'책 안에 답이 있는 질문',   sub:'쪽수를 짚어 확인할 수 있는 것을 물어보세요.' },
  { k:'debate',  name:'논쟁',  field:'debate',
    hint:'답이 갈릴 것 같은 질문',   sub:'친구들 생각이 서로 다를 만한 것을 물어보세요.' },
  { k:'reflect', name:'성찰',  field:'reflect',
    hint:'책을 덮고도 남는 질문',   sub:'답을 바로 낼 수 없어도 괜찮습니다.' }
];

/* ══════════ 저장소 ══════════ */

function toArr(v){
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return Object.keys(v).map(k => v[k]).filter(Boolean);
}

/* 여러 기기 — Firebase 실시간 데이터베이스 */
class FirebaseStore {
  constructor(cfg){ this.cfg = cfg; this.mode = 'firebase'; }

  async init(room){
    const [{ initializeApp }, dbMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
    ]);
    this.M = dbMod;
    const app = initializeApp(this.cfg);
    this.db = dbMod.getDatabase(app);
    this.base = 'rooms/' + room;
  }

  watch(cb){
    const { ref, onValue } = this.M;
    onValue(ref(this.db, this.base), snap => {
      const v = snap.val() || {};
      cb({
        state:    v.state || { phase:'lobby' },
        board:    v.board || null,
        students: toArr(v.students).sort((a,b) => (a.at||0) - (b.at||0))
      });
    });
  }

  setState(v){   return this.M.set(this.M.ref(this.db, this.base + '/state'), v); }
  setBoard(v){   return this.M.set(this.M.ref(this.db, this.base + '/board'), v); }
  setStudent(sid, v){ return this.M.set(this.M.ref(this.db, this.base + '/students/' + sid), v); }
  reset(){       return this.M.remove(this.M.ref(this.db, this.base)); }
}

/* 혼자 연습 — 같은 기기의 여러 탭끼리만 */
class LocalStore {
  constructor(){ this.mode = 'local'; }

  async init(room){
    this.key = 'qa-local:' + room;
    this.cb  = null;
    window.addEventListener('storage', e => {
      if (e.key === this.key && this.cb) this.cb(this.read());
    });
  }

  read(){
    let v = {};
    try { v = JSON.parse(localStorage.getItem(this.key) || '{}'); } catch(e){}
    return {
      state:    v.state || { phase:'lobby' },
      board:    v.board || null,
      students: toArr(v.students).sort((a,b) => (a.at||0) - (b.at||0))
    };
  }

  raw(){
    try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch(e){ return {}; }
  }

  write(v){
    localStorage.setItem(this.key, JSON.stringify(v));
    if (this.cb) this.cb(this.read());
  }

  watch(cb){ this.cb = cb; cb(this.read()); }

  async setState(v){ const r = this.raw(); r.state = v; this.write(r); }
  async setBoard(v){ const r = this.raw(); r.board = v; this.write(r); }
  async setStudent(sid, v){
    const r = this.raw();
    r.students = r.students || {};
    r.students[sid] = v;
    this.write(r);
  }
  async reset(){ localStorage.removeItem(this.key); if (this.cb) this.cb(this.read()); }
}

/* ══════════ 상태 ══════════ */

let store = null;
let me = null;                       // { sid, name, role, room }
let state = { phase:'lobby' };
let board = null;
let students = [];
let mine = null;
let tab = 'fact';
let msg = '', msgKind = '';
let busy = false;
let bootCheck = false;   // 저장된 신분으로 다시 들어온 경우인지

const $  = id => document.getElementById(id);
const app = () => $('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const won  = n => Number(n||0).toLocaleString('ko-KR');
const uid  = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const pIdx = id => Math.max(0, PHASES.findIndex(p => p.id === id));

function say(t, k){ msg = t; msgKind = k || 'err'; render(); }

function saveMe(){ localStorage.setItem('qa-me', JSON.stringify(me)); }
function loadMe(){
  try { return JSON.parse(localStorage.getItem('qa-me') || 'null'); } catch(e){ return null; }
}

/* ══════════ 동작 ══════════ */

async function connect(room){
  store = CFG.firebase ? new FirebaseStore(CFG.firebase) : new LocalStore();
  await store.init(room);
  store.watch(snap => {
    const typing = document.activeElement &&
      /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    state = snap.state;
    board = snap.board;
    students = snap.students;
    if (me && me.role === 'student'){
      const found = students.find(s => s.sid === me.sid);
      if (!found && bootCheck){
        // 선생님이 초기화했거나 기록이 사라진 경우 — 처음 화면으로
        localStorage.removeItem('qa-me');
        me = null; mine = null; bootCheck = false;
        msg = ''; render();
        return;
      }
      if (found){
        bootCheck = true;
        mine = typing
          ? Object.assign({}, found, { fact:mine.fact, debate:mine.debate, reflect:mine.reflect })
          : found;
      }
    }
    if (!typing) render();
  });
}

async function join(room, name, role){
  if (!room.trim()) { say('방 번호를 적어 주세요.'); return; }
  if (!name.trim()) { say('이름을 적어 주세요.'); return; }
  busy = true; render();
  bootCheck = false;
  me = { sid: uid(), name: name.trim(), role, room: room.trim() };
  saveMe();
  await connect(me.room);
  if (role === 'student'){
    mine = { sid:me.sid, name:me.name, fact:'', debate:'', reflect:'',
             sent:false, bids:{}, bidSent:false, at:Date.now() };
    await store.setStudent(me.sid, mine);
  }
  busy = false; msg = '';
  render();
}

function captureDraft(){
  if (!mine) return;
  const t = $('qbox');
  if (!t) return;
  const f = (TABS.find(x => x.k === tab) || TABS[0]).field;
  mine[f] = t.value;
}

async function sendQuestions(){
  captureDraft();
  if (!mine.fact.trim() && !mine.debate.trim() && !mine.reflect.trim()){
    say('질문을 하나 이상 적어 주세요.'); return;
  }
  busy = true;
  mine.fact = mine.fact.trim();
  mine.debate = mine.debate.trim();
  mine.reflect = mine.reflect.trim();
  mine.sent = true;
  try { await store.setStudent(me.sid, mine); busy = false; say('보냈습니다. 고쳐서 다시 보낼 수 있어요.','ok'); }
  catch(e){ busy = false; say('보내지 못했습니다. 다시 눌러 주세요.'); }
}

function setBid(qid, d){
  const b = mine.bids || (mine.bids = {});
  const cur = b[qid] || 0;
  let used = 0; for (const k in b) used += b[k];
  const nx = cur + d;
  if (nx < 0) return;
  if (used - cur + nx > PURSE) return;
  if (nx === 0) delete b[qid]; else b[qid] = nx;
  mine.bidSent = false; msg = '';
  render();
}

async function sendBid(){
  busy = true; mine.bidSent = true;
  try { await store.setStudent(me.sid, mine); busy = false; say('입찰을 보냈습니다.','ok'); }
  catch(e){ busy = false; mine.bidSent = false; say('보내지 못했습니다. 다시 눌러 주세요.'); }
}

function shuffle(a){
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBoard(){
  const facts = [], lots = [];
  students.forEach(s => {
    if (s.fact)    facts.push({ id:s.sid+'-f', text:s.fact, by:s.name });
    if (s.debate)  lots.push({ id:s.sid+'-d', text:s.debate,  by:s.name, kind:'논쟁', owner:s.sid });
    if (s.reflect) lots.push({ id:s.sid+'-r', text:s.reflect, by:s.name, kind:'성찰', owner:s.sid });
  });
  const extra = (board && toArr(board.extra)) || [];
  extra.forEach(e => lots.push(e));
  return {
    facts,
    lots: shuffle(lots),
    checked: (board && board.checked) || {},
    extra,
    at: Date.now()
  };
}

async function goPhase(p){
  busy = true; render();
  if (p === 'fact') await store.setBoard(buildBoard());
  await store.setState({ phase:p, at:Date.now() });
  busy = false; msg = '';
  render();
}

async function rebuild(){
  busy = true; render();
  await store.setBoard(buildBoard());
  busy = false; render();
}

async function toggleFact(id){
  if (!board) return;
  board.checked = board.checked || {};
  if (board.checked[id]) delete board.checked[id]; else board.checked[id] = true;
  board.at = Date.now();
  render();
  await store.setBoard(board);
}

async function addLot(text, kind){
  if (!text.trim()) return;
  busy = true;
  board = board || { facts:[], lots:[], checked:{}, extra:[], at:Date.now() };
  board.extra = toArr(board.extra);
  board.lots  = toArr(board.lots);
  const it = { id:'x'+Date.now().toString(36), text:text.trim(), by:'선생님', kind, owner:'teacher' };
  board.extra.push(it);
  board.lots.push(it);
  board.at = Date.now();
  await store.setBoard(board);
  busy = false; render();
}

async function resetAll(){
  busy = true; render();
  await store.reset();
  board = null; students = []; state = { phase:'lobby' };
  await store.setState(state);
  busy = false;
  say('모두 지웠습니다. 학생들은 다시 들어와야 합니다.','ok');
}

function leave(){
  localStorage.removeItem('qa-me');
  location.reload();
}

function results(){
  if (!board) return [];
  const tot = {}, cnt = {};
  students.forEach(s => {
    const b = s.bids || {};
    for (const q in b){
      if (!b[q]) continue;
      tot[q] = (tot[q] || 0) + b[q];
      cnt[q] = (cnt[q] || 0) + 1;
    }
  });
  return toArr(board.lots)
    .map(l => ({ lot:l, total: tot[l.id] || 0, bidders: cnt[l.id] || 0 }))
    .sort((a,b) => b.total - a.total);
}

/* ══════════ 화면 ══════════ */

function hero(){
  const who = me ? `<div class="whoBox">${me.role==='teacher'?'진행':'참가'}
      <b>${esc(me.name)}</b><em>${esc(me.room)}</em></div>` : '';
  const rail = me ? `<div class="rail">${PHASES.map((p,i) => {
      const c = i === pIdx(state.phase) ? 'on' : (i < pIdx(state.phase) ? 'done' : '');
      return `<span class="railChip ${c}">${p.label}</span>`;
    }).join('')}</div>` : '';
  return `<div class="band band-dark hero"><div class="inner">
    <div class="heroTop"><div class="orb">?</div>${who}</div>
    <p class="eyebrow">우리 학교가 사라진대요!</p>
    <h1 class="heroTitle">질문 경매장</h1>
    ${rail}
  </div></div>`;
}

const feedback = () => msg
  ? `<p class="${msgKind==='ok'?'msgOk':'msgErr'}">${esc(msg)}</p>` : '';

const waitBand = (big, sub) => `<div class="band band-light"><div class="inner">
  <div class="spin"></div><h2 class="stateBig">${esc(big)}</h2>
  <p class="stateSub">${esc(sub||'')}</p></div></div>`;

/* ── 입장 ── */
function viewSetup(){
  const note = CFG.firebase ? '' : `<div class="modeNote">
    <b>혼자 연습 모드</b>로 켜져 있습니다. 같은 기기의 여러 탭끼리만 맞춰지고,
    다른 기기와는 연결되지 않습니다. 수업에서 쓰려면 config.js에 Firebase 설정을 넣으세요.</div>`;
  return hero() + `<div class="band band-light"><div class="inner">
    <h2 class="h-lg">방 번호와 이름을 적으세요</h2>
    <p class="lead">모두 같은 방 번호로 들어와야 합니다. 진행은 선생님 한 사람만 고릅니다.</p>
    <div class="field"><p class="fieldLbl">방 번호</p>
      <input type="text" id="rm" class="code" value="${esc(CFG.defaultRoom||'')}" autocomplete="off"></div>
    <div class="field"><p class="fieldLbl">이름</p>
      <input type="text" id="nm" placeholder="이름" autocomplete="off"></div>
    <div class="roleGrid">
      <button class="roleBtn sel" id="rs"><b>참가하기</b><span>질문을 쓰고 입찰합니다</span></button>
      <button class="roleBtn" id="rt"><b>진행하기</b><span>단계를 넘기고 결과를 엽니다</span></button>
    </div>
    <div class="row"><button class="btn" id="go" ${busy?'disabled':''}>들어가기</button></div>
    ${feedback()}${note}
  </div></div>`;
}

function bindSetup(){
  let role = 'student';
  const rs = $('rs'), rt = $('rt');
  rs.onclick = () => { role = 'student'; rs.classList.add('sel'); rt.classList.remove('sel'); };
  rt.onclick = () => { role = 'teacher'; rt.classList.add('sel'); rs.classList.remove('sel'); };
  $('go').onclick = () => join($('rm').value, $('nm').value, role);
  $('nm').onkeydown = e => { if (e.key === 'Enter') $('go').click(); };
}

/* ── 학생 ── */
function studentBody(){
  const p = state.phase;
  if (!mine) return waitBand('연결하는 중','');

  if (p === 'lobby') return waitBand('잠깐 기다려요','곧 질문 쓰기가 시작됩니다.');

  if (p === 'write'){
    const cur = TABS.find(t => t.k === tab) || TABS[0];
    const tabsHtml = TABS.map(t => {
      const filled = (mine[t.field]||'').trim() ? ' filled' : '';
      return `<button class="tab${t.k===tab?' on':''}" data-tab="${t.k}">
        <span class="dot${filled}"></span>${t.name} 질문</button>`;
    }).join('');
    return `<div class="band band-light"><div class="inner">
      <h2 class="h-lg">질문 세 개를 만듭니다</h2>
      <p class="lead">책을 다시 펼쳐 보고, 걸리는 장면에서 시작하세요.</p>
      <div style="margin-top:28px"><div class="tabs">${tabsHtml}</div>
        <div class="panel">
          <p class="panelHint">${esc(cur.hint)}</p>
          <p class="panelSub">${esc(cur.sub)}</p>
          <textarea id="qbox" rows="3" placeholder="여기에 적으세요">${esc(mine[cur.field]||'')}</textarea>
        </div></div>
      <div class="row"><button class="btn" id="send">${mine.sent?'고쳐서 다시 보내기':'세 질문 보내기'}</button>
      ${mine.sent?'<span class="cap">보냈습니다</span>':''}</div>
      ${feedback()}
    </div></div>`;
  }

  if (p === 'fact'){
    if (!board) return waitBand('모으는 중','');
    const facts = toArr(board.facts);
    const l = facts.length ? facts.map(f => {
      const off = board.checked && board.checked[f.id];
      return `<div class="fRow${off?' off':''}">
        <div class="fBox" style="cursor:default">${off?'✓':''}</div>
        <div class="t">${esc(f.text)}</div></div>`;
    }).join('') : '<p class="lead">사실 질문이 없습니다.</p>';
    return `<div class="band band-light"><div class="inner">
      <h2 class="h-lg">사실 질문</h2>
      <p class="lead">책에서 답을 찾아 함께 확인합니다. 쪽수를 짚어 보세요.</p>
      <div style="margin-top:28px">${l}</div></div></div>`;
  }

  if (p === 'bid'){
    if (!board) return waitBand('경매 준비 중','');
    const b = mine.bids || {};
    let used = 0; for (const k in b) used += b[k];
    const left = PURSE - used;
    let coins = '';
    for (let i = 0; i < PURSE/STEP; i++)
      coins += `<div class="coin${i < used/STEP ? ' spent':''}"></div>`;
    const lots = toArr(board.lots).map((l,i) => {
      const amt = b[l.id] || 0, own = (l.owner === me.sid);
      return `<div class="lot${own?' mine':''}">
        <div class="lotNo">${i+1}</div>
        <div class="lotBody"><p class="lotText">${esc(l.text)}</p>
          <div class="lotMeta"><span class="pillTag">${esc(l.kind)}</span>${own?'내가 쓴 질문':''}</div></div>
        ${own?'':`<div class="lotCtl">
          <button class="icoBtn" data-m="${l.id}" ${amt<=0?'disabled':''} aria-label="줄이기">−</button>
          <div class="bidAmt${amt?'':' zero'}">${won(amt)}</div>
          <button class="icoBtn plus" data-p="${l.id}" ${left<=0?'disabled':''} aria-label="올리기">+</button>
        </div>`}
      </div>`;
    }).join('');
    return `<div class="band band-light"><div class="inner">
      <div class="purse"><div><p class="lbl">남은 돈</p><p class="amt">${won(left)}<span>원</span></p></div>
      <div class="coins">${coins}</div></div>
      <h2 class="h-lg">꼭 이야기하고 싶은 질문에 돈을 거세요</h2>
      <p class="lead">한 질문에 전부 걸어도 됩니다. ${won(STEP)}원씩 움직입니다.</p>
      <div style="margin-top:28px">${lots}</div>
      <div class="row"><button class="btn" id="bidgo" ${used===0?'disabled':''}>${mine.bidSent?'고쳐서 다시 보내기':'입찰 보내기'}</button>
      ${mine.bidSent?'<span class="cap">보냈습니다</span>':''}</div>
      ${feedback()}
    </div></div>`;
  }

  if (p === 'result') return `<div class="band band-light"><div class="inner">
    <h2 class="stateBig">앞을 보세요</h2>
    <p class="stateSub">낙찰된 질문이 앞 화면에 있습니다. 왜 그 질문에 돈을 걸었는지 생각해 두세요.</p>
  </div></div>`;

  return '';
}

function bindStudent(){
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.onclick = () => { captureDraft(); tab = el.dataset.tab; msg = ''; render(); };
  });
  if ($('send')) $('send').onclick = sendQuestions;
  document.querySelectorAll('.icoBtn').forEach(el => {
    el.onclick = () => {
      if (el.dataset.p) setBid(el.dataset.p, STEP);
      else if (el.dataset.m) setBid(el.dataset.m, -STEP);
    };
  });
  if ($('bidgo')) $('bidgo').onclick = sendBid;
}

/* ── 교사 ── */
function ctlBand(){
  const i = pIdx(state.phase);
  const label = ['질문 쓰기 시작','사실 질문 모으기','경매 열기','낙찰 공개',''][i];
  const next = PHASES[i+1] ? PHASES[i+1].id : null;
  return `<div class="band band-dark" style="padding-top:24px;padding-bottom:24px"><div class="inner">
    <div class="ctlBar"><div class="st">지금 단계<b>${PHASES[i].label}</b></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${i>0 ? '<button class="btn onDark sm" id="back">앞 단계로</button>' : ''}
      ${next ? `<button class="btn sm" id="next" ${busy?'disabled':''}>${label}</button>` : ''}
    </div></div></div></div>`;
}

function teacherBody(){
  const p = state.phase;
  let out = ctlBand();

  if (p === 'lobby'){
    out += `<div class="band band-light"><div class="inner">
      <h2 class="h-lg">들어온 사람</h2>
      <p class="lead">모두 들어오면 질문 쓰기를 시작합니다. 방 번호는 <b>${esc(me.room)}</b>입니다.</p>
      ${students.length
        ? `<div class="chips">${students.map(s=>`<span class="nameChip in">${esc(s.name)}</span>`).join('')}</div>`
        : '<p class="cap" style="margin-top:16px">아직 아무도 없습니다.</p>'}
    </div></div>`;
  }

  if (p === 'write'){
    const d = students.filter(s => s.sent);
    out += `<div class="band band-light"><div class="inner">
      <h2 class="h-lg">질문 쓰는 중</h2>
      <p class="lead">${d.length}명 보냄 · 모두 ${students.length}명</p>
      <div class="chips">${students.map(s =>
        `<span class="nameChip${s.sent?' in':''}">${esc(s.name)}</span>`).join('')}</div>
    </div></div>`;
  }

  if (p === 'fact'){
    if (!board) out += waitBand('모으는 중','');
    else {
      const facts = toArr(board.facts);
      const l = facts.length ? facts.map(f => {
        const off = board.checked && board.checked[f.id];
        return `<div class="fRow${off?' off':''}">
          <button class="fBox" data-f="${f.id}">${off?'✓':''}</button>
          <div class="t">${esc(f.text)}</div><div class="fBy">${esc(f.by)}</div></div>`;
      }).join('') : '<p class="lead">사실 질문이 없습니다.</p>';
      out += `<div class="band band-light"><div class="inner">
        <h2 class="h-lg">사실 질문</h2>
        <p class="lead">함께 답을 찾고, 해결한 질문은 눌러서 지웁니다.</p>
        <div style="margin-top:28px">${l}</div>
        <div class="row"><button class="btn outD sm" id="rebuild">질문 다시 모으기</button></div>
      </div></div>`;
    }
  }

  if (p === 'bid'){
    const sent = students.filter(s => s.bidSent);
    out += `<div class="band band-light"><div class="inner">
      <h2 class="h-lg">입찰 중</h2>
      <p class="lead">${sent.length}명 보냄 · 모두 ${students.length}명</p>
      <div class="chips">${students.map(s =>
        `<span class="nameChip${s.bidSent?' in':''}">${esc(s.name)}</span>`).join('')}</div>
      <div class="hr"></div>
      <h3 class="h-xs">경매에 오른 질문 ${toArr(board&&board.lots).length}개</h3>
      <p class="cap">논쟁 질문과 성찰 질문만 올라갑니다. 필요하면 직접 올릴 수 있습니다.</p>
      <div class="field"><input type="text" id="addq" placeholder="직접 올릴 질문"></div>
      <div class="row" style="margin-top:12px">
        <button class="btn outR sm" id="addd">논쟁으로 올리기</button>
        <button class="btn outR sm" id="addr">성찰로 올리기</button>
      </div>
    </div></div>`;
  }

  if (p === 'result'){
    const rows = results().map((r,i) => {
      const win = i < 3 && r.total > 0;
      return `<div class="rRow${win?' win':''}">
        <div class="rank">${i+1}</div>
        <div class="lotBody">${win?'<span class="soldTag">낙찰</span>':''}
          <p class="lotText">${esc(r.lot.text)}</p>
          <div class="lotMeta"><span class="pillTag">${esc(r.lot.kind)}</span>${esc(r.lot.by)} · ${r.bidders}명이 걸었습니다</div></div>
        <div class="price">${won(r.total)}<span>원</span></div>
      </div>`;
    }).join('');
    out += `<div class="band band-light"><div class="inner">
      <h2 class="h-lg">낙찰 결과</h2>
      <p class="lead">위 세 질문을 다음 시간에 가져갑니다.</p>
      <div style="margin-top:20px">${rows || '<p class="lead">입찰이 없습니다.</p>'}</div>
    </div></div>
    <div class="band band-dark"><div class="inner">
      <h2 class="stateBig" style="font-size:clamp(30px,6vw,48px)">왜 그 질문에 돈을 걸었나요?</h2>
    </div></div>`;
  }

  out += `<div class="band band-soft"><div class="inner">
    <h3 class="h-xs">처음부터 다시</h3>
    <p class="cap">이 방의 모든 질문과 입찰을 지웁니다. 되돌릴 수 없습니다.</p>
    <div class="row"><button class="btn outR sm" id="reset">모두 지우기</button>
    <button class="btn outD sm" id="leave">나가기</button></div>
    ${feedback()}
  </div></div>`;

  return out;
}

function bindTeacher(){
  if ($('next')) $('next').onclick = () => {
    const i = pIdx(state.phase);
    if (PHASES[i+1]) goPhase(PHASES[i+1].id);
  };
  if ($('back')) $('back').onclick = () => {
    const i = pIdx(state.phase);
    if (i > 0) goPhase(PHASES[i-1].id);
  };
  document.querySelectorAll('[data-f]').forEach(el => {
    el.onclick = () => toggleFact(el.dataset.f);
  });
  if ($('rebuild')) $('rebuild').onclick = rebuild;
  if ($('addd')) $('addd').onclick = () => { const v = $('addq'); addLot(v.value,'논쟁'); v.value=''; };
  if ($('addr')) $('addr').onclick = () => { const v = $('addq'); addLot(v.value,'성찰'); v.value=''; };
  if ($('leave')) $('leave').onclick = leave;
  const rz = $('reset');
  if (rz) rz.onclick = () => {
    if (rz.dataset.armed) resetAll();
    else { rz.dataset.armed = '1'; rz.textContent = '한 번 더 누르면 지워집니다'; }
  };
}

const studentFoot = () => `<div class="band band-soft" style="padding-top:20px;padding-bottom:20px">
  <div class="inner"><button class="btn outD sm" id="leaveS">나가기</button>
  <p class="cap" style="margin-top:10px">이름이나 역할을 잘못 골랐을 때 누르세요.</p></div></div>`;

function render(){
  if (!me){ app().innerHTML = viewSetup(); bindSetup(); return; }
  if (me.role === 'teacher'){
    app().innerHTML = hero() + teacherBody();
    bindTeacher();
  } else {
    app().innerHTML = hero() + studentBody() + studentFoot();
    bindStudent();
    if ($('leaveS')) $('leaveS').onclick = leave;
  }
}

/* ══════════ 시작 ══════════ */
(async function boot(){
  const saved = loadMe();
  if (saved && saved.room){
    me = saved;
    bootCheck = (saved.role === 'student');
    try { await connect(me.room); }
    catch(e){ me = null; bootCheck = false; }
  }
  render();
})();
