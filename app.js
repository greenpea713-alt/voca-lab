'use strict';
const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'yumin-gre-split-v1';

/* ---------- 저장: 메모리는 Set, 저장은 배열(JSON) ---------- */
let known = new Set(), wrong = new Set(), hist = [], stamp = 0; // stamp: 마지막으로 기록이 바뀐 시각
function load() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}');
    known = new Set(m.known || []); wrong = new Set(m.wrong || []); hist = m.history || []; stamp = m.stamp || 0;
  } catch {}
}
function snapshot() { return { known: [...known], wrong: [...wrong], history: hist, stamp }; }
function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch {} }
function persist() { stamp = Date.now(); saveLocal(); scheduleCloud(); }

/* ---------- 클라우드 동기화 (Firebase: 할 일 앱과 같은 프로젝트·계정) ---------- */
// 브라우저에 공개되는 웹 설정값이라 비밀번호가 아님. 데이터 보호는 Firestore 보안 규칙(vocab/{uid})이 담당.
const FB_CONFIG = {
  apiKey: 'AIzaSyBt9Bangm-5IqMKnvkwIJtMbpFJVGwAVAM', authDomain: 'todoapp-41f4b.firebaseapp.com', projectId: 'todoapp-41f4b',
  storageBucket: 'todoapp-41f4b.firebasestorage.app', messagingSenderId: '715703015424', appId: '1:715703015424:web:44a5940cf0e49a0517a0e5',
};
const FB_URL = 'https://www.gstatic.com/firebasejs/10.12.2/';
let fb = null, user = null, cloudTimer;
async function fbInit() {
  if (fb) return fb;
  const [A, U, F] = await Promise.all(['app', 'auth', 'firestore'].map(m => import(FB_URL + `firebase-${m}.js`)));
  const app = A.initializeApp(FB_CONFIG);
  fb = { U, F, auth: U.getAuth(app), db: F.getFirestore(app) };
  return fb;
}
const cloudMsg = t => { const e = $('cloud-msg'); if (e) e.textContent = t; };
const myDoc = () => fb.F.doc(fb.db, 'vocab', user.uid);
function scheduleCloud() { if (user) { clearTimeout(cloudTimer); cloudTimer = setTimeout(pushCloud, 800); } }
async function pushCloud() {
  if (!user) return;
  try { await fb.F.setDoc(myDoc(), snapshot()); cloudMsg('✓ 저장됨 ' + new Date().toLocaleTimeString('ko-KR')); }
  catch (e) { cloudMsg('클라우드 저장 실패 (' + (e.code || e.message) + ')'); }
}
// 로그인 시: 시험 기록은 합치고, 외운 단어·오답 목록은 더 최근에 바뀐 쪽을 따름
async function pullCloud() {
  try {
    const snap = await fb.F.getDoc(myDoc());
    if (snap.exists()) {
      const r = snap.data(), seen = new Set();
      hist = [...hist, ...(r.history || [])].filter(x => x && !seen.has(x.at) && seen.add(x.at)).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-100);
      if ((r.stamp || 0) > stamp) { known = new Set(r.known || []); wrong = new Set(r.wrong || []); stamp = r.stamp; }
      saveLocal();
    }
    await pushCloud();
    if (D) { resetCards(); renderHistory(); }
  } catch (e) { cloudMsg('클라우드 불러오기 실패 (' + (e.code || e.message) + ')'); }
}
function renderSync() {
  $('cloud').innerHTML = user
    ? `<p>☁️ <b>${esc(user.email)}</b>로 로그인됨 · 기록이 모든 기기에 자동 저장돼.</p><div class="actions"><button class="btn alt" data-act="logout">로그아웃</button><span class="tiny" id="cloud-msg"></span></div>`
    : `<p class="tiny">로그인하면 기록이 클라우드에 저장돼서 폰·PC 어디서든 이어서 볼 수 있어. (할 일 앱과 같은 계정)</p>
<div class="actions"><input class="field" id="login-email" type="email" placeholder="이메일" autocomplete="username" style="max-width:220px"><input class="field" id="login-pw" type="password" placeholder="비밀번호" autocomplete="current-password" style="max-width:160px"><button class="btn" data-act="login">로그인</button><span class="tiny" id="cloud-msg"></span></div>`;
}
async function login() {
  try { await fbInit(); await fb.U.signInWithEmailAndPassword(fb.auth, $('login-email').value.trim(), $('login-pw').value); }
  catch (e) { cloudMsg('로그인 실패: 이메일·비밀번호를 확인해 줘 (' + (e.code || e.message) + ')'); }
}
async function logout() { if (fb) await fb.U.signOut(fb.auth); }

/* ---------- 데이터 ---------- */
let D;
// 비교용 정규화: 소문자, 악센트·공백·하이픈 제거 (bona fide = bona-fide = bonafide)
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
// 정답 인정: 단어 자체 + words.json의 syn(같은 뜻 그룹 단어·대표 동의어)
function acceptedFor(i) {
  const c = D.cards[i];
  return new Set([c.w, ...(c.syn || [])].map(norm));
}
// 철자 거리(레벤슈타인)
function editDist(a, b) {
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// 한두 글자만 틀렸으면 의도한 단어를 돌려줌 (짧은 단어는 1글자, 긴 단어는 2글자까지)
function typoOf(input, i) {
  const x = norm(input), c = D.cards[i];
  let best = null, bd = 99;
  for (const w of [c.w, ...synInList(i)]) { const d = editDist(x, norm(w)); if (d < bd) { bd = d; best = w; } }
  return bd > 0 && bd <= (norm(best).length <= 5 ? 1 : 2) ? best : null;
}
const synInList = i => (D.cards[i].syn || []).filter(w => D.byWord.has(w.toLowerCase()));

/* ---------- 영→한 채점: 뜻이 비슷하면 정답 ---------- */
// 끝말(하다·한·적인·스러운 등)을 떼고 핵심 말만 남김: 냉소적인 → 냉소, 의심스러운 → 의심
const KO_END = /(스러운|스럽다|스럽게|스레|적이다|적으로|적인|적|해지다|해진|하다|하는|하게|한|히|되다|되는|된|롭다|로운|이다|인|함|의|을|를|은|는|이|가|게|다)$/;
// 원래 말과 끝말 뗀 말 두 가지를 모두 비교 후보로 씀 (부인 ↔ 부인하다)
function stemsKo(s) {
  const x = String(s).replace(/\([^)]*\)/g, '').replace(/~/g, '').replace(/[^가-힣a-z0-9]/gi, '');
  const y = x.replace(KO_END, '');
  return x ? [...new Set([x, y || x])] : [];
}
// 글자 두 개씩 묶어 겹치는 비율 (0~1)
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bg = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) || 0);
  return 2 * hit / (a.length - 1 + b.length - 1);
}
const splitKo = t => String(t).split(/[,;·\/]+/).map(stemsKo).filter(a => a.length);
const glossesOf = i => splitKo(D.cards[i].meaning);
const same = (X, G) => X.some(x => G.includes(x));
function koMatch(X, G) { return X.some(x => G.some(g => koMatch1(x, g))); }
function koMatch1(x, g) {
  if (x === g) return true;
  if (Math.min(x.length, g.length) >= 2 && (x.includes(g) || g.includes(x))) return true;
  return dice(x, g) >= 0.6;
}
// 결과: 'exact'(이 단어 뜻과 일치) · 'near'(비슷한 표현 또는 동의어의 뜻) · null(오답)
function gradeKo(input, i) {
  const parts = splitKo(input);
  if (!parts.length) return null;
  const own = glossesOf(i);
  if (parts.some(x => own.some(g => same(x, g)))) return 'exact';
  if (parts.some(x => own.some(g => koMatch(x, g)))) return 'near';
  const synG = synInList(i).flatMap(w => glossesOf(D.byWord.get(w.toLowerCase())));
  if (parts.some(x => synG.some(g => koMatch(x, g)))) return 'near';
  return null;
}

/* ---------- 탭 ---------- */
function tab(id) {
  document.querySelectorAll('.screen').forEach(e => e.classList.toggle('active', e.id === id));
  scrollTo(0, 0);
  if (id === 'cards') renderCard();
  if (id === 'history') renderHistory();
}

/* ---------- 단어 카드 ---------- */
let indices = [], idx = 0, reveal = false;
function resetCards() {
  const week = +$('week').value, mode = $('card-mode').value;
  indices = [];
  D.cards.forEach((c, i) => {
    if (week && c.week !== week) return;
    if (mode === 'wrong' && !wrong.has(c.w)) return;
    if (mode === 'unknown' && known.has(c.w)) return;
    indices.push(i);
  });
  idx = 0; reveal = false; renderCard();
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function renderCard() {
  if (!D) return;
  if (!indices.length) { $('card-reader').innerHTML = '<div class="panel">이 범위에 표시할 단어가 없어.</div>'; $('card-stat').textContent = ''; $('card-progress').style.width = '0'; return; }
  idx = Math.min(idx, indices.length - 1);
  const c = D.cards[indices[idx]];
  $('card-progress').style.width = Math.round(100 * (idx + 1) / indices.length) + '%';
  $('card-stat').textContent = `${idx + 1} / ${indices.length} · 외운 단어 ${known.size}개 · 오답 ${wrong.size}개`;
  const row = (label, v) => v ? `<p><strong>${label}</strong> ${esc(v)}</p>` : '';
  $('card-reader').innerHTML = `<div class="quiz-main"><span class="chip">WEEK ${c.week}</span><div class="word">${esc(c.w)}</div>
<button class="btn alt" data-act="say">🔊 발음 듣기</button>
${reveal ? `<div class="detail"><p><strong>발음</strong> ${esc(c.pron)} · ${esc(c.pos)}</p>${row('뜻', c.meaning)}${c.ex ? `<p>${esc(c.ex)}</p>` : ''}${c.ko ? `<p class="muted">${esc(c.ko)}</p>` : ''}${row('동의어', (c.syn || []).join(', '))}${row('자주 쓰는 표현', c.combo)}${row('어원', c.etym)}</div>`
 : '<p class="muted">뜻과 예문을 떠올려 봐.</p>'}
<div class="cardnav first"><button class="btn alt" data-act="again">다시 보기</button><button class="btn" data-act="ok">✓ 외웠어요</button></div>
<div class="cardnav"><button class="btn alt" data-act="prev">← 이전</button>${reveal ? '' : '<button class="btn" data-act="reveal">해설 보기</button>'}<button class="btn alt" data-act="next">다음 →</button></div></div>`;
}
function moveCard(n) { idx = (idx + n + indices.length) % indices.length; reveal = false; renderCard(); }
function mark(ok) {
  const w = D.cards[indices[idx]].w;
  if (ok) { known.add(w); wrong.delete(w); } else { wrong.add(w); known.delete(w); }
  persist(); moveCard(1);
}

/* ---------- 검색 ---------- */
let searchTimer;
function searchWords() {
  const q = $('word-search').value.trim().toLowerCase();
  if (!q) { $('word-results').innerHTML = ''; return; }
  const out = [];
  for (let i = 0; i < D.cards.length && out.length < 60; i++) {
    const x = D.cards[i];
    if ((x.w + ' ' + x.meaning + ' ' + x.gloss).toLowerCase().includes(q)) out.push(`<button data-word="${i}"><strong>${esc(x.w)}</strong><small>${esc(x.meaning)}</small></button>`);
  }
  $('word-results').innerHTML = out.join('') || '<span class="muted">검색 결과가 없어.</span>';
}
function openWord(i) {
  $('week').value = '0'; $('card-mode').value = 'all'; resetCards();
  idx = indices.indexOf(i); reveal = true; renderCard(); $('card-reader').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 시험 ---------- */
let quiz = [], qi = 0, correct = 0, answers = [], dir = 'en', lastRec = null;
const DIR_LABEL = { en: '한→영', ko: '영→한' };
function startTest() {
  const week = +$('test-week').value, n = +$('test-count').value;
  const pool = [];
  D.cards.forEach((c, i) => { if (!week || c.week === week) pool.push(i); });
  if (!pool.length) return;
  dir = $('test-dir').value;
  quiz = shuffle(pool).slice(0, n); qi = 0; correct = 0; answers = [];
  renderTest();
}
function renderTest() {
  $('test-reader').innerHTML = `<div class="quiz-main"><div class="tiny">${qi + 1}/${quiz.length}문항 · 현재 정답 ${correct}개</div>
<div class="progress"><div style="width:${Math.round(qi / quiz.length * 100)}%"></div></div>
${dir === 'ko'
  ? `<div class="word">${esc(D.cards[quiz[qi]].w)}</div><div class="tiny">${esc(D.cards[quiz[qi]].pos)} · <button class="btn alt" data-act="sayq">🔊</button></div>
<input class="field" id="answer" placeholder="한국어 뜻을 입력하세요" autocomplete="off" spellcheck="false">`
  : `<h2 style="margin:26px 0">${esc(D.cards[quiz[qi]].meaning)}</h2>
<input class="field" id="answer" placeholder="영어 단어를 입력하세요" autocomplete="off" autocapitalize="off" spellcheck="false">`}
<div class="actions" style="justify-content:center"><button class="btn" data-act="submit">정답 확인 · 다음</button><button class="btn alt" data-act="skip">모름 · 다음</button></div>
<div class="tiny" style="margin-top:16px">답 입력 후 엔터를 누르면 다음 문제로 넘어가.</div></div>`;
  $('answer').focus();
}
function submitTest(skip) {
  const i = quiz[qi], c = D.cards[i];
  const input = skip ? '' : $('answer').value.trim();
  if (dir === 'ko') {
    const g = skip ? null : gradeKo(input, i), ok = !!g;
    const prevWrong = wrong.has(c.w);
    if (ok) correct++; else wrong.add(c.w);
    answers.push({ word: c.w, meaning: c.meaning, input, ok, near: g === 'near', prevWrong });
    qi++;
    if (qi >= quiz.length) return finishTest();
    persist(); return renderTest();
  }
  const parts = input.split(/[,;\/]+/).map(x => x.trim()).filter(Boolean), accept = acceptedFor(i);
  const ok = parts.length > 0 && parts.every(x => accept.has(norm(x)));
  const otherIdx = !ok && parts.length === 1 ? D.byNorm.get(norm(parts[0])) : undefined;
  const other = otherIdx !== undefined && otherIdx !== i ? D.cards[otherIdx].w : null;
  const typo = !ok && !other && parts.length === 1 ? typoOf(parts[0], i) : null;
  const viaSyn = ok && !parts.every(x => norm(x) === norm(c.w));
  if (ok) correct++; else wrong.add(c.w);
  answers.push({ word: c.w, meaning: c.meaning, input, ok, typo, other, viaSyn });
  qi++;
  if (qi >= quiz.length) return finishTest();
  persist(); renderTest();
}
function finishTest() {
  const score = Math.round(correct / quiz.length * 100);
  const rec = { at: new Date().toISOString(), count: quiz.length, correct, score, week: +$('test-week').value, dir, errors: answers.filter(x => !x.ok) };
  hist = [...hist, rec].slice(-100); persist();
  if (dir === 'ko') { lastRec = rec; quiz = []; return renderKoResult(true); }
  const typos = rec.errors.filter(x => x.typo).length, syns = answers.filter(x => x.viaSyn);
  const errRow = x => {
    const i = D.byWord.get(x.word.toLowerCase()), others = synInList(i).slice(0, 4);
    return `<p><b>${esc(x.meaning)}</b><br>입력: ${esc(x.input || '(미입력)')}${x.typo ? ` <span class="tag typo">철자 오류 → ${esc(x.typo)}</span>` : ''}${x.other ? ` <span class="tag other">다른 단어: ${esc(x.other)} = ${esc(D.cards[D.byWord.get(x.other.toLowerCase())].meaning)}</span>` : ''}<br>정답: <b>${esc(x.word)}</b>${others.length ? ` <span class="muted">· 동의어도 정답: ${others.map(esc).join(', ')}</span>` : ''}</p>`;
  };
  $('test-reader').innerHTML = `<div class="quiz-main"><div class="eyebrow">TEST COMPLETE</div><h1>${score}점</h1><p>${quiz.length}문항 중 ${correct}개 정답${typos ? ` · 철자만 틀린 문제 ${typos}개` : ''}</p>
${syns.length ? `<p class="tiny">동의어로 맞힌 문제: ${syns.map(x => `${esc(x.input)} (= ${esc(x.word)})`).join(', ')}</p>` : ''}
<div class="errors">${rec.errors.map(errRow).join('')}</div>
<button class="btn" data-act="start">다시 시험 보기</button></div>`;
  quiz = [];
  $('test-reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 영→한 결과: 자동 채점이 놓친 답은 '맞은 걸로'로 바로잡을 수 있음
function renderKoResult(scroll) {
  const rec = lastRec, near = answers.filter(x => x.ok && x.near);
  const errRow = (x, k) => `<p><b>${esc(x.word)}</b><br>입력: ${esc(x.input || '(미입력)')}${x.input ? ` <button class="btn alt tag" data-act="override" data-i="${k}">맞은 걸로</button>` : ''}<br>정답: <b>${esc(x.meaning)}</b></p>`;
  $('test-reader').innerHTML = `<div class="quiz-main"><div class="eyebrow">TEST COMPLETE · 영→한</div><h1>${rec.score}점</h1><p>${rec.count}문항 중 ${rec.correct}개 정답</p>
${near.length ? `<p class="tiny">비슷한 표현으로 맞힌 문제: ${near.map(x => `${esc(x.word)} → ${esc(x.input)} (사전 뜻: ${esc(x.meaning)})`).join(' · ')}</p>` : ''}
${rec.errors.length ? '<p class="tiny">뜻은 맞는데 표현이 달라 오답 처리됐다면 \'맞은 걸로\'를 누르면 점수에 반영돼.</p>' : ''}
<div class="errors">${answers.map((x, k) => x.ok ? '' : errRow(x, k)).join('')}</div>
<button class="btn" data-act="start">다시 시험 보기</button></div>`;
  if (scroll) $('test-reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function overrideKo(k) {
  const x = answers[k];
  if (!x || x.ok || !lastRec) return;
  x.ok = true; x.near = true;
  if (!x.prevWrong) wrong.delete(x.word);
  lastRec.correct++; lastRec.score = Math.round(lastRec.correct / lastRec.count * 100);
  lastRec.errors = answers.filter(a => !a.ok);
  persist(); renderKoResult(false);
}

/* ---------- 기록 ---------- */
function renderHistory() {
  const h = [...hist].reverse();
  $('history-reader').innerHTML = `<div class="statrow"><span>암기 표시 ${known.size}개</span><span>오답 ${wrong.size}개</span><span>완료 시험 ${h.length}회</span></div>
<div class="panel white" style="margin-top:20px"><h3>점수 추이 (최근 20회)</h3><div class="chart">${hist.slice(-20).map(r => `<div title="${r.score}점" style="height:${Math.max(2, r.score)}%"></div>`).join('')}</div></div>
${h.map(r => `<div class="panel" style="margin-top:11px"><strong>${new Date(r.at).toLocaleString('ko-KR')} · ${r.score}점</strong><div class="tiny">${DIR_LABEL[r.dir || 'en']} · ${r.count}문항 · 정답 ${r.correct}개 · ${r.week ? r.week + '주차' : '전체 범위'}</div></div>`).join('') || '<p class="muted">아직 시험 기록이 없어.</p>'}`;
}

/* ---------- 백업 내보내기/불러오기 (기기 간 이동용) ---------- */
function exportBackup() {
  const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `gre-vocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}
async function importBackup(file) {
  try {
    const r = JSON.parse(await file.text());
    (r.known || []).forEach(w => known.add(w));
    (r.wrong || []).forEach(w => wrong.add(w));
    const seen = new Set();
    hist = [...hist, ...(r.history || [])].filter(x => x && !seen.has(x.at) && seen.add(x.at)).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-100);
    persist(); resetCards(); renderHistory();
    $('backup-msg').textContent = '✓ 불러와서 합쳤어';
  } catch { $('backup-msg').textContent = '불러오기 실패: 올바른 백업 파일이 아니야'; }
}

/* ---------- 발음 ---------- */
function say(t) {
  try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; u.rate = .9; speechSynthesis.speak(u); } catch {}
}

/* ---------- 이벤트 (한 곳에서 위임 처리) ---------- */
const ACTIONS = {
  say: () => say(D.cards[indices[idx]].w), reveal: () => { reveal = true; renderCard(); },
  prev: () => moveCard(-1), next: () => moveCard(1), ok: () => mark(true), again: () => mark(false),
  shuffle: () => { shuffle(indices); idx = 0; reveal = false; renderCard(); },
  login, logout: () => logout(),
  start: startTest, submit: () => submitTest(false), skip: () => submitTest(true),
  sayq: () => say(D.cards[quiz[qi]].w), override: b => overrideKo(+b.dataset.i),
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tab],[data-act],[data-word]');
  if (!b || !D) return;
  if (b.dataset.tab) tab(b.dataset.tab);
  else if (b.dataset.act) ACTIONS[b.dataset.act]?.(b);
  else openWord(+b.dataset.word);
});
// 한글 입력 중(조합 중) 엔터는 무시: 크롬에서 엔터가 두 번 처리돼 다음 문제가 빈칸으로 넘어가는 것 방지
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'login-pw') login(); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'answer' && !e.isComposing && e.keyCode !== 229) submitTest(false); });

/* ---------- 시작 ---------- */
(async function init() {
  load();
  $('card-reader').innerHTML = '<div class="panel">단어 불러오는 중…</div>';
  try { D = await (await fetch('words.json')).json(); }
  catch { $('card-reader').innerHTML = '<div class="panel">단어 파일(words.json)을 불러오지 못했어. 새로고침해 봐.</div>'; return; }
  D.byWord = new Map(D.cards.map((c, i) => [c.w.toLowerCase(), i]));
  D.byNorm = new Map(D.cards.map((c, i) => [norm(c.w), i]));
  const opts = '<option value="0">전체 13주</option>' + D.weeks.map((w, i) => `<option value="${i + 1}">${i + 1}주 · ${esc(w)}</option>`).join('');
  $('week').innerHTML = $('test-week').innerHTML = opts;
  $('week').value = $('test-week').value = '1';
  $('week').onchange = $('card-mode').onchange = resetCards;
  $('word-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchWords, 120); };
  $('export').onclick = exportBackup;
  $('import').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  resetCards(); renderHistory();
  renderSync();
  try { await fbInit(); fb.U.onAuthStateChanged(fb.auth, u => { user = u; renderSync(); if (u) pullCloud(); }); }
  catch { cloudMsg('클라우드 연결 실패 · 이 기기에만 저장 중'); }
})();
