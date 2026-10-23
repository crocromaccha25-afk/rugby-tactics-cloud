/* Shared editor used by the cloud application and the self-contained preview. */
(() => {
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  function canonical(value) {
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
    return value;
  }
  const stringify=value=>JSON.stringify(canonical(value));
  const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  function safeStorage(){try{return globalThis.localStorage;}catch{return null;}}
  function model(record={},initial) {
    return {title:String(record.title||''),notes:String(record.notes||''),unit:String(Number(record.unit)===12?12:15),group:['FW','BK'].includes(record.group)?record.group:'ALL',who:record.who==='OPP'?'OPP':'ALLY',opponent:String(record.opponent||''),boardState:copy(record.boardState||initial||{})};
  }
  function fingerprint(value) {
    const data=copy(model(value));
    // These are view preferences, not edits to a play.
    delete data.boardState.view;delete data.boardState.side;delete data.boardState.arrowColor;
    delete data.boardState.penColor;delete data.boardState.penWidth;
    // An absent ink field and an empty one represent the same legacy play.
    if(Array.isArray(data.boardState.strokes)&&!data.boardState.strokes.length)delete data.boardState.strokes;
    return stringify(data);
  }
  function versionToken(record) {
    return stringify({revision:Number(record.revision)||0,content:fingerprint(record)});
  }
  function conflict(message='ほかの端末で更新されています。最新版を読み込むか、別プレーとして保存してください。') {
    const error=new Error(message);error.code='conflict';return error;
  }
  function download(blob,name) {
    const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function askDialog({title='確認',message='',choices=[]}) {
    const dialog=document.getElementById('editorDialog');
    if(!dialog)return Promise.resolve('cancel');
    if(dialog.open)return Promise.resolve('cancel');
    document.getElementById('dialogTitle').textContent=title;document.getElementById('dialogMessage').textContent=message;
    const actions=document.getElementById('dialogActions');actions.replaceChildren();
    return new Promise(resolve=>{
      let finished=false;
      const finish=value=>{if(finished)return;finished=true;dialog.removeEventListener('cancel',cancel);if(dialog.close)dialog.close();else dialog.removeAttribute('open');resolve(value);};
      const cancel=e=>{e.preventDefault();finish('cancel');};dialog.addEventListener('cancel',cancel);
      for(const choice of choices){const button=document.createElement('button');button.type='button';button.textContent=choice.label;if(choice.primary)button.className='primary';button.addEventListener('click',()=>finish(choice.value),{once:true});actions.appendChild(button);}
      if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
      actions.querySelector('button')?.focus();
    });
  }

  class Editor {
    constructor({repository,scope,board=window.BoardAPI,storage=safeStorage(),ask=askDialog}) {
      this.repo=repository;this.board=board;this.storage=storage;this.ask=ask;this.scope=scope;
      this.prefix='rugby-tactics:v4:'+encodeURIComponent(scope)+':';this.currentId=null;this.newId=this.repo.newId?.()||uid();
      this.records=[];this.baseToken=null;this.baseline='';this.dirty=false;this.busy=false;this.disposed=false;this.applying=false;this.remoteChanged=false;
      this.listeners=[];this.draftTimer=null;this.pendingSave=null;this.pendingNavigation=false;this.didInitialSnapshot=false;this.draftCandidate=null;this.storageWarning=false;
      this._loadModel(model({},this.board.getInitialState()),null,null);
      const on=(target,event,callback)=>{
        if(!target)return;
        const wrapped=e=>{if(this.disposed)return;try{const result=callback(e);if(result?.catch)result.catch(error=>this.notice(error.message,true));}catch(error){this.notice(error.message,true);}};
        target.addEventListener(event,wrapped);this.listeners.push(()=>target.removeEventListener(event,wrapped));
      };
      this.on=on;
      ['playTitle','notes','whoSelect','opponentInput'].forEach(id=>on(this.$(id),'input',()=>this.edited()));
      on(this.$('whoSelect'),'change',()=>{this.$('opponentInput').disabled=this.$('whoSelect').value!=='OPP';this.edited();});
      on(this.$('groupSelect'),'change',()=>this.edited());
      on(this.$('board'),'boardchange',()=>this.edited());
      on(this.$('saveBtn'),'click',()=>this.save());on(this.$('newPlayBtn'),'click',()=>this.newPlay());
      on(this.$('duplicateBtn'),'click',()=>this.save({duplicate:true}));on(this.$('saveAsNewBtn'),'click',()=>this.save({asNew:true}));
      on(this.$('deleteBtn'),'click',()=>this.deletePlay());on(this.$('loadRemoteBtn'),'click',()=>this.reloadRemote());
      on(this.$('restoreDraftBtn'),'click',()=>this.restoreDraft());on(this.$('discardDraftBtn'),'click',()=>this.discardDraft());
      on(this.$('templateBtn'),'click',async()=>{
        if(this.busy)return;
        const board=this.board.getState();
        if(board.arrows.length||board.strokes?.length){const choice=await this.ask({title:'配置を変更',message:'配置をテンプレートに置き換え、矢印と落書きを消します。「戻る」で取り消せます。',choices:[{label:'配置を変更',value:'apply',primary:true},{label:'キャンセル',value:'cancel'}]});if(choice!=='apply')return;}
        this.board.applyTemplate(this.$('templateSelect').value);
      });
      on(this.$('exportBtn'),'click',()=>download(new Blob([JSON.stringify({format:'rugby-tactics',version:4,...this.capture()},null,2)],{type:'application/json'}),this.fileName()+'.json'));
      on(this.$('pngBtn'),'click',async()=>{const button=this.$('pngBtn');button.disabled=true;try{const blob=await this.board.exportPNG(this.capture());download(blob,this.fileName()+'.png');this.notice('PNG画像を書き出しました。');}finally{button.disabled=false;}});
      on(this.$('importFile'),'change',e=>this.importFile(e.target.files?.[0]));
      ['playSearch','filterOpponent'].forEach(id=>on(this.$(id),'input',()=>this.renderList()));on(this.$('filterWho'),'change',()=>this.renderList());
      on(this.$('playsGrouped'),'click',e=>{const button=e.target.closest('[data-play-id]');if(button)return this.selectPlay(button.dataset.playId);});
      on(window,'beforeunload',e=>{this.flushDraft();if(this.dirty||this.busy){e.preventDefault();e.returnValue='';}});
      on(window,'pagehide',()=>this.flushDraft());on(document,'visibilitychange',()=>{if(document.hidden)this.flushDraft();});
      on(window,'online',()=>this.renderStatus());on(window,'offline',()=>this.renderStatus());
      this.unsubscribe=this.repo.subscribe((records,info)=>{try{this.receive(records,info);}catch(error){this.notice('プレーを読み込めません。現在の編集を保持しています。'+(error.message||''),true);}},error=>this.notice('プレー一覧を読み込めません。下書きを保持しています。'+(error.message||''),true));
      this.renderStatus();
    }
    $(id){return document.getElementById(id);}
    capture() {
      return model({title:this.$('playTitle').value,notes:this.$('notes').value,unit:this.$('unitSelect').value,group:this.$('groupSelect').value,who:this.$('whoSelect').value,opponent:this.$('opponentInput').value,boardState:this.board.getState()});
    }
    fileName(){return (this.$('playTitle').value.trim()||'rugby-play').replace(/[\\/:*?"<>|]/g,'_').slice(0,100);}
    notice(message,error=false){const el=this.$('editorNotice');if(el){el.textContent=message;el.classList.toggle('is-error',error);el.hidden=!message;}}
    _loadModel(data,id,token) {
      this.applying=true;
      try {
        // Validate/load the board before changing fields or the selected record.
        this.board.setState(data.boardState);
        this.$('playTitle').value=data.title;this.$('notes').value=data.notes;this.$('whoSelect').value=data.who;this.$('opponentInput').value=data.opponent;this.$('opponentInput').disabled=data.who!=='OPP';
        this.board.setView(data.group);
        this.currentId=id;this.baseToken=token;this.baseline=fingerprint(this.capture());this.dirty=false;this.remoteChanged=false;this.failed=false;
      } finally {this.applying=false;}
      this.showDraftCandidate();this.renderStatus();this.renderList();
    }
    edited() {
      if(this.disposed||this.applying)return;
      this.dirty=fingerprint(this.capture())!==this.baseline;this.failed=false;
      clearTimeout(this.draftTimer);this.draftTimer=setTimeout(()=>this.flushDraft(),400);this.renderStatus();
    }
    slot(){return this.currentId||'new';}
    readStorage(suffix){try{return JSON.parse(this.storage.getItem(this.prefix+suffix)||'null');}catch{return null;}}
    writeStorage(suffix,value) {
      try{this.storage.setItem(this.prefix+suffix,JSON.stringify(value));return true;}catch{if(!this.storageWarning){this.notice('このブラウザに下書きを保存できません。JSON書き出し、またはプレーを保存してください。',true);this.storageWarning=true;}return false;}
    }
    removeDraft(slot=this.slot()){try{this.storage.removeItem(this.prefix+'draft:'+slot);if(this.readStorage('last')===slot)this.storage.removeItem(this.prefix+'last');}catch{}}
    flushDraft() {
      clearTimeout(this.draftTimer);this.draftTimer=null;if(this.disposed||this.applying)return;
      if(!this.dirty)return;
      const savedAt=Date.now(),slot=this.slot();
      const record={version:4,playId:this.currentId,newId:this.newId,baseToken:this.baseToken,payload:this.capture(),savedAt};
      if(this.writeStorage('draft:'+slot,record)){this.writeStorage('last',slot);this.lastDraftTime=savedAt;this.renderStatus();}
    }
    showDraftCandidate() {
      const draft=this.readStorage('draft:'+this.slot());
      this.draftCandidate=draft&&draft.version===4&&draft.payload&&typeof draft.payload==='object'?draft:null;
      if(this.$('draftBanner'))this.$('draftBanner').hidden=!this.draftCandidate;
    }
    async restoreDraft() {
      if(this.busy||!this.draftCandidate)return false;
      const candidate=copy(this.draftCandidate);
      if(this.dirty&&!await this.prepareLeave())return false;
      const remote=this.records.find(p=>p.id===candidate.playId);
      const reference=remote?model(remote,this.board.getInitialState()):model({},this.board.getInitialState());
      this._loadModel(model(candidate.payload,this.board.getInitialState()),candidate.playId,candidate.baseToken);
      this.newId=candidate.newId||this.repo.newId?.()||uid();this.baseline=fingerprint(reference);this.dirty=fingerprint(this.capture())!==this.baseline;
      this.remoteChanged=!!candidate.playId&&(!remote||versionToken(remote)!==candidate.baseToken);this.draftCandidate=null;this.$('draftBanner').hidden=true;
      this.renderStatus();this.notice('端末の下書きを復元しました。');return true;
    }
    discardDraft(){if(this.busy)return;this.removeDraft();this.draftCandidate=null;this.$('draftBanner').hidden=true;this.notice('この端末の保存済み下書きを破棄しました。');}
    receive(records,info={}) {
      if(this.disposed)return;
      this.records=records.slice();this.fromCache=!!info.fromCache;
      if(!this.didInitialSnapshot){
        this.didInitialSnapshot=true;
        if(!this.dirty&&!this.busy){
          const last=this.readStorage('last'),draft=last&&this.readStorage('draft:'+last);
          const first=draft?(draft.playId&&this.records.find(p=>p.id===draft.playId)):this.records[0];
          if(first)this._loadModel(model(first,this.board.getInitialState()),first.id,versionToken(first));
          else if(draft?.playId){this.currentId=draft.playId;this.showDraftCandidate();}
          else this.showDraftCandidate();
        }
      } else if(this.currentId&&!this.busy) {
        const remote=this.records.find(p=>p.id===this.currentId);
        if(!remote){this.remoteChanged=true;}
        else if(versionToken(remote)!==this.baseToken){
          if(this.dirty)this.remoteChanged=true;
          else this._loadModel(model(remote,this.board.getInitialState()),remote.id,versionToken(remote));
        }
      }
      this.renderList();this.renderStatus();
    }
    renderStatus() {
      const status=this.$('saveStatus');
      if(status){status.textContent=this.busy?'保存中…':this.failed?'保存できませんでした':this.dirty?'未保存':this.currentId?'保存済み':'新しい下書き';status.dataset.state=this.busy?'saving':this.failed?'error':this.dirty?'dirty':'saved';}
      if(this.$('draftStatus'))this.$('draftStatus').textContent=this.lastDraftTime?'端末の下書き保存 '+new Date(this.lastDraftTime).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'編集内容は端末にも下書き保存します';
      if(this.$('connectionStatus'))this.$('connectionStatus').textContent=globalThis.navigator?.onLine===false?'オフライン':this.repo.label||'クラウド';
      if(this.$('remoteBanner'))this.$('remoteBanner').hidden=!this.remoteChanged;
      if(this.$('deleteBtn'))this.$('deleteBtn').disabled=this.busy||!this.currentId;
    }
    setBusy(value) {
      this.busy=value;this.board.setReadOnly(value);
      const ids=['saveBtn','newPlayBtn','duplicateBtn','deleteBtn','saveAsNewBtn','loadRemoteBtn','restoreDraftBtn','discardDraftBtn','templateBtn','templateSelect','resetPositions','unitSelect','courtSelect','groupSelect','playTitle','notes','whoSelect','opponentInput','importFile','signOutBtn'];
      ids.forEach(id=>{const el=this.$(id);if(el)el.disabled=value;});
      if(!value)this.$('opponentInput').disabled=this.$('whoSelect').value!=='OPP';
      this.renderStatus();this.renderList();
    }
    save(options={}) {
      if(this.pendingSave)return this.pendingSave;
      this.pendingSave=this._save(options).finally(()=>{this.pendingSave=null;});return this.pendingSave;
    }
    async _save({duplicate=false,asNew=false}={}) {
      if(this.disposed)return false;
      const data=this.capture();data.title=data.title.trim()||'（無題）';
      if(duplicate)data.title+='（複製）';if(asNew)data.title+='（別保存）';
      if(new Blob([JSON.stringify(data)]).size>800000){this.notice('データが大きすぎます。落書き・矢印・説明を減らしてから保存してください。',true);return false;}
      const previousSlot=this.slot(),create=duplicate||asNew||!this.currentId;
      const signature=(duplicate?'duplicate':asNew?'copy':'save')+fingerprint(data);
      const id=create?(this.writeAttempt?.signature===signature?this.writeAttempt.id:duplicate||asNew?this.repo.newId?.()||uid():this.newId):this.currentId;
      if(create)this.writeAttempt={signature,id};
      this.flushDraft();this.setBusy(true);this.notice('');
      try {
        const result=await this.repo.save({id,payload:copy(data),expectedToken:create?null:this.baseToken,create});
        if(this.disposed)return true;
        this.applying=true;
        this.$('playTitle').value=data.title;
        this.currentId=result.id||id;this.baseToken=result.token;this.baseline=fingerprint(data);this.dirty=fingerprint(this.capture())!==this.baseline;this.remoteChanged=false;this.failed=false;
        this.applying=false;this.writeAttempt=null;this.removeDraft(previousSlot);this.removeDraft(this.currentId);this.draftCandidate=null;this.lastDraftTime=null;this.$('draftBanner').hidden=true;
        this.savedRevision=Number(result.revision)||0;
        this.notice(this.repo.label==='この端末'?'このブラウザに保存しました。':'保存しました。');
        return true;
      } catch(error) {
        this.failed=true;if(error.code==='conflict')this.remoteChanged=true;
        this.notice(error.code==='conflict'?error.message:'保存できませんでした。編集内容と下書きは保持しています。'+(error.message||''),true);return false;
      } finally {
        if(!this.disposed){
          this.setBusy(false);
          const remote=this.records.find(p=>p.id===this.currentId);
          // A newer update may have arrived while the write acknowledgement was pending.
          // Ignore older cached rows; process current/newer revisions after unlocking.
          if(remote&&Number(remote.revision)>=this.savedRevision&&versionToken(remote)!==this.baseToken){
            if(this.dirty||this.failed)this.remoteChanged=true;
            else this._loadModel(model(remote,this.board.getInitialState()),remote.id,versionToken(remote));
          }
          if(this.dirty)this.flushDraft();this.renderStatus();
        }
      }
    }
    async prepareLeave() {
      if(this.busy)return false;
      if(!this.dirty)return true;
      this.flushDraft();
      const choice=await this.ask({title:'未保存の編集があります',message:'保存してから切り替えますか？',choices:[{label:'保存して切り替える',value:'save',primary:true},{label:'保存せず切り替える',value:'discard'},{label:'キャンセル',value:'cancel'}]});
      if(choice==='save')return await this.save()&&!this.dirty;
      if(choice==='discard'){this.removeDraft();return true;}
      return false;
    }
    async navigate(action) {
      if(this.pendingNavigation||this.busy)return false;this.pendingNavigation=true;
      try{if(!await this.prepareLeave())return false;action();return true;}finally{this.pendingNavigation=false;}
    }
    async selectPlay(id) {
      if(id===this.currentId)return true;
      return this.navigate(()=>{const remote=this.records.find(p=>p.id===id);if(remote)this._loadModel(model(remote,this.board.getInitialState()),id,versionToken(remote));});
    }
    async newPlay() {
      return this.navigate(()=>{const old=this.capture();this.newId=this.repo.newId?.()||uid();this._loadModel(model({unit:old.unit,boardState:this.board.getInitialState(old.unit,old.boardState.court)}),null,null);this.notice('新しい下書きです。「プレーを保存」で保存します。');});
    }
    async reloadRemote() {
      return this.navigate(()=>{const remote=this.records.find(p=>p.id===this.currentId);if(remote)this._loadModel(model(remote,this.board.getInitialState()),remote.id,versionToken(remote));else{this.newId=this.repo.newId?.()||uid();this._loadModel(model({},this.board.getInitialState()),null,null);}});
    }
    async deletePlay() {
      if(this.busy||!this.currentId)return false;
      const choice=await this.ask({title:'プレーを削除',message:'このプレーをクラウドから削除します。未保存の編集も破棄されます。',choices:[{label:'削除する',value:'delete'},{label:'キャンセル',value:'cancel'}]});
      if(choice!=='delete')return false;
      const id=this.currentId;this.flushDraft();this.setBusy(true);
      try{await this.repo.remove({id,expectedToken:this.baseToken});this.removeDraft(id);const next=this.records.find(p=>p.id!==id);if(next)this._loadModel(model(next,this.board.getInitialState()),next.id,versionToken(next));else this._loadModel(model({},this.board.getInitialState()),null,null);this.notice('削除しました。');return true;}
      catch(error){if(error.code==='conflict')this.remoteChanged=true;this.notice(error.message,true);return false;}
      finally{this.setBusy(false);}
    }
    async importFile(file) {
      if(!file)return;
      try{
        if(file.size>2*1024*1024)throw new Error('2MB以下のJSONを選んでください。');
        const value=JSON.parse(await file.text()),boardState=value.boardState||value;
        if(!boardState||!['allies','opps','arrows'].some(k=>Array.isArray(boardState[k])))throw new Error('戦術ノートのJSONではありません。');
        await this.navigate(()=>{const newId=this.repo.newId?.()||uid(),data=model({...value,title:value.title||file.name.replace(/\.json$/i,''),unit:boardState.unit,boardState},this.board.getInitialState());this._loadModel(data,null,null);this.newId=newId;this.baseline=fingerprint(model({},this.board.getInitialState()));this.edited();this.notice('別プレーの下書きとして読み込みました。');});
      } catch(error){this.notice(error.message,true);}finally{this.$('importFile').value='';}
    }
    renderList() {
      const root=this.$('playsGrouped');if(!root)return;root.replaceChildren();
      const keyword=(this.$('playSearch')?.value||'').trim().toLocaleLowerCase(),who=this.$('filterWho')?.value||'ALL',opponent=(this.$('filterOpponent')?.value||'').trim().toLocaleLowerCase();
      const filtered=this.records.filter(p=>(who==='ALL'||(p.who||'ALLY')===who)&&(who==='ALLY'||!opponent||String(p.opponent||'').toLocaleLowerCase().includes(opponent))&&(!keyword||[p.title,p.notes,p.opponent].some(v=>String(v||'').toLocaleLowerCase().includes(keyword))));
      const groups=new Map();for(const p of filtered){const key=p.who==='OPP'?'相手：'+(p.opponent||'相手名なし'):'自チーム';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
      for(const [key,records] of groups){const group=document.createElement('details');group.className='play-group';group.open=true;const summary=document.createElement('summary');summary.textContent=key+' · '+records.length+'件';group.appendChild(summary);
        for(const p of records){const button=document.createElement('button');button.type='button';button.className='play-item'+(p.id===this.currentId?' active':'');button.dataset.playId=p.id;button.disabled=this.busy;
          const title=document.createElement('span'),meta=document.createElement('small');title.textContent=p.title||'（無題）';meta.textContent=(p.unit||15)+'人制 · '+(p.group||'ALL');button.append(title,meta);group.appendChild(button);}
        root.appendChild(group);
      }
      if(!filtered.length){const p=document.createElement('p');p.className='empty-list';p.textContent=this.records.length?'条件に合うプレーがありません。':'保存したプレーがここに表示されます。';root.appendChild(p);}
      if(this.$('playsCount'))this.$('playsCount').textContent=filtered.length+'件';
      if(this.$('filterOpponent'))this.$('filterOpponent').disabled=who==='ALLY';
    }
    dispose(){if(this.disposed)return;this.flushDraft();this.disposed=true;clearTimeout(this.draftTimer);this.unsubscribe?.();this.listeners.forEach(off=>off());this.board.setReadOnly(false);}
  }

  function localRepository(storage=safeStorage(),key='rugby-tactics-preview-v4') {
    const listeners=new Set();
    const read=()=>{try{const value=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
    const emit=()=>{const rows=read().sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));listeners.forEach(fn=>fn(rows));};
    const onStorage=e=>{if(e.key===key)emit();};window.addEventListener('storage',onStorage);
    return {label:'この端末',newId:uid,subscribe(fn){listeners.add(fn);queueMicrotask(emit);return()=>{listeners.delete(fn);if(!listeners.size)window.removeEventListener('storage',onStorage);};},
      async save({id,payload,expectedToken,create}){const rows=read(),old=rows.find(p=>p.id===id);
        if(create&&old&&fingerprint(old)===fingerprint(payload))return{id,token:versionToken(old),revision:old.revision};
        if(create?!!old:!old||versionToken(old)!==expectedToken)throw conflict();
        const record={...copy(payload),id,revision:(Number(old?.revision)||0)+1,savedAt:Date.now()};const next=rows.filter(p=>p.id!==id);next.unshift(record);storage.setItem(key,JSON.stringify(next));queueMicrotask(emit);return{id,token:versionToken(record),revision:record.revision};},
      async remove({id,expectedToken}){const rows=read(),old=rows.find(p=>p.id===id);if(!old||versionToken(old)!==expectedToken)throw conflict();storage.setItem(key,JSON.stringify(rows.filter(p=>p.id!==id)));queueMicrotask(emit);}
    };
  }
  window.TacticsEditor={Editor,versionToken,fingerprint,conflict,model,localRepository,askDialog};
})();
