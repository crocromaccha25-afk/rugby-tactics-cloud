/* js/app_cloud.js - Firebase v10 (CDNモジュール) 版 */

// ===== Imports =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, where, getDocs,
  orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ===== Firebase 初期化 =====
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ====== DOM refs ======
const authView     = document.getElementById('authView');
const appView      = document.getElementById('appView');
const userBadge    = document.getElementById('userBadge');
const signOutBtn   = document.getElementById('signOutBtn');

const emailEl      = document.getElementById('email');
const passwordEl   = document.getElementById('password');
const signInBtn    = document.getElementById('signInBtn');
const signUpBtn    = document.getElementById('signUpBtn');

const joinCodeEl   = document.getElementById('joinCode');
const joinTeamBtn  = document.getElementById('joinTeamBtn');
const newTeamNameEl= document.getElementById('newTeamName');
const createTeamBtn= document.getElementById('createTeamBtn');
const teamInfoAuth = document.getElementById('teamInfo');
const teamInfoApp  = document.getElementById('teamInfoApp');

const playListEl   = document.getElementById('playList');
const titleEl      = document.getElementById('playTitle');
const notesEl      = document.getElementById('notes');
const unitEl       = document.getElementById('unitSelect');   // 15人 / 12人
const groupEl      = document.getElementById('groupSelect');  // FW / BK

const newBtn       = document.getElementById('newPlayBtn');
const saveBtn      = document.getElementById('saveBtn');
const duplicateBtn = document.getElementById('duplicateBtn');
const deleteBtn    = document.getElementById('deleteBtn');
const exportBtn    = document.getElementById('exportBtn');
const importFile   = document.getElementById('importFile');
const whoEl       = document.getElementById('whoSelect');
const opponentEl  = document.getElementById('opponentInput');
const appHeader   = document.getElementById('appHeader');
const playListAlly = document.getElementById('playListALLY'); // ← HTMLに合わせる
const oppBucketsEl = document.getElementById('oppBuckets');   // ← 相手側の入れ物

whoEl?.addEventListener('change', ()=>{
  const isOpp = (whoEl.value === 'OPP');
  if (opponentEl){
    opponentEl.disabled = !isOpp;
    if (!isOpp) opponentEl.value = '';
  }
});

unitEl?.addEventListener('change', () => {
  const n = Number(unitEl.value) || 15;   // "15" or "12"
  window.BoardAPI?.reset(n);             // 盤面＆ベンチ人数を再生成
});

// 役割（全員 / FW / BK）セレクトをボードの表示に反映
groupEl?.addEventListener('change', () => {
  const v = (groupEl.value || 'ALL'); // 'ALL' | 'FW' | 'BK'
  window.BoardAPI?.setView(v);
});

// ===== Team セットアップ用モーダル =====
function openTeamSetupModal() {
  if (document.getElementById('teamSetupModal')) return; // 既にあれば何もしない
  const el = document.createElement('div');
  el.id = 'teamSetupModal';
  el.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.5);
    display:flex; align-items:center; justify-content:center; z-index:9999;
  `;
  el.innerHTML = `
    <div style="background:#1f2937; color:#fff; width:min(560px,90vw); padding:20px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.35)">
      <h2 style="margin:0 0 8px; font-size:20px;">チームをセットアップ</h2>
      <p style="margin:0 0 12px; opacity:.8;">新規登録ありがとうございます。チームに参加するか、新しくチームを作成してください。</p>

      <div style="display:grid; gap:12px;">
        <div style="background:#111827; padding:12px; border-radius:8px;">
          <div style="font-weight:600; margin-bottom:8px;">招待コードで参加</div>
          <div style="display:flex; gap:8px;">
            <input id="modalJoinCode" placeholder="招待コード" style="flex:1; padding:10px; border-radius:8px; border:1px solid #374151; background:#0b1220; color:#fff;">
            <button id="modalJoinBtn" class="btn">参加</button>
          </div>
        </div>

        <div style="background:#111827; padding:12px; border-radius:8px;">
          <div style="font-weight:600; margin-bottom:8px;">新しいチームを作成</div>
          <div style="display:flex; gap:8px;">
            <input id="modalTeamName" placeholder="チーム名" style="flex:1; padding:10px; border-radius:8px; border:1px solid #374151; background:#0b1220; color:#fff;">
            <button id="modalCreateBtn" class="btn">作成</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  // 既存の join/create ロジックをそのまま呼ぶ
  el.querySelector('#modalJoinBtn').addEventListener('click', safeClick(async ()=>{
    const code = (el.querySelector('#modalJoinCode').value || '').trim();
    if (!code) throw new Error('招待コードを入力してください');
    // 招待コード検索
    const qy = query(collection(db, 'teams'), where('joinCode', '==', code));
    const qs = await getDocs(qy);
    if (qs.empty) throw new Error('招待コードが見つかりません');
    const docSnap = qs.docs[0];
    currentTeam = { id: docSnap.id, ...docSnap.data() };
    await updateDoc(doc(db, 'profiles', currentUser.uid), { teamId: currentTeam.id });

    setTeamInfo(`チーム：${currentTeam.name} 招待コード：${currentTeam.joinCode}`);
    subscribePlays(currentTeam.id);
    const joinCodeBadge = document.getElementById('joinCodeBadge');
    if (joinCodeBadge) joinCodeBadge.textContent = `招待: ${currentTeam.joinCode}`;
    closeTeamSetupModal();
    alert('参加しました！');
  }));

  el.querySelector('#modalCreateBtn').addEventListener('click', safeClick(async ()=>{
    const name = (el.querySelector('#modalTeamName').value || '').trim();
    if (!name) throw new Error('チーム名を入力してください');
    const code = name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
    const ref = await addDoc(collection(db,'teams'), {
      name, joinCode: code, owner: currentUser.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    currentTeam = { id: ref.id, name, joinCode: code };
    await updateDoc(doc(db,'profiles', currentUser.uid), { teamId: currentTeam.id });

    setTeamInfo(`チーム：${currentTeam.name} 招待コード：${currentTeam.joinCode}`);
    subscribePlays(currentTeam.id);
    const joinCodeBadge = document.getElementById('joinCodeBadge');
    if (joinCodeBadge) joinCodeBadge.textContent = `招待: ${currentTeam.joinCode}`;
    closeTeamSetupModal();
    alert('チームを作成しました');
  }));
}

function closeTeamSetupModal(){
  document.getElementById('teamSetupModal')?.remove();
}

// 「初期配置に戻す」ボタン：現在の人数のまま初期化
document.getElementById('resetPositions')?.addEventListener('click', () => {
  const u = Number(unitEl?.value) || 15;
  window.BoardAPI?.reset(u);
});

// 初期状態
if (whoEl) whoEl.dispatchEvent(new Event('change'));

const filterWhoEl      = document.getElementById('filterWho');
const filterOppEl      = document.getElementById('filterOpponent');
const playsGroupedEl   = document.getElementById('playsGrouped');
const playsCountEl     = document.getElementById('playsCount');

// 入力で即反映（軽いデバウンス付き）
const debounce = (fn, ms=200) => {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
};
filterWhoEl?.addEventListener('change', () => renderList());
filterOppEl?.addEventListener('input', debounce(() => renderList(), 200));

// ====== 状態 ======
let currentUser   = null;    // Firebase user
let currentTeam   = null;    // { id, name, joinCode }
let currentId     = null;    // 選択中の play ドキュメントID
let plays         = [];      // 一覧（{id, ...data}）
let unsubscribePlays = null; // onSnapshot解除用

// ===== Helpers =====
function safeClick(handler){
  return async (e)=>{
    e?.preventDefault?.();
    try { await handler(); }
    catch(err){ alert(`エラー: ${err.message}`); console.error(err); }
  };
}

function normalizeUnit(u){
  if (u == null) return '15';
  if (typeof u === 'number') return String(u);
  const s = String(u);
  if (s.includes('12')) return '12';
  return '15';
}

function setTeamInfo(text){
  if (teamInfoAuth) teamInfoAuth.textContent = text ?? '';
  if (teamInfoApp)  teamInfoApp.textContent  = text ?? '';
}

function showAuthView(){
  authView.style.display = 'block';
  appView.style.display  = 'none';
  userBadge.textContent  = '';
  signOutBtn.style.display = 'none';
  if (appHeader) appHeader.style.display = 'none';
  document.getElementById('playsDock').style.display = 'none'; // プレードック非表示
  window.BoardAPI?.setView(groupEl?.value || 'ALL');
}


function showAppView(user){
  authView.style.display = 'none';
  appView.style.display  = 'grid'; // blockでもOK
  userBadge.textContent  = user?.email ?? '';
  signOutBtn.style.display = 'inline-block';
  if (appHeader) appHeader.style.display = '';
  document.getElementById('playsDock').style.display = ''; // プレードック再表示
  window.BoardAPI?.setView(groupEl?.value || 'ALL');
}

function unitLabel(u){
  const s = String(u ?? '');
  return /^\d+$/.test(s) ? `${s}人` : (s || '15人');
}

// ===== 認証ハンドラ =====
signInBtn?.addEventListener('click', safeClick(async ()=>{
  await signInWithEmailAndPassword(auth, emailEl.value, passwordEl.value);
  // onAuthStateChanged が後続をやる
}));

signUpBtn?.addEventListener('click', safeClick(async ()=>{
  await createUserWithEmailAndPassword(auth, emailEl.value, passwordEl.value);
  // ここで即モーダルを開いてOK（onAuthStateChangedでも安全に重複防止している）
  openTeamSetupModal();
}));

signOutBtn?.addEventListener('click', safeClick(async ()=>{
  await signOut(auth);
  unsubscribePlays?.(); unsubscribePlays = null;
  currentTeam = null; currentId = null; plays = [];
  playListEl.innerHTML = ''; titleEl.value=''; notesEl.value='';
}));

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;

  if (!user) {
    userBadge.textContent = '';
    if (signOutBtn) signOutBtn.style.display = 'none';
    showAuthView();
    return;
  }

  // ログイン可視化
  userBadge.textContent = user.email ?? '(no email)';
  if (signOutBtn) signOutBtn.style.display = 'inline-block';

  // プロファイル準備
  const profRef  = doc(db, 'profiles', user.uid);
  const profSnap = await getDoc(profRef);
  if (!profSnap.exists()) {
    await setDoc(profRef, { teamId: null, createdAt: serverTimestamp() });
  }
  const prof = (await getDoc(profRef)).data();

  // 画面表示
  showAppView(user);

  if (prof.teamId) {
    // 所属あり
    currentTeam = await getTeam(prof.teamId);
    setTeamInfo(`チーム：${currentTeam.name} 招待コード：${currentTeam.joinCode}`);
    subscribePlays(currentTeam.id);

    // ここで招待コードバッジを更新
    const joinCodeBadge = document.getElementById('joinCodeBadge');
    if (joinCodeBadge) joinCodeBadge.textContent = `招待: ${currentTeam.joinCode}`;
  } else {

    // 未所属
    currentTeam = null;
    setTeamInfo('チーム未所属（作成 or 招待コードで参加）');

    // バッジは空に
    const joinCodeBadge = document.getElementById('joinCodeBadge');
    if (joinCodeBadge) joinCodeBadge.textContent = '';

    // 初回はブロッキングで案内
    openTeamSetupModal();

    if (appHeader) appHeader.style.display = '';
    document.getElementById('playsDock').style.display = '';
    window.BoardAPI?.setView(groupEl?.value || 'ALL');  // ←任意
  }
});


// ===== Team 操作 =====
async function getTeam(teamId){
  const t = await getDoc(doc(db, 'teams', teamId));
  if (!t.exists()) return null;
  return { id: t.id, ...t.data() };
}

joinTeamBtn?.addEventListener('click', safeClick(async () => {
  if (!currentUser) throw new Error('ログインが必要です');
  const code = (joinCodeEl.value || '').trim();
  if (!code) throw new Error('招待コードを入力してください');

  // 招待コードで teams を検索
  const q = query(collection(db, 'teams'), where('joinCode', '==', code));
  const qs = await getDocs(q);
  if (qs.empty) throw new Error('招待コードが見つかりません');

  const docSnap = qs.docs[0];
  currentTeam = { id: docSnap.id, ...docSnap.data() };

  // プロファイルに teamId を保存
  await updateDoc(doc(db, 'profiles', currentUser.uid), { teamId: currentTeam.id });

  // UI 更新と購読開始
  setTeamInfo(`チーム：${currentTeam.name} 招待コード：${currentTeam.joinCode}`);
  subscribePlays(currentTeam.id);

  const joinCodeBadge = document.getElementById('joinCodeBadge');
  if (joinCodeBadge) joinCodeBadge.textContent = `招待: ${currentTeam.joinCode}`;
  
  alert('参加しました！');
}));

createTeamBtn?.addEventListener('click', safeClick(async () => {
  if (!currentUser) throw new Error('ログインが必要です');
  const name = (newTeamNameEl.value || '').trim();
  if (!name) throw new Error('チーム名を入力してください');

  // 招待コード：簡易生成（小文字＋ランダム）
  const code = name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);

  // teams コレクションに作成
  const ref = await addDoc(collection(db, 'teams'), {
    name,
    joinCode: code,
    owner: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  currentTeam = { id: ref.id, name, joinCode: code };

  // プロファイルに teamId を保存
  await updateDoc(doc(db, 'profiles', currentUser.uid), { teamId: currentTeam.id });

  // UI 更新と購読開始
  setTeamInfo(`チーム：${currentTeam.name} 招待コード：${currentTeam.joinCode}`);
  subscribePlays(currentTeam.id);

  const joinCodeBadge = document.getElementById('joinCodeBadge');
  if (joinCodeBadge) joinCodeBadge.textContent = `招待: ${currentTeam.joinCode}`;

  alert('チームを作成しました');
}));
// ===== 一覧購読／描画 =====
function subscribePlays(teamId){
  if (unsubscribePlays){ unsubscribePlays(); unsubscribePlays=null; }
  plays = []; playListEl.innerHTML = '';
  if (!teamId) return;

  const q = query(
    collection(db,'teams',teamId,'plays'),
    orderBy('updatedAt','desc')
  );
unsubscribePlays = onSnapshot(q, (snap) => {
  plays = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderList();
  renderSideLists();

  // すでに選択中があればそれを維持、無ければ最新を選択
  if (currentId) {
    const exist = plays.some(p => p.id === currentId);
    if (exist) {
      selectPlay(currentId);
    } else if (plays[0]) {
      selectPlay(plays[0].id);
    }
  } else if (plays[0]) {
    selectPlay(plays[0].id);
  }
}, (err) => console.error('subscribe error', err));
}

function badge(text){ return `<span class="badge">${text}</span>`; }

function liHtml(p, isAlly){
  const title = (p.title || '').trim() || '（無題）';
  const unit  = p.unit || '15';
  const when  = p.updatedAt?.toDate ? p.updatedAt.toDate() : new Date();
  return `
    <div class="title">${title}</div>
    <div class="badges">
      ${badge(p.group || 'FW')}
      ${badge(/^\d+$/.test(unit) ? `${unit}人` : unit)}
      ${!isAlly ? badge(p.opponent || '相手'):''}
    </div>
    <div class="muted" title="${when.toLocaleString()}">${when.toLocaleDateString()}</div>
  `;
}

function renderSideLists(){
  if (!playListAlly || !oppBucketsEl) return;

  // いったん空に
  playListAlly.innerHTML = '';
  oppBucketsEl.innerHTML = '';

  // 自チーム
  const ally = plays
    .filter(p => (p.who || 'ALLY') === 'ALLY')
    .sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));

  ally.forEach(p=>{
    const li = document.createElement('li');
    li.className = 'play-item' + (p.id===currentId ? ' active':'');
    li.dataset.id = p.id;
    li.innerHTML = liHtml(p, true);
    li.addEventListener('click', ()=> selectPlay(p.id));
    playListAlly.appendChild(li);
  });

  // 相手側：相手名でバケツ分け
  const opp = plays
    .filter(p => (p.who || 'ALLY') === 'OPP')
    .sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));

  const map = new Map(); // opponent -> [plays]
  opp.forEach(p=>{
    const key = (p.opponent || '（相手名なし）');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  });

  // opponentごとに見出しとULを生成
  [...map.keys()].sort((a,b)=> a.localeCompare(b)).forEach(name=>{
    const section = document.createElement('section');
    const h4 = document.createElement('h4');
    h4.textContent = name;
    const ul = document.createElement('ul');
    ul.className = 'list';

    map.get(name).forEach(p=>{
      const li = document.createElement('li');
      li.className = 'play-item' + (p.id===currentId ? ' active':'');
      li.dataset.id = p.id;
      li.innerHTML = liHtml(p, false);
      li.addEventListener('click', ()=> selectPlay(p.id));
      ul.appendChild(li);
    });

    section.appendChild(h4);
    section.appendChild(ul);
    oppBucketsEl.appendChild(section);
  });
}

function renderList(){
  if (!playsGroupedEl) return;

  // === ① フィルタ適用 ===
  const whoFilter = (filterWhoEl?.value || 'ALL');
  const oppFilter = (filterOppEl?.value || '').trim();

  let filtered = plays.slice();
  if (whoFilter !== 'ALL') {
    filtered = filtered.filter(p => (p.who || 'ALLY') === whoFilter);
  }
  if (oppFilter) {
    filtered = filtered.filter(p => (p.opponent || '').toLowerCase().includes(oppFilter.toLowerCase()));
  }

  // === ② グループ化 ===
  // key = 'ALLY' or `OPP::<opponent>`
  const groups = new Map();
  for (const p of filtered){
    const who = p.who || 'ALLY';
    const key = (who === 'ALLY') ? 'ALLY' : `OPP::${p.opponent || '（相手名なし）'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  // 表示用に並び替え（ALLYを先頭→OPP各チームを名前順）
  const keys = Array.from(groups.keys()).sort((a,b)=>{
    if (a==='ALLY') return -1;
    if (b==='ALLY') return 1;
    // OPP::name で比較
    return a.localeCompare(b);
  });

  // === ③ DOM構築 ===
  playsGroupedEl.innerHTML = '';
  let total = 0;

  for (const key of keys){
    const items = groups.get(key).sort((a,b)=>{
      const ta = (a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(a.updatedAt || 0)).getTime();
      const tb = (b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(b.updatedAt || 0)).getTime();
      return tb - ta; // 新しい順
    });
    total += items.length;

    const group = document.createElement('div');
    group.className = 'group';
    const isAlly = (key==='ALLY');
    const headTitle = isAlly ? '自チーム' : `相手：${key.split('::')[1]}`;

    group.innerHTML = `
      <div class="group-head">
        <h3>${headTitle}</h3>
        <div class="count">${items.length}</div>
      </div>
      <div class="group-body"></div>
    `;
    const body = group.querySelector('.group-body');

    // 各アイテム
    items.forEach(p=>{
      const li = document.createElement('div');
      li.className = 'play-item' + (p.id===currentId ? ' active':'');
      li.dataset.id = p.id;

      const title = (p.title || '').trim() || '（無題）';
      const unit  = p.unit  || '15人';
      const groupTxt = p.group || 'FW';
      const when  = p.updatedAt?.toDate ? p.updatedAt.toDate() : new Date();

      li.innerHTML = `
        <div class="title">${title}</div>
        <div class="badges">
          ${badge(groupTxt)}
          ${badge(unitLabel(unit))}
          ${!isAlly ? badge('OPP'):''}
        </div>
        <div class="muted" title="${when.toLocaleString()}">${when.toLocaleDateString()}</div>
      `;
      li.addEventListener('click', ()=> selectPlay(p.id));
      body.appendChild(li);
    });

    // クリックで折りたたみ
    group.querySelector('.group-head').addEventListener('click', ()=>{
      group.classList.toggle('collapsed');
    });

    playsGroupedEl.appendChild(group);
  }

  // 件数
  if (playsCountEl){
    playsCountEl.textContent = `表示：${total}件（全 ${plays.length}件）`;
  }

  // フィルタUIのON/OFF：who=ALLYの時は相手名絞り込みを無効化
  if (filterOppEl){
    const isOpp = (filterWhoEl?.value === 'OPP');
    filterOppEl.disabled = !isOpp;
    if (!isOpp) filterOppEl.value = '';
  }
  renderSideLists();
 }

function selectPlay(id){
  const p = plays.find(x=>x.id===id);
  if (!p) return;

  currentId = id;
  titleEl.value = p.title || '';
  notesEl.value = p.notes || '';
  unitEl.value  = normalizeUnit(p.unit);
  groupEl.value = p.group || 'FW';
  window.BoardAPI?.setView(groupEl.value);   // ←これを追加

  if (whoEl) whoEl.value = (p.who || 'ALLY');
  if (opponentEl) opponentEl.value = (p.opponent || '');

  if (p.boardState){
    window.BoardAPI?.setState(p.boardState);
  } else {
    // ボード状態が無い場合は「人数に合わせて」初期配置
    window.BoardAPI?.reset(Number(unitEl?.value) || 15);
  }

  renderList(); // 選択反映（ハイライト更新）
}

// ===== Plays CRUD =====
newBtn?.addEventListener('click', safeClick(async ()=> {
  if (!currentTeam) throw new Error('チーム未選択');
  const ref = await addDoc(collection(db,'teams',currentTeam.id,'plays'), {
    title: '新しいプレー',
    notes: '',
    unit:  normalizeUnit(unitEl.value),
    group: groupEl.value || 'FW',
    boardState: window.BoardAPI?.getState() ?? {},
    who: (whoEl?.value || 'ALLY'),                         // ★追加
    opponent: (opponentEl?.value || '').trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ownerUid: currentUser?.uid || null
  });

  currentId = ref.id;
  titleEl.value = '';
  notesEl.value = '';
  document.getElementById('resetPositions')?.click();

  // ← これを追加して！
  selectPlay(ref.id);

  alert('新規プレーを作成しました');
}));

saveBtn?.addEventListener('click', safeClick(async ()=>{
  if (!currentTeam || !currentId) return;
  const ref = doc(db,'teams',currentTeam.id,'plays',currentId);
  await updateDoc(ref, {
    title: (titleEl.value || '').trim() || '（無題）',
    notes: notesEl.value || '',
    unit:  normalizeUnit(unitEl.value),
    group: groupEl.value || 'FW',
    boardState: window.BoardAPI?.getState() ?? {},
    who: (whoEl?.value || 'ALLY'),                         // ★修正
    opponent: (opponentEl?.value || '').trim(),            // ★修正
    updatedAt: serverTimestamp()
  });
  alert('保存しました');
}));

duplicateBtn?.addEventListener('click', safeClick(async ()=>{
  if (!currentTeam) return;
  const src = plays.find(p=>p.id===currentId);
  if (!src) return;
  const ref = await addDoc(collection(db,'teams',currentTeam.id,'plays'), {
    title: (src.title || '無題') + '（複製）',
    notes: src.notes || '',
    unit:  normalizeUnit(src.unit),
    group: src.group || 'FW',
    boardState: src.boardState || {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  currentId = ref.id;
  alert('複製しました');
}));

deleteBtn?.addEventListener('click', safeClick(async ()=>{
  if (!currentTeam || !currentId) return;
  if (!confirm('このプレーを削除しますか？')) return;
  await updateDoc(doc(db,'teams',currentTeam.id,'plays',currentId), {
    // 論理削除にするならここをフラグに、完全削除なら deleteDoc を使う
  });
  // 完全削除：
  const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await deleteDoc(doc(db,'teams',currentTeam.id,'plays',currentId));
  currentId = null;
  document.getElementById('resetPositions')?.click();
  titleEl.value=''; notesEl.value='';
}));

// タイトル変更で自動保存
titleEl?.addEventListener('change', safeClick(async ()=>{
  if (!currentTeam || !currentId) return;
  await updateDoc(doc(db,'teams',currentTeam.id,'plays',currentId), {
    title: (titleEl.value || '').trim() || '（無題）',
    updatedAt: serverTimestamp()
  });
}));

// Export
exportBtn?.addEventListener('click', ()=>{
  const data = window.BoardAPI?.getState() ?? {};
  const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (titleEl.value || 'play') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Import
importFile?.addEventListener('change', safeClick(async ()=>{
  const file = importFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  window.BoardAPI?.setState(data);
}));

// 初期表示は未ログイン想定
showAuthView();
