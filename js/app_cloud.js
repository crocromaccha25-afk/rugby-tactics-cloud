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

function setTeamInfo(text){
  if (teamInfoAuth) teamInfoAuth.textContent = text ?? '';
  if (teamInfoApp)  teamInfoApp.textContent  = text ?? '';
}

function showAuthView(){
  authView.style.display = 'block';
  appView.style.display  = 'none';
  userBadge.textContent  = '';
  signOutBtn.style.display = 'none';
}
function showAppView(user){
  authView.style.display = 'none';
  appView.style.display  = 'grid'; // blockでもOK
  userBadge.textContent  = user?.email ?? '';
  signOutBtn.style.display = 'inline-block';
}

// ===== 認証ハンドラ =====
signInBtn?.addEventListener('click', safeClick(async ()=>{
  await signInWithEmailAndPassword(auth, emailEl.value, passwordEl.value);
  // onAuthStateChanged が後続をやる
}));

signUpBtn?.addEventListener('click', safeClick(async ()=>{
  await createUserWithEmailAndPassword(auth, emailEl.value, passwordEl.value);
}));

signOutBtn?.addEventListener('click', safeClick(async ()=>{
  await signOut(auth);
  unsubscribePlays?.(); unsubscribePlays = null;
  currentTeam = null; currentId = null; plays = [];
  playListEl.innerHTML = ''; titleEl.value=''; notesEl.value='';
}));

onAuthStateChanged(auth, async (user) => {
  // いまのユーザーを保存
  currentUser = user || null;

  // 未ログイン → 認証画面
  if (!user) {
    userBadge.textContent = '';
    if (signOutBtn) signOutBtn.style.display = 'none';
    showAuthView();
    return;
  }

  // ログイン中 → 上部バッジとサインアウトを出す
  userBadge.textContent = user.email ?? '(no email)';
  if (signOutBtn) signOutBtn.style.display = 'inline-block';

  // ここから Firestore プロファイル確認/作成
  const profRef  = doc(db, 'profiles', user.uid);
  const profSnap = await getDoc(profRef);
  if (!profSnap.exists()) {
    await setDoc(profRef, { teamId: null, createdAt: serverTimestamp() });
  }
  const prof = (await getDoc(profRef)).data();

  // ここがポイント：
  // 所属チームが「ある / ない」に関わらず、アプリ画面(appView)を表示する。
  // （チームが無い時は appView の上部に「チーム作成/参加」フォームを見せる）
  showAppView(user);

  if (prof.teamId) {
    // 所属あり → チーム情報を読み、プレイ一覧の購読を開始
    currentTeam = await getTeam(prof.teamId);
    setTeamInfo(`チーム：${currentTeam.name}　招待コード：${currentTeam.joinCode}`);
    subscribePlays(currentTeam.id);   // ★これを追加
  } else {
    // 未所属 → チーム作成/参加フォームを使えるようにする
    currentTeam = null;
    setTeamInfo('チーム未所属（作成 or 招待コードで参加）');
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

function renderList(){
  if (!playListEl) return;
  playListEl.innerHTML = '';
  plays.forEach(p=>{
    const li = document.createElement('li');
    li.className = 'item' + (p.id===currentId ? ' active' : '');
    li.dataset.id = p.id;

    const title = (p.title || '').trim() || '（無題）';
    const unit  = p.unit  || '15人';
    const group = p.group || 'FW';
    const time  = p.updatedAt?.toDate ? p.updatedAt.toDate() : new Date();

    li.innerHTML = `
      ${badge(group)} ${badge(unit)}
      <span style="flex:1">${title}</span>
      <span class="muted">${time.toLocaleString()}</span>
    `;
    li.addEventListener('click', ()=> selectPlay(p.id));
    playListEl.appendChild(li);
  });
}

function selectPlay(id){
  const p = plays.find(x=>x.id===id);
  if (!p) return;

  currentId = id;
  titleEl.value = p.title || '';
  notesEl.value = p.notes || '';
  unitEl.value  = p.unit  || '15人';
  groupEl.value = p.group || 'FW';

  if (p.boardState){
    window.BoardAPI?.setState(p.boardState);
  }else{
    document.getElementById('resetPositions')?.click();
  }
  renderList();
}

// ===== Plays CRUD =====
newBtn?.addEventListener('click', safeClick(async ()=> {
  if (!currentTeam) throw new Error('チーム未選択');
  const ref = await addDoc(collection(db,'teams',currentTeam.id,'plays'), {
    title: '新しいプレー',
    notes: '',
    unit:  unitEl.value || '15人',
    group: groupEl.value || 'FW',
    boardState: window.BoardAPI?.getState() ?? {},
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
    unit:  unitEl.value || '15人',
    group: groupEl.value || 'FW',
    boardState: window.BoardAPI?.getState() ?? {},
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
    unit:  src.unit  || '15人',
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
