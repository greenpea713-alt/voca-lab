'use strict';
const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'yumin-gre-split-v1';

/* ---------- 저장: 메모리는 Set, 저장은 배열(JSON) ---------- */
let known = new Set(), wrong = new Set(), hist = [];
function load() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || '{}');
    known = new Set(m.known || []); wrong = new Set(m.wrong || []); hist = m.history || [];
  } catch {}
}
function snapshot() { return { known: [...known], wrong: [...wrong], history: hist }; }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch {} }

/* ---------- 데이터 ---------- */
let D, KEYS; // KEYS[i] = 동의어 판정용 의미 키 (미리 계산)
const semanticKey = s => String(s).split(/[;,\/·]/)[0].replace(/[()\[\]0-9]/g, '').replace(/\s+/g, '').trim();
let synIndex; // "주차|의미키" → 영단어 목록

function buildIndex() {
  KEYS = D.cards.map(c => semanticKey(c.meaning));
  synIndex = new Map();
  D.cards.forEach((c, i) => {
    if (KEYS[i].length < 2) return;
    const k = c.week + '|' + KEYS[i];
    (synIndex.get(k) || synIndex.set(k, []).get(k)).push(c.w.toLowerCase());
  });
}
function acceptedFor(i) {
  const c = D.cards[i], list = synIndex.get(c.week + '|' + KEYS[i]) || [];
  return new Set([...list, c.w.toLowerCase()]);
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
${reveal ? `<div class="detail"><p><strong>발음</strong> ${esc(c.pron)} · ${esc(c.pos)}</p>${row('뜻', c.meaning)}${c.ex ? `<p>${esc(c.ex)}</p>` : ''}${c.ko ? `<p class="muted">${esc(c.ko)}</p>` : ''}${row('자주 쓰는 표현', c.combo)}${row('어원', c.etym)}</div>`
 : '<p class="muted">뜻과 예문을 떠올려 봐.</p><button class="btn" data-act="reveal">해설 보기</button>'}
<div class="actions" style="justify-content:center;margin-top:18px">
<button class="btn alt" data-act="prev">← 이전</button><button class="btn alt" data-act="again">다시 보기</button>
<button class="btn" data-act="ok">✓ 외웠어요</button><button class="btn alt" data-act="next">다음 →</button></div></div>`;
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
let quiz = [], qi = 0, correct = 0, answers = [];
function startTest() {
  const week = +$('test-week').value, n = +$('test-count').value;
  const pool = [];
  D.cards.forEach((c, i) => { if (!week || c.week === week) pool.push(i); });
  if (!pool.length) return;
  quiz = shuffle(pool).slice(0, n); qi = 0; correct = 0; answers = [];
  renderTest();
}
function renderTest() {
  $('test-reader').innerHTML = `<div class="quiz-main"><div class="tiny">${qi + 1}/${quiz.length}문항 · 현재 정답 ${correct}개</div>
<div class="progress"><div style="width:${Math.round(qi / quiz.length * 100)}%"></div></div>
<h2 style="margin:26px 0">${esc(D.cards[quiz[qi]].meaning)}</h2>
<input class="field" id="answer" placeholder="영어 단어를 입력하세요" autocomplete="off" autocapitalize="off" spellcheck="false">
<div class="actions" style="justify-content:center"><button class="btn" data-act="submit">정답 확인 · 다음</button><button class="btn alt" data-act="skip">모름 · 다음</button></div>
<div class="tiny" style="margin-top:16px">답 입력 후 엔터를 누르면 다음 문제로 넘어가.</div></div>`;
  $('answer').focus();
}
function submitTest(skip) {
  const i = quiz[qi], c = D.cards[i];
  const input = skip ? '' : $('answer').value.trim().toLowerCase();
  const parts = input.split(/[,;\/]+/).map(x => x.trim()).filter(Boolean), accept = acceptedFor(i);
  const ok = parts.length > 0 && parts.every(x => accept.has(x));
  if (ok) correct++; else wrong.add(c.w);
  answers.push({ word: c.w, meaning: c.meaning, input, ok });
  qi++;
  if (qi >= quiz.length) return finishTest();
  persist(); renderTest();
}
function finishTest() {
  const score = Math.round(correct / quiz.length * 100);
  const rec = { at: new Date().toISOString(), count: quiz.length, correct, score, week: +$('test-week').value, errors: answers.filter(x => !x.ok) };
  hist = [...hist, rec].slice(-100); persist();
  $('test-reader').innerHTML = `<div class="quiz-main"><div class="eyebrow">TEST COMPLETE</div><h1>${score}점</h1><p>${quiz.length}문항 중 ${correct}개 정답</p>
<div class="errors">${rec.errors.map(x => `<p><b>${esc(x.meaning)}</b><br>입력: ${esc(x.input || '(미입력)')} · 정답 예: ${esc(x.word)}</p>`).join('')}</div>
<button class="btn" data-act="start">다시 시험 보기</button></div>`;
  quiz = [];
}

/* ---------- 기록 ---------- */
function renderHistory() {
  const h = [...hist].reverse();
  $('history-reader').innerHTML = `<div class="statrow"><span>암기 표시 ${known.size}개</span><span>오답 ${wrong.size}개</span><span>완료 시험 ${h.length}회</span></div>
<div class="panel white" style="margin-top:20px"><h3>점수 추이 (최근 20회)</h3><div class="chart">${hist.slice(-20).map(r => `<div title="${r.score}점" style="height:${Math.max(2, r.score)}%"></div>`).join('')}</div></div>
${h.map(r => `<div class="panel" style="margin-top:11px"><strong>${new Date(r.at).toLocaleString('ko-KR')} · ${r.score}점</strong><div class="tiny">${r.count}문항 · 정답 ${r.correct}개 · ${r.week ? r.week + '주차' : '전체 범위'}</div></div>`).join('') || '<p class="muted">아직 시험 기록이 없어.</p>'}`;
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
  start: startTest, submit: () => submitTest(false), skip: () => submitTest(true),
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tab],[data-act],[data-word]');
  if (!b || !D) return;
  if (b.dataset.tab) tab(b.dataset.tab);
  else if (b.dataset.act) ACTIONS[b.dataset.act]?.();
  else openWord(+b.dataset.word);
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'answer') submitTest(false); });

/* ---------- 시작 ---------- */
(async function init() {
  load();
  $('card-reader').innerHTML = '<div class="panel">단어 불러오는 중…</div>';
  try { D = await (await fetch('words.json')).json(); }
  catch { $('card-reader').innerHTML = '<div class="panel">단어 파일(words.json)을 불러오지 못했어. 새로고침해 봐.</div>'; return; }
  buildIndex();
  const opts = '<option value="0">전체 13주</option>' + D.weeks.map((w, i) => `<option value="${i + 1}">${i + 1}주 · ${esc(w)}</option>`).join('');
  $('week').innerHTML = $('test-week').innerHTML = opts;
  $('week').value = $('test-week').value = '1';
  $('week').onchange = $('card-mode').onchange = resetCards;
  $('word-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchWords, 120); };
  $('export').onclick = exportBackup;
  $('import').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  resetCards(); renderHistory();
})();
