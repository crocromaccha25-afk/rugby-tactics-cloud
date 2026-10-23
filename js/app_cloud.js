/* Firebase adapter; editor.js owns editing, drafts and navigation. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut,onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore,doc,getDoc,setDoc,collection,addDoc,query,where,getDocs,orderBy,onSnapshot,serverTimestamp,runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id),Core=window.TacticsEditor;
let currentUser=null,editor=null,authEpoch=0,teamBusy=false;
function authNotice(text){$('authNotice').textContent=text;$('authNotice').hidden=!text;}
function showAuth(){void window.BoardAPI.exitPresentation({restoreFocus:false,restoreFocusMode:false});document.body.classList.remove('board-focus');$('authView').style.display='block';$('appView').style.display='none';$('appHeader').style.display='none';$('teamSetupDialog').close?.();$('userBadge').textContent='';$('joinCodeBadge').textContent='';}
function showApp(user){$('authView').style.display='none';$('appView').style.display='grid';$('appHeader').style.display='';$('signOutBtn').style.display='';$('userBadge').textContent=user.email||'';window.BoardAPI.redraw();}
function cloudRepository(teamId,ownerUid){
  const plays=collection(db,'teams',teamId,'plays');
  return {
    label:'クラウド',newId:()=>doc(plays).id,
    subscribe(receive,error){return onSnapshot(query(plays,orderBy('updatedAt','desc')),snap=>receive(snap.docs.map(d=>({id:d.id,...d.data()})),{fromCache:snap.metadata?.fromCache}),error);},
    async save({id,payload,expectedToken,create}){
      const ref=doc(db,'teams',teamId,'plays',id);
      return runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(ref),old=snapshot.exists()?snapshot.data():null;
        if(create){
          if(old){if(old.clientRequestId===id&&old.ownerUid===ownerUid&&Core.fingerprint(old)===Core.fingerprint(payload))return{id,token:Core.versionToken(old),revision:old.revision};throw Core.conflict();}
        }else if(!old||Core.versionToken(old)!==expectedToken)throw Core.conflict();
        const revision=(Number(old?.revision)||0)+1,content={...payload,revision};
        const write={...content,updatedAt:serverTimestamp(),lastEditorUid:ownerUid};
        if(create){write.createdAt=serverTimestamp();write.ownerUid=ownerUid;write.clientRequestId=id;transaction.set(ref,write);}else transaction.update(ref,write);
        return{id,token:Core.versionToken(content),revision};
      });
    },
    async remove({id,expectedToken}){
      const ref=doc(db,'teams',teamId,'plays',id);
      return runTransaction(db,async transaction=>{const snapshot=await transaction.get(ref);if(!snapshot.exists()||Core.versionToken(snapshot.data())!==expectedToken)throw Core.conflict();transaction.delete(ref);});
    }
  };
}
window.RugbyCloudRepository=cloudRepository;
function attachTeam(team,user){
  editor?.dispose();showApp(user);$('joinCodeBadge').textContent='招待：'+(team.joinCode||'');$('teamInfoApp').textContent='チーム：'+(team.name||'');
  editor=new Core.Editor({repository:cloudRepository(team.id,user.uid),scope:user.uid+':'+team.id});$('teamSetupDialog').close?.();
}
function openTeamSetup(message='チームに参加するか、新しいチームを作成してください。'){$('teamSetupMessage').textContent=message;if(!$('teamSetupDialog').open)$('teamSetupDialog').showModal();}
async function authAction(button,callback){if(button.disabled)return;button.disabled=true;authNotice('');try{await callback();}catch(error){authNotice('ログイン・登録に失敗しました。'+(error.message||''));}finally{button.disabled=false;}}
$('signInBtn').addEventListener('click',()=>authAction($('signInBtn'),()=>signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value)));
$('signUpBtn').addEventListener('click',()=>authAction($('signUpBtn'),async()=>{const password=$('password').value;if(password.length<6)throw new Error('パスワードは6文字以上にしてください。');await createUserWithEmailAndPassword(auth,$('email').value.trim(),password);}));
$('signOutBtn').addEventListener('click',async()=>{if(editor&&!await editor.prepareLeave())return;try{await signOut(auth);}catch(error){editor?.notice('ログアウトできませんでした。'+error.message,true);}});
$('teamSetupDialog').addEventListener('cancel',e=>e.preventDefault());$('teamLogoutBtn').addEventListener('click',()=>signOut(auth));
async function setupTeam(kind){
  if(teamBusy||!currentUser)return;teamBusy=true;$('modalJoinBtn').disabled=$('modalCreateBtn').disabled=true;const user=currentUser;
  try{
    let team;
    if(kind==='join'){
      const code=$('modalJoinCode').value.trim();if(!code)throw new Error('招待コードを入力してください。');
      const result=await getDocs(query(collection(db,'teams'),where('joinCode','==',code)));if(result.empty)throw new Error('招待コードが見つかりません。');team={id:result.docs[0].id,...result.docs[0].data()};
    }else{
      const name=$('modalTeamName').value.trim();if(!name)throw new Error('チーム名を入力してください。');const joinCode=name.toLowerCase().replace(/\s+/g,'-')+'-'+Math.random().toString(36).slice(2,8);
      const ref=await addDoc(collection(db,'teams'),{name,joinCode,owner:user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});team={id:ref.id,name,joinCode};
    }
    await setDoc(doc(db,'profiles',user.uid),{teamId:team.id},{merge:true});if(currentUser?.uid===user.uid)attachTeam(team,user);
  }catch(error){$('teamSetupMessage').textContent=error.message;}finally{teamBusy=false;$('modalJoinBtn').disabled=$('modalCreateBtn').disabled=false;}
}
$('modalJoinBtn').addEventListener('click',()=>setupTeam('join'));$('modalCreateBtn').addEventListener('click',()=>setupTeam('create'));
onAuthStateChanged(auth,async user=>{
  const epoch=++authEpoch;currentUser=user||null;editor?.dispose();editor=null;if(!user){showAuth();return;}
  try{
    const profileRef=doc(db,'profiles',user.uid),snapshot=await getDoc(profileRef);if(!snapshot.exists())await setDoc(profileRef,{teamId:null,createdAt:serverTimestamp()});const profile=snapshot.exists()?snapshot.data():{};
    if(epoch!==authEpoch)return;showApp(user);
    if(profile.teamId){const result=await getDoc(doc(db,'teams',profile.teamId));if(epoch!==authEpoch)return;if(result.exists()){attachTeam({id:result.id,...result.data()},user);return;}}
    openTeamSetup(profile.teamId?'所属チームが見つかりません。参加するチームを選び直してください。':undefined);
  }catch(error){if(epoch===authEpoch){showAuth();authNotice('チーム情報を読み込めませんでした。'+error.message);}}
});
showAuth();
