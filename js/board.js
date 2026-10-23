/* Rugby tactics board v6: model-based freehand ink, viewport and TV presentation. */
(() => {
  'use strict';
  const canvas = document.getElementById('board');
  if (!canvas) return;
  let ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const DEFAULT_ARROW = '#ffdf4b';
  const OPPONENT_COLOR = '#111820';
  const INK_LIMITS = {strokes:200,pointsPerStroke:1000,totalPoints:8000};
  const mobileQuery = window.matchMedia('(max-width: 600px)');
  const boardSection = $('boardSection') || canvas.closest('.board-section');
  const boardContainer = canvas.parentElement;
  const presentation = {active:false,native:false,pending:false,exiting:false,previousTool:'move',previousFocus:false,returnFocus:null,background:[],containerWidth:''};
  const metrics = { width: 1100, height: 700, portrait: false, radius: 16 };
  const state = {
    schemaVersion: 4, unit: 15, court: 'FULL', view: 'ALL', side: 'BOTH', tool: 'move',
    allies: [], opps: [], bench: [], arrows: [], strokes: [], ball: { x: 0.5, y: 0.475 },
    arrowColor: DEFAULT_ARROW, penColor: '#ffffff', penWidth: 4
  };
  let history = [];
  let future = [];
  let readOnly = false;
  const viewport = { scale:1, x:0, y:0 };
  const pointers = new Map();
  let gesture = null;
  let interaction = null;
  let frame = 0;
  let scrollTimer = null;
  let inkNotice = '';
  function changed(reason) {
    canvas.dispatchEvent(new CustomEvent('boardchange',{detail:{reason}}));
  }

  // Derive height from layout width only. Mobile browser toolbars change the
  // viewport height while scrolling; that must not clear the canvas bitmap.
  function canvasRatio(portrait = !presentation.active && mobileQuery.matches) {
    if (state.court === 'HALF') return portrait ? 7/6 : 6/7;
    return portrait ? 7/11 : 11/7;
  }
  function markerInk(value) {
    let raw = String(value || '').trim().toLowerCase();
    if (raw === 'white') return '#17202b';
    if (/^#[0-9a-f]{3}$/i.test(raw)) raw = '#' + [...raw.slice(1)].map(c=>c+c).join('');
    let channels = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(raw)
      ? [1,3,5].map(i=>parseInt(raw.slice(i,i+2),16)) : null;
    if (!channels) {
      const rgb = raw.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/);
      if (rgb) channels = rgb.slice(1,4).map(Number);
    }
    return channels && channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722 > 180 ? '#17202b' : '#ffffff';
  }

  // Spread over both halves; FW nearer the centre, BK and back three deeper.
  const formation = [
    [1,.435,.34], [2,.435,.475], [3,.435,.61],
    [4,.35,.40], [5,.35,.55], [6,.43,.18], [7,.43,.77], [8,.265,.475],
    [9,.265,.30], [10,.265,.65], [11,.155,.145], [12,.17,.31],
    [13,.17,.64], [14,.155,.805], [15,.155,.475]
  ];
  function makePlayers(unit, opponent = false) {
    const omitted = unit === 12 ? new Set([6,7,8]) : new Set();
    return formation.filter(([no]) => !omitted.has(no)).map(([no,x,y]) => ({
      x: opponent ? 1-x : x, y, no, role: no <= 8 ? 'FW' : 'BK',
      color: opponent ? OPPONENT_COLOR : no <= 8 ? '#ef6270' : '#59aaff', name: ''
    }));
  }
  function makeBench(unit) {
    const count = unit === 12 ? 6 : 8;
    return Array.from({ length: count }, (_,i) => ({
      x: .16 + i * (.68/(count-1)), y: .94, no: 16+i,
      role: 'BENCH', color: '#ffffff', name: ''
    }));
  }
  function getInitialState(unit=15,court='FULL',template='balanced') {
    unit=Number(unit)===12?12:15;
    const base={schemaVersion:4,unit,court:court==='HALF'?'HALF':'FULL',view:'ALL',side:'BOTH',allies:makePlayers(unit),opps:makePlayers(unit,true),bench:makeBench(unit),arrows:[],strokes:[],ball:{x:.5,y:.475},arrowColor:DEFAULT_ARROW,penColor:'#ffffff',penWidth:4};
    const put=(list,no,x,y)=>{const p=list.find(p=>p.no===no);if(p){p.x=x;p.y=y;}};
    if(template==='scrum') {
      const positions=[[1,.46,.39],[2,.46,.48],[3,.46,.57],[4,.385,.435],[5,.385,.525],[6,.385,.30],[7,.385,.66],[8,.31,.48],[9,.235,.46],[10,.27,.74],[11,.145,.16],[12,.16,.31],[13,.16,.65],[14,.145,.81],[15,.145,.48]];
      positions.forEach(([n,x,y])=>{put(base.allies,n,x,y);put(base.opps,n,1-x,y);});
      base.ball={x:.5,y:.48};
    } else if(template==='lineout') {
      const forwards=base.allies.filter(p=>p.role==='FW'&&p.no!==2);
      forwards.forEach((p,i)=>{const y=.18+i*(.48/Math.max(1,forwards.length-1));put(base.allies,p.no,.44,y);put(base.opps,p.no,.56,y);});
      put(base.allies,2,.5,.065);put(base.opps,2,.65,.76);
      const backs=[[9,.29,.43],[10,.28,.75],[11,.145,.15],[12,.16,.31],[13,.16,.65],[14,.145,.82],[15,.145,.48]];
      backs.forEach(([n,x,y])=>{put(base.allies,n,x,y);put(base.opps,n,1-x,y);});base.ball={x:.5,y:.11};
    } else if(template==='kickoff') {
      const fw=base.allies.filter(p=>p.role==='FW'),bk=base.allies.filter(p=>p.role==='BK');
      fw.forEach((p,i)=>{const y=.15+i*.64/Math.max(1,fw.length-1);put(base.allies,p.no,.43,y);put(base.opps,p.no,.66,y);});
      bk.forEach((p,i)=>{const y=.145+i*.66/Math.max(1,bk.length-1);put(base.allies,p.no,.2,y);put(base.opps,p.no,.82,y);});
      put(base.allies,10,.49,.475);base.ball={x:.52,y:.475};
    }
    return base;
  }
  function snapshot() {
    const { schemaVersion,unit,court,view,side,allies,opps,bench,arrows,strokes,ball,arrowColor,penColor,penWidth } = state;
    return clone({ schemaVersion,unit,court,view,side,allies,opps,bench,arrows,strokes,ball,arrowColor,penColor,penWidth });
  }
  function remember(before) {
    future=[];
    history.push(before);
    if (history.length > 60) history.shift();
    if ($('undoBtn')) $('undoBtn').disabled = false;
  }
  function reset(unit = state.unit, record = true) {
    if(readOnly&&record)return;
    cancelInteraction();
    inkNotice='';
    if (record && state.allies.length) remember(snapshot());
    const initial=getInitialState(unit,state.court);
    for(const key of ['allies','opps','bench'])initial[key].forEach(p=>{p.name=state[key].find(old=>Number(old.no)===p.no)?.name||'';});
    Object.assign(state,initial);
    syncUI(); renderRoster(); redraw();
    if(record)changed('reset');
  }
  function undo() {
    if(readOnly)return;
    cancelInteraction();
    inkNotice='';
    const previous = history.pop();
    if (!previous) return;
    future.push(snapshot());
    Object.assign(state,previous);
    syncUI(); renderRoster(); redraw();
    changed('undo');
  }
  function redo() {
    if(readOnly)return;
    cancelInteraction();inkNotice='';const next=future.pop();if(!next)return;
    history.push(snapshot());Object.assign(state,next);syncUI();renderRoster();redraw();changed('redo');
  }
  function applyTemplate(name) {
    if(readOnly)return;
    cancelInteraction();inkNotice='';
    const initial=getInitialState(state.unit,state.court,name);remember(snapshot());
    for(const key of ['allies','opps','bench']) {
      state[key]=state[key].map(p=>{const pos=initial[key].find(q=>Number(q.no)===Number(p.no));return pos?{...p,x:pos.x,y:pos.y}:p;});
    }
    state.ball=initial.ball;state.arrows=[];state.strokes=[];state.view='ALL';state.side='BOTH';syncUI();renderRoster();redraw();changed('template');
  }
  function color(value, fallback = DEFAULT_ARROW) {
    return typeof value === 'string' && value.length < 80 && CSS.supports('color',value)
      ? value : fallback;
  }
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  function validPoint(p) { return p && finite(p.x) && finite(p.y); }
  function point(p) { return { x:clamp(p.x,.015,.985), y:clamp(p.y,.015,.985) }; }
  function inkPoint(p){return {x:Math.round(clamp(p.x,0,1)*100000)/100000,y:Math.round(clamp(p.y,0,1)*100000)/100000};}
  function readStrokes(list){
    if(!Array.isArray(list))return [];
    if(list.length>INK_LIMITS.strokes)throw new Error('落書きの線が多すぎます。200本以下にしてください。');
    let total=0;
    return list.flatMap(stroke=>{
      if(!stroke||!Array.isArray(stroke.points))return [];
      total+=stroke.points.length;
      if(stroke.points.length>INK_LIMITS.pointsPerStroke||total>INK_LIMITS.totalPoints)throw new Error('落書きのデータが大きすぎます。線を減らしてください。');
      const points=stroke.points.filter(validPoint).map(inkPoint);
      return points.length?[{points,color:color(stroke.color,'#ffffff'),width:finite(stroke.width)?clamp(stroke.width,1,12):4}]:[];
    });
  }
  function readPlayers(list, fallback, opponent = false) {
    if (!Array.isArray(list)) return fallback;
    return list.filter(p => validPoint(p) && (typeof p.no === 'number' || typeof p.no === 'string'))
      .map(p => ({ ...point(p), no: p.no, name: typeof p.name === 'string' ? p.name : '',
        role: ['FW','BK','BENCH'].includes(p.role) ? p.role : Number(p.no) <= 8 ? 'FW' : 'BK',
        color: opponent ? OPPONENT_COLOR : color(p.color, Number(p.no)<=8 ? '#ef6270' : '#59aaff')
      }));
  }
  function setState(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('盤面データの形式が正しくありません');
    const s = input.boardState || input;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('盤面データの形式が正しくありません');
    const strokes=readStrokes(s.strokes);
    cancelInteraction();
    inkNotice='';
    const unit = Number(s.unit) === 12 ? 12 : 15;
    const all = readPlayers(s.allies,makePlayers(unit));
    const legacyBench = all.filter(p => p.role === 'BENCH');
    const allies = all.filter(p => p.role !== 'BENCH');
    const opps = readPlayers(s.opps,makePlayers(unit,true),true).filter(p => p.role !== 'BENCH');
    // Old 12-player data omitted two backs; fill their vacant slots on load.
    if (unit === 12 && !s.schemaVersion) {
      for (const list of [allies,opps]) {
        const defaults = makePlayers(unit,list === opps);
        for (const p of defaults) if (!list.some(item => Number(item.no) === p.no)) list.push(p);
      }
    }
    Object.assign(state,{
      schemaVersion:4, unit, court:s.court === 'HALF' ? 'HALF' : 'FULL',
      view:['FW','BK'].includes(s.view) ? s.view : 'ALL',
      side:['ALLY','OPP'].includes(s.side) ? s.side : 'BOTH',
      allies,
      opps:opps.length ? opps : makePlayers(unit,true),
      bench:readPlayers(s.bench,legacyBench.length ? legacyBench : makeBench(unit))
        .map(p => ({...p,role:'BENCH',color:'#ffffff'})),
      arrows:Array.isArray(s.arrows) ? s.arrows.filter(a => a && validPoint(a.from) && validPoint(a.to))
        .map(a => ({ from:point(a.from),to:point(a.to),color:color(a.color,DEFAULT_ARROW) })) : [],
      strokes,
      ball:validPoint(s.ball) ? point(s.ball) : {x:.5,y:.475},
      arrowColor:color(s.arrowColor,DEFAULT_ARROW),
      penColor:color(s.penColor,'#ffffff'),penWidth:[2,4,8].includes(Number(s.penWidth))?Number(s.penWidth):4
    });
    history = [];future=[];resetViewport(false);
    syncUI(); renderRoster(); redraw();
  }

  // Rotate the presentation only. Saved positions do not change with orientation.
  function screen(p) {
    return metrics.portrait
      ? { x:(1-p.y)*metrics.width, y:p.x*metrics.height }
      : { x:p.x*metrics.width, y:p.y*metrics.height };
  }
  function field(p) {
    return metrics.portrait
      ? { x:p.y/metrics.height, y:1-p.x/metrics.width }
      : { x:p.x/metrics.width, y:p.y/metrics.height };
  }
  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    return {x:((e.clientX-r.left)*metrics.width/r.width-viewport.x)/viewport.scale,y:((e.clientY-r.top)*metrics.height/r.height-viewport.y)/viewport.scale};
  }
  function rawPointer(e) {
    const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*metrics.width/r.width,y:(e.clientY-r.top)*metrics.height/r.height};
  }
  function clampViewport() {
    viewport.x=clamp(viewport.x,metrics.width*(1-viewport.scale),0);viewport.y=clamp(viewport.y,metrics.height*(1-viewport.scale),0);
  }
  function zoomTo(scale,anchor={x:metrics.width/2,y:metrics.height/2}) {
    const world={x:(anchor.x-viewport.x)/viewport.scale,y:(anchor.y-viewport.y)/viewport.scale};
    viewport.scale=clamp(scale,1,4);viewport.x=anchor.x-world.x*viewport.scale;viewport.y=anchor.y-world.y*viewport.scale;clampViewport();syncZoom();redraw();
  }
  function syncZoom(){if($('zoomLevel'))$('zoomLevel').textContent=Math.round(viewport.scale*100)+'%';if($('zoomOutBtn'))$('zoomOutBtn').disabled=viewport.scale<=1;if($('zoomInBtn'))$('zoomInBtn').disabled=viewport.scale>=4;}
  function resetViewport(draw=true){viewport.scale=1;viewport.x=viewport.y=0;syncZoom();if(draw)redraw();}
  function boundedScreen(p, radius = metrics.radius) {
    return {x:clamp(p.x,radius+2,metrics.width-radius-2),y:clamp(p.y,radius+2,metrics.height-radius-2)};
  }
  function fit() {
    if(presentation.active)fitPresentation();
    const r = canvas.getBoundingClientRect();
    if (!r.width) return false; // Hidden auth view: retain valid dimensions.
    const portrait = !presentation.active && mobileQuery.matches;
    const width = Math.round(r.width*64)/64;
    const height = Math.round(width/canvasRatio(portrait)*64)/64;
    const sizeChanged=metrics.portrait!==portrait||Math.abs(metrics.width-width)>1||Math.abs(metrics.height-height)>1;
    if(sizeChanged){cancelInteraction();gesture=null;pointers.clear();resetViewport(false);}
    // Set CSS height before bitmap dimensions, then repaint in the same frame.
    // Ignore visualViewport.height / innerHeight when deciding bitmap size.
    if (canvas.style.height !== height+'px') canvas.style.height = height+'px';
    metrics.width = width; metrics.height = height; metrics.portrait = portrait;
    const markerScale=presentation.active&&state.court==='HALF' ? .025 : .035;
    metrics.radius = clamp(Math.min(width,height)*markerScale,presentation.active?9:11.5,presentation.active?36:18);
    // Limit TV backing-store memory, including a high-DPI or 4K display.
    const dpr = presentation.active
      ? Math.min(window.devicePixelRatio || 1,2,Math.sqrt(16000000/(width*height)))
      : Math.min(window.devicePixelRatio || 1,4);
    const w = Math.max(1,Math.round(width*dpr)), h = Math.max(1,Math.round(height*dpr));
    // Writing either attribute clears the bitmap, even if the value is equal.
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
    return true;
  }
  function redraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {frame=0; if(fit()) render();});
  }
  function repaintAfterScroll() {
    redraw();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(redraw,120);
  }
  function restoreDrawing() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    redraw();
  }
  function drawPitch() {
    ctx.save();
    if (metrics.portrait) { ctx.translate(metrics.width,0); ctx.rotate(Math.PI/2); }
    const w = metrics.portrait ? metrics.height : metrics.width;
    const h = metrics.portrait ? metrics.width : metrics.height;
    const left = .04*w, top = .055*h, pw = .92*w, ph = .805*h;
    const half = state.court === 'HALF', length = half ? 60 : 120;
    const X = m => left + m/length*pw, Y = m => top + m/70*ph;
    ctx.fillStyle = '#183a2c'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = '#28764e'; ctx.fillRect(left,top,pw,ph);
    for (let i=0;i<length/10;i++) {
      ctx.fillStyle = i%2 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.065)';
      ctx.fillRect(left+i*pw/(length/10),top,pw/(length/10),ph);
    }
    ctx.fillStyle='rgba(6,34,25,.18)';ctx.fillRect(X(0),top,pw*10/length,ph);
    if (!half) ctx.fillRect(X(110),top,pw/12,ph);
    const line=(a,b,c,d,dashed=false) => {
      ctx.beginPath();ctx.setLineDash(dashed ? [Math.max(3,w*.009),Math.max(3,w*.007)] : []);
      ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke();
    };
    ctx.strokeStyle='rgba(245,255,246,.8)';ctx.lineWidth=Math.max(1,w*.0018);
    ctx.setLineDash([]);ctx.strokeRect(left,top,pw,ph);
    (half ? [10,32,60] : [10,32,60,88,110]).forEach(m=>line(X(m),Y(0),X(m),Y(70)));
    (half ? [15,50] : [15,50,70,105]).forEach(m=>line(X(m),Y(0),X(m),Y(70),true));
    [5,15,55,65].forEach(m=>line(X(15),Y(m),X(half?60:105),Y(m),true));
    ctx.setLineDash([]);
    (half ? [10] : [10,110]).forEach(m=>{
      const dx=pw*.011,dy=ph*.065;
      ctx.strokeStyle='#ffffff';ctx.lineWidth=Math.max(2,w*.003);
      line(X(m)-dx,Y(35)-dy,X(m)+dx,Y(35)-dy);
      line(X(m)-dx,Y(35)+dy,X(m)+dx,Y(35)+dy);
      line(X(m),Y(35)-dy,X(m),Y(35)+dy);
    });
    ctx.fillStyle='rgba(238,255,243,.6)';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font=`600 ${clamp(w*.013,8,metrics.radius>18?24:12)}px system-ui,sans-serif`;
    (half ? [[32,'22'],[60,'50']] : [[32,'22'],[60,'50'],[88,'22']]).forEach(([m,label])=>ctx.fillText(label,X(m),top*.47));
    ctx.fillStyle='rgba(235,246,243,.55)';ctx.font=`${clamp(w*.011,8,metrics.radius>18?22:11)}px system-ui,sans-serif`;
    ctx.fillText('BENCH',w*.07,h*.94);
    ctx.restore();
  }
  function drawArrow(a, preview=false) {
    const from=screen(a.from),to=screen(a.to);
    const angle=Math.atan2(to.y-from.y,to.x-from.x),head=clamp(metrics.radius*.75,8,metrics.radius>18?26:13);
    const weight=clamp(metrics.radius/6,3,6);
    const shade=color(a.color,DEFAULT_ARROW);
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=preview ? 0.85 : 1;
    ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);
    ctx.lineTo(to.x-head*Math.cos(angle-Math.PI/6),to.y-head*Math.sin(angle-Math.PI/6));
    ctx.moveTo(to.x,to.y);ctx.lineTo(to.x-head*Math.cos(angle+Math.PI/6),to.y-head*Math.sin(angle+Math.PI/6));
    ctx.strokeStyle=/^#(111820|171b22|000000|000)$/i.test(shade)?'rgba(255,255,255,.8)':'rgba(8,27,27,.6)';
    ctx.lineWidth=weight*2;ctx.stroke();ctx.strokeStyle=shade;ctx.lineWidth=weight;ctx.stroke();ctx.restore();
  }
  function inkWidth(stroke){return Math.max(1,stroke.width*Math.min(metrics.width,metrics.height)/700);}
  function drawStroke(stroke){
    if(!stroke.points.length)return;
    const width=inkWidth(stroke),shade=color(stroke.color,'#ffffff');
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=shade;ctx.fillStyle=shade;
    if(/^#(?:000|000000|111820|171b22)$/i.test(shade)){ctx.shadowColor='#ffffffb3';ctx.shadowBlur=1.5;}
    const first=screen(stroke.points[0]);
    if(stroke.points.length===1){ctx.beginPath();ctx.arc(first.x,first.y,width/2,0,Math.PI*2);ctx.fill();}
    else{ctx.beginPath();ctx.moveTo(first.x,first.y);for(let i=1;i<stroke.points.length;i++){const p=screen(stroke.points[i]);ctx.lineTo(p.x,p.y);}ctx.lineWidth=width;ctx.stroke();}
    ctx.restore();
  }
  function drawPlayer(p,bench=false,selected=false) {
    const {x,y}=screen(p),r=metrics.radius*(bench ? 0.86 : 1);
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.3)';ctx.shadowBlur=3;ctx.shadowOffsetY=2;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();
    ctx.shadowColor='transparent';ctx.lineWidth=1.4;ctx.strokeStyle='#e9f1f3';ctx.stroke();
    if(selected){ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.strokeStyle='#76e4bd';ctx.lineWidth=2;ctx.stroke();}
    ctx.fillStyle=bench ? '#17202b' : markerInk(p.color);
    ctx.font=`700 ${clamp(r*.94,11,metrics.radius>18?32:15)}px system-ui,-apple-system,sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.no),x,y+.5);ctx.restore();
  }
  function ballPath(a,b) {
    ctx.beginPath();ctx.moveTo(-a,0);
    ctx.bezierCurveTo(-a*.62,-b*1.34,a*.62,-b*1.34,a,0);
    ctx.bezierCurveTo(a*.62,b*1.34,-a*.62,b*1.34,-a,0);ctx.closePath();
  }
  function drawBall() {
    const p=screen(state.ball),a=metrics.radius*1.4,b=metrics.radius*.83;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(-.45);
    ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=5;ctx.shadowOffsetY=3;
    const gradient=ctx.createLinearGradient(0,-b,0,b);
    gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.4,'#fffdf5');gradient.addColorStop(1,'#b9c6c0');
    ballPath(a,b);ctx.fillStyle=gradient;ctx.fill();ctx.shadowColor='transparent';
    ctx.lineWidth=1;ctx.strokeStyle='#1f3531';ctx.stroke();
    ctx.save();ballPath(a,b);ctx.clip();
    // Coloured end panels, thin turquoise piping and rubber grip.
    [-1,1].forEach(sign=>{
      ctx.save();ctx.scale(sign,1);ctx.beginPath();ctx.moveTo(a*.42,-b*1.15);
      ctx.bezierCurveTo(a*.2,-b*.3,a*.4,b*.35,a*.65,b*1.1);
      ctx.lineTo(a*1.3,b*1.1);ctx.lineTo(a*1.3,-b*1.15);ctx.closePath();ctx.fillStyle='#163c65';ctx.fill();
      ctx.beginPath();ctx.moveTo(a*.28,-b);ctx.bezierCurveTo(a*.1,-b*.4,a*.24,b*.4,a*.49,b);
      ctx.strokeStyle='#23b99c';ctx.lineWidth=2;ctx.stroke();ctx.restore();
    });
    ctx.fillStyle='rgba(26,58,60,.13)';
    for(let row=-2;row<=2;row++)for(let col=-4;col<=4;col++){
      ctx.beginPath();ctx.arc(col*a*.13,row*b*.27,.5,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();ctx.moveTo(-a*.37,-b*.05);ctx.quadraticCurveTo(0,-b*.23,a*.37,-b*.05);
    ctx.strokeStyle='#75857f';ctx.lineWidth=1;ctx.stroke();
    ctx.strokeStyle='#fefefe';ctx.lineWidth=1.1;ctx.lineCap='round';
    for(let i=-2;i<=2;i++) {const x=i*a*.12;ctx.beginPath();ctx.moveTo(x,-b*.30);ctx.lineTo(x,-b*.02);ctx.stroke();}
    ctx.restore();
  }
  function visibleTargets() {
    const targets=[];
    const add=(list,side)=>list.forEach((p,index)=>{
      if(p.role==='BENCH' ? state.view==='ALL' : state.view==='ALL'||state.view===p.role) targets.push({p,list,side,index});
    });
    if(state.side!=='OPP'){add(state.allies,'ALLY');add(state.bench,'BENCH');}
    if(state.side!=='ALLY')add(state.opps,'OPP');
    return targets;
  }
  function render() {
    ctx.clearRect(0,0,metrics.width,metrics.height);ctx.fillStyle='#183a2c';ctx.fillRect(0,0,metrics.width,metrics.height);
    ctx.save();ctx.translate(viewport.x,viewport.y);ctx.scale(viewport.scale,viewport.scale);drawPitch();
    state.strokes.forEach(drawStroke);
    if(interaction?.kind==='pen')drawStroke(interaction.stroke);
    state.arrows.forEach(a=>drawArrow(a));
    if(interaction?.kind==='arrow')drawArrow(interaction.arrow,true);
    visibleTargets().forEach(t=>drawPlayer(t.p,t.side==='BENCH',interaction?.target?.p===t.p));
    drawBall();
    ctx.restore();
  }
  function pick(p,pointerType='mouse') {
    const candidates=visibleTargets().map(t=>({...t,kind:'player',distance:Math.hypot(screen(t.p).x-p.x,screen(t.p).y-p.y)}));
    const bp=screen(state.ball);
    candidates.push({kind:'ball',distance:Math.hypot(bp.x-p.x,bp.y-p.y)});
    candidates.sort((a,b)=>a.distance-b.distance);
    const target=candidates[0];
    const tolerance=pointerType==='mouse'?metrics.radius+5/viewport.scale:Math.max(23/viewport.scale,metrics.radius+10/viewport.scale);
    return target&&target.distance<=tolerance?target:null;
  }
  function hitArrow(p) {
    let best=null,distance=14/viewport.scale;
    state.arrows.forEach((a,index)=>{
      const u=screen(a.from),v=screen(a.to),dx=v.x-u.x,dy=v.y-u.y;
      const t=clamp(((p.x-u.x)*dx+(p.y-u.y)*dy)/(dx*dx+dy*dy||1),0,1);
      const d=Math.hypot(p.x-u.x-t*dx,p.y-u.y-t*dy);
      if(d<=distance){distance=d;best=index;}
    });return best;
  }
  function pointSegmentDistance2(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
    return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
  }
  function segmentsNear(a,b,c,d,radius){
    if(Math.max(a.x,b.x)+radius<Math.min(c.x,d.x)||Math.min(a.x,b.x)-radius>Math.max(c.x,d.x)||Math.max(a.y,b.y)+radius<Math.min(c.y,d.y)||Math.min(a.y,b.y)-radius>Math.max(c.y,d.y))return false;
    const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y,den=ux*vy-uy*vx;
    if(Math.abs(den)>1e-9){const t=((c.x-a.x)*vy-(c.y-a.y)*vx)/den,u=((c.x-a.x)*uy-(c.y-a.y)*ux)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return true;}
    return Math.min(pointSegmentDistance2(a,c,d),pointSegmentDistance2(b,c,d),pointSegmentDistance2(c,a,b),pointSegmentDistance2(d,a,b))<=radius*radius;
  }
  function eraseInk(from,to){
    const count=state.strokes.length;
    state.strokes=state.strokes.filter(stroke=>{
      const radius=12/viewport.scale+inkWidth(stroke)/2;
      for(let i=0;i<stroke.points.length;i++){const a=screen(stroke.points[Math.max(0,i-1)]),b=screen(stroke.points[i]);if(segmentsNear(from,to,a,b,radius))return false;}
      return true;
    });
    return count!==state.strokes.length;
  }
  function appendInk(e){
    const active=interaction;if(active?.kind!=='pen'||active.limited)return;
    const events=typeof e.getCoalescedEvents==='function'?e.getCoalescedEvents():[];
    for(const event of [...events,e]){
      const p=inkPoint(field(pointer(event))),previous=screen(active.stroke.points.at(-1)),next=screen(p);
      if(Math.hypot(next.x-previous.x,next.y-previous.y)*viewport.scale<1.2)continue;
      if(active.stroke.points.length>=active.room){active.limited=true;inkNotice=active.room===INK_LIMITS.pointsPerStroke?'この線は長さの上限です。指を離して続きを描いてください。':'落書きの上限に達しました。指を離し、線を消すか別のプレーに描いてください。';syncUI();break;}
      active.stroke.points.push(p);
    }
  }
  function clearStrokes(){
    if(readOnly)return;
    cancelInteraction();if(!state.strokes.length)return;
    remember(snapshot());state.strokes=[];inkNotice='';syncUI();redraw();changed('ink-clear');
  }
  function startGesture() {
    // Roll back a first-finger drag before starting a two-finger viewport gesture.
    if(interaction){const before=interaction.before;interaction=null;if(before)Object.assign(state,before);renderRoster();}
    const [a,b]=[...pointers.values()];
    const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    gesture={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale:viewport.scale,anchor:{x:(center.x-viewport.x)/viewport.scale,y:(center.y-viewport.y)/viewport.scale}};
    canvas.classList.remove('is-dragging');redraw();
  }
  function moveGesture() {
    if(!gesture||pointers.size<2)return;
    const [a,b]=[...pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    viewport.scale=clamp(gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance,1,4);
    viewport.x=center.x-gesture.anchor.x*viewport.scale;viewport.y=center.y-gesture.anchor.y*viewport.scale;clampViewport();syncZoom();redraw();
  }
  function onPointerDown(e) {
    if(e.pointerType==='mouse'&&e.button!==0)return;
    if(!fit())return;
    pointers.set(e.pointerId,rawPointer(e));canvas.setPointerCapture(e.pointerId);
    if(pointers.size===2){startGesture();e.preventDefault();return;}
    if(gesture||pointers.size>2||interaction)return;
    const start=pointer(e), before=snapshot();
    if(!readOnly&&state.tool==='pen'){
      inkNotice='';
      const room=Math.min(INK_LIMITS.pointsPerStroke,INK_LIMITS.totalPoints-state.strokes.reduce((sum,s)=>sum+s.points.length,0));
      if(state.strokes.length>=INK_LIMITS.strokes||room<1){inkNotice='落書きの上限です。線を消すか、別のプレーに描いてください。';syncUI();pointers.delete(e.pointerId);canvas.releasePointerCapture(e.pointerId);e.preventDefault();return;}
      interaction={kind:'pen',pointerId:e.pointerId,before,start,room,stroke:{points:[inkPoint(field(start))],color:state.penColor,width:state.penWidth}};
    } else if(!readOnly&&state.tool==='inkErase'){
      interaction={kind:'inkErase',pointerId:e.pointerId,before,start,last:start,erased:eraseInk(start,start)};
    } else if(!readOnly&&state.tool==='erase') {
      interaction={kind:'erase',pointerId:e.pointerId,before,start,index:hitArrow(start)};
    } else if(!readOnly&&state.tool==='arrow') {
      const p=point(field(start));
      interaction={kind:'arrow',pointerId:e.pointerId,before,start,arrow:{from:p,to:{...p},color:state.arrowColor}};
    } else {
      const target=readOnly?null:state.tool==='ball'?{kind:'ball'}:pick(start,e.pointerType);
      if(!target){if(viewport.scale>1)interaction={kind:'pan',pointerId:e.pointerId,start:rawPointer(e),x:viewport.x,y:viewport.y};return;}
      const position=target.kind==='ball'?screen(state.ball):screen(target.p);
      interaction={kind:target.kind,pointerId:e.pointerId,before,start,target,offset:{x:position.x-start.x,y:position.y-start.y}};
      if(state.tool==='ball'&&Math.hypot(position.x-start.x,position.y-start.y)>metrics.radius*1.8) {
        interaction.offset={x:0,y:0};state.ball=point(field(boundedScreen(start)));
      }
    }
    canvas.setPointerCapture(e.pointerId);canvas.classList.add('is-dragging');e.preventDefault();redraw();
  }
  function moveInteraction(e) {
    if(!interaction||e.pointerId!==interaction.pointerId)return;
    const p=pointer(e);
    if(interaction.kind==='pan'){const raw=rawPointer(e);viewport.x=interaction.x+raw.x-interaction.start.x;viewport.y=interaction.y+raw.y-interaction.start.y;clampViewport();}
    else if(interaction.kind==='pen')appendInk(e);
    else if(interaction.kind==='inkErase'){interaction.erased=eraseInk(interaction.last,p)||interaction.erased;interaction.last=p;}
    else if(interaction.kind==='erase'){}
    else if(interaction.kind==='arrow') interaction.arrow.to=point(field(boundedScreen(p,3)));
    else {
      const next=point(field(boundedScreen({x:p.x+interaction.offset.x,y:p.y+interaction.offset.y})));
      if(interaction.kind==='ball')state.ball=next;else Object.assign(interaction.target.p,next);
    }
    e.preventDefault();redraw();
  }
  function onPointerMove(e) {
    if(pointers.has(e.pointerId))pointers.set(e.pointerId,rawPointer(e));
    if(gesture){moveGesture();e.preventDefault();return;}
    if(interaction){moveInteraction(e);return;}
    if(e.pointerType==='mouse')canvas.style.cursor=['arrow','pen','inkErase'].includes(state.tool)?'crosshair':pick(pointer(e),'mouse')?'grab':'default';
  }
  function finishInteraction(e) {
    pointers.delete(e.pointerId);
    if(gesture){if(!pointers.size)gesture=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);redraw();return;}
    if(!interaction||interaction.pointerId!==e.pointerId){if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);return;}
    moveInteraction(e);
    const active=interaction;
    let committed=false;
    if(active.kind==='pan'){}
    else if(active.kind==='pen'){remember(active.before);state.strokes.push(clone(active.stroke));committed=true;}
    else if(active.kind==='inkErase'){if(active.erased){remember(active.before);committed=true;}}
    else if(active.kind==='erase') {
      const p=pointer(e);
      if(active.index!==null&&hitArrow(p)===active.index&&Math.hypot(p.x-active.start.x,p.y-active.start.y)*viewport.scale<16){remember(active.before);state.arrows.splice(active.index,1);committed=true;}
    } else if(active.kind==='arrow') {
      const a=screen(active.arrow.from),b=screen(active.arrow.to);
      if(Math.hypot(a.x-b.x,a.y-b.y)*viewport.scale>=8){remember(active.before);state.arrows.push(clone(active.arrow));committed=true;}
    } else if(JSON.stringify(active.before)!==JSON.stringify(snapshot())){remember(active.before);committed=true;}
    interaction=null;canvas.classList.remove('is-dragging');
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    syncUI();redraw();if(committed)changed(active.kind);
  }
  function cancelInteraction(e) {
    if(!interaction||(e&&e.pointerId!==interaction.pointerId))return;
    const active=interaction;interaction=null;if(active.before)Object.assign(state,active.before);
    pointers.delete(active.pointerId);
    canvas.classList.remove('is-dragging');
    if(canvas.hasPointerCapture(active.pointerId))canvas.releasePointerCapture(active.pointerId);
    syncUI();renderRoster();redraw();
  }
  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointermove',onPointerMove);
  canvas.addEventListener('pointerup',finishInteraction);
  const pointerCancelled=e=>{pointers.delete(e.pointerId);if(gesture){if(!pointers.size)gesture=null;return;}cancelInteraction(e);};
  canvas.addEventListener('pointercancel',pointerCancelled);
  canvas.addEventListener('lostpointercapture',pointerCancelled);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('dblclick',e=>{
    if(readOnly||!['move','ball'].includes(state.tool))return;
    const target=pick(pointer(e));
    if(target?.kind!=='player')return;
    const result=prompt('背番号（1〜99）',target.p.no);
    if(result===null||result.trim()==='')return;
    if(!/^\d{1,2}$/.test(result)||Number(result)<1){alert('1〜99の数字を入力してください');return;}
    remember(snapshot());target.p.no=Number(result);renderRoster();redraw();changed('number');
  });

  function renderRoster() {
    const roster=$('roster');if(!roster)return;
    roster.replaceChildren();
    const players=state.side==='OPP'?state.opps:state.allies;
    const rows=players.filter(p=>state.view==='ALL'||state.view===p.role);
    if(state.side!=='OPP'&&state.view==='ALL')rows.push(...state.bench);
    [...rows].sort((a,b)=>Number(a.no)-Number(b.no)).forEach(p=>{
      const item=document.createElement('label');item.className='item';
      const marker=document.createElement('span');marker.className='marker';marker.style.setProperty('--color',p.color);marker.textContent=String(p.no);
      const ink = p.role==='BENCH' ? '#17202b' : markerInk(p.color);
      marker.style.backgroundColor=p.color;
      marker.style.color=ink;
      if(ink==='#17202b')marker.classList.add('is-white');
      const input=document.createElement('input');input.type='text';input.value=p.name||'';input.placeholder='選手名';input.setAttribute('aria-label',`${state.side==='OPP'?'相手':'自チーム'} ${p.no}番の名前`);
      input.disabled=readOnly;input.addEventListener('input',()=>{p.name=input.value;changed('name');});
      item.append(marker,input);roster.append(item);
    });
  }
  function syncUI() {
    if($('unitSelect'))$('unitSelect').value=String(state.unit);
    if($('groupSelect'))$('groupSelect').value=state.view;
    if($('sideSelect'))$('sideSelect').value=state.side;
    if($('courtSelect'))$('courtSelect').value=state.court;
    document.querySelector('.board-section')?.classList.toggle('is-half-court',state.court==='HALF');
    if($('undoBtn'))$('undoBtn').disabled=readOnly||history.length===0;
    if($('redoBtn'))$('redoBtn').disabled=readOnly||future.length===0;
    if($('tvUndoBtn'))$('tvUndoBtn').disabled=readOnly||history.length===0;
    if($('tvRedoBtn'))$('tvRedoBtn').disabled=readOnly||future.length===0;
    if($('clearInkBtn'))$('clearInkBtn').disabled=readOnly||state.strokes.length===0;
    document.querySelectorAll('[data-tool]').forEach(b=>{
      const active=b.dataset.tool===state.tool;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
    });
    if($('arrowOptions'))$('arrowOptions').hidden=state.tool!=='arrow';
    let label='カスタム';
    document.querySelectorAll('[data-arrow-color]').forEach(b=>{
      const active=b.dataset.arrowColor.toLowerCase()===state.arrowColor.toLowerCase();b.setAttribute('aria-pressed',String(active));if(active)label=b.dataset.colorName;
    });
    if($('arrowColorName'))$('arrowColorName').textContent=label;
    if($('arrowColor')&&/^#[0-9a-f]{6}$/i.test(state.arrowColor))$('arrowColor').value=state.arrowColor;
    if($('penOptions'))$('penOptions').hidden=!['pen','inkErase'].includes(state.tool);
    if($('penColor')&&/^#[0-9a-f]{6}$/i.test(state.penColor))$('penColor').value=state.penColor;
    if($('penWidth'))$('penWidth').value=String(state.penWidth);
    document.querySelectorAll('[data-pen-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.penColor.toLowerCase()===state.penColor.toLowerCase())));
    const penHint=state.tool==='inkErase'?'落書きをなぞると、線ごと消えます。選手と矢印は消しません。':'指・ペン・マウスで手書き。2本指では描かずに拡大・移動します。';
    if($('penHint'))$('penHint').textContent=inkNotice||penHint;
    if($('boardHint'))$('boardHint').textContent=['pen','inkErase'].includes(state.tool)?(inkNotice||penHint):state.tool==='erase'?'消したい矢印をタップ。「戻る」で取り消せます。':state.tool==='arrow'?'ドラッグで矢印。2本指で拡大・移動できます。':state.tool==='ball'?'ボールをドラッグ、または置きたい場所をタップ。':'選手をドラッグ。2本指で盤面を拡大・移動。盤面の外でページをスクロール。';
  }
  function setTool(t) {
    cancelInteraction();inkNotice='';state.tool=['arrow','ball','erase','pen','inkErase'].includes(t)?t:'move';syncUI();redraw();
  }
  function setArrowColor(value) {
    state.arrowColor=color(value);syncUI();redraw();
  }
  function setPenColor(value){state.penColor=color(value,'#ffffff');syncUI();}
  function setPenWidth(value){state.penWidth=[2,4,8].includes(Number(value))?Number(value):4;syncUI();}
  function setView(v) {
    cancelInteraction();state.view=['FW','BK'].includes(v)?v:'ALL';syncUI();renderRoster();redraw();
  }
  function setSide(v) {
    cancelInteraction();state.side=['ALLY','OPP'].includes(v)?v:'BOTH';syncUI();renderRoster();redraw();
  }
  function setCourt(value) {
    if(readOnly)return;
    cancelInteraction();
    const next = value==='HALF' ? 'HALF' : 'FULL';
    if (next===state.court) return;
    remember(snapshot());state.court=next;syncUI();redraw();
    changed('court');
  }
  function toggleFocus(force) {
    cancelInteraction();
    const focused=typeof force==='boolean'?force:!document.body.classList.contains('board-focus');
    document.body.classList.toggle('board-focus',focused);
    const button=$('focusBoardBtn');if(button){button.textContent=focused?'拡大を閉じる':'盤面を拡大';button.setAttribute('aria-pressed',String(focused));}
    redraw();
  }
  function fullscreenElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
  function syncPresentation(){
    if($('fullscreenBoardBtn'))$('fullscreenBoardBtn').setAttribute('aria-pressed',String(presentation.active));
    if($('tvHeader'))$('tvHeader').hidden=!presentation.active;
    if($('tvModeLabel'))$('tvModeLabel').textContent=presentation.native?'TV / 全画面表示':'TV / 画面内表示';
    if($('tvPlayTitle'))$('tvPlayTitle').textContent=$('playTitle')?.value.trim()||'ラグビー戦術ノート';
    if($('tvCourtLabel'))$('tvCourtLabel').textContent=(state.court==='HALF'?'半コート':'全コート')+' · '+(state.tool==='pen'?'自由に手書き':state.tool==='inkErase'?'落書きを線ごと消去':'選手をドラッグして移動')+' · Escで終了';
  }
  function fitPresentation(){
    syncPresentation();
    const rect=boardSection.getBoundingClientRect();
    const style=window.getComputedStyle?.(boardSection);
    const padding=name=>parseFloat(style?.[name])||12;
    const width=boardSection.clientWidth||rect.width||window.innerWidth||metrics.width;
    const height=boardSection.clientHeight||rect.height||window.innerHeight;
    const headerHeight=$('tvHeader')?.getBoundingClientRect().height||56;
    const penOptions=$('penOptions'),optionsHeight=penOptions&&!penOptions.hidden?(penOptions.getBoundingClientRect().height+10):0;
    const availableWidth=Math.max(1,width-padding('paddingLeft')-padding('paddingRight')-2);
    const availableHeight=Math.max(1,height-padding('paddingTop')-padding('paddingBottom')-headerHeight-optionsHeight-12);
    // Account for the container border. Do not stretch or crop either court.
    boardContainer.style.width=(Math.min(availableWidth,availableHeight*canvasRatio(false))+2)+'px';
  }
  async function leaveNativeFullscreen(){
    if(fullscreenElement()!==boardSection)return;
    try{
      const exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(exit)await exit.call(document);
    }catch{/* Browser/OS may already be leaving fullscreen. */}
  }
  async function enterPresentation(){
    if(!boardSection||presentation.active||presentation.pending||presentation.exiting)return;
    cancelInteraction();
    presentation.previousFocus=document.body.classList.contains('board-focus');
    presentation.previousTool=state.tool;
    presentation.returnFocus=document.activeElement||$('fullscreenBoardBtn');
    presentation.containerWidth=boardContainer.style.width||'';
    presentation.background=[$('appHeader'),document.querySelector('.sidebar')].filter(Boolean).map(element=>({element,inert:element.inert}));
    presentation.background.forEach(({element})=>{element.inert=true;});
    toggleFocus(false);
    presentation.active=true;presentation.native=false;
    document.body.classList.add('tv-mode');boardSection.classList.add('is-tv-mode');
    resetViewport(false);setTool('move');syncPresentation();
    $('exitFullscreenBtn')?.focus({preventScroll:true});
    // Invoke synchronously from the click to preserve browser user activation.
    const request=typeof boardSection.requestFullscreen==='function'&&document.fullscreenEnabled!==false
      ? ()=>boardSection.requestFullscreen({navigationUI:'hide'})
      : typeof boardSection.webkitRequestFullscreen==='function'&&document.webkitFullscreenEnabled!==false
        ? ()=>boardSection.webkitRequestFullscreen() : null;
    if(!request)return;
    presentation.pending=true;
    if($('fullscreenBoardBtn'))$('fullscreenBoardBtn').disabled=true;
    try{
      await request();
      if(!presentation.active){await leaveNativeFullscreen();return;}
      presentation.native=fullscreenElement()===boardSection;
    }catch{
      // Unsupported, denied or embedded: keep a usable page-filling TV view.
      if(presentation.active)presentation.native=false;
    }finally{
      presentation.pending=false;
      if($('fullscreenBoardBtn'))$('fullscreenBoardBtn').disabled=presentation.exiting;
      syncPresentation();redraw();
    }
  }
  async function exitPresentation({restoreFocus=true,restoreFocusMode=true}={}){
    if(!presentation.active)return leaveNativeFullscreen();
    cancelInteraction();presentation.active=false;presentation.native=false;
    document.body.classList.remove('tv-mode');boardSection.classList.remove('is-tv-mode');
    boardContainer.style.width=presentation.containerWidth;
    presentation.background.forEach(({element,inert})=>{element.inert=inert;});presentation.background=[];
    resetViewport(false);setTool(presentation.previousTool);
    toggleFocus(restoreFocusMode&&presentation.previousFocus);syncPresentation();
    const returnFocus=presentation.returnFocus;
    presentation.exiting=fullscreenElement()===boardSection;
    if($('fullscreenBoardBtn'))$('fullscreenBoardBtn').disabled=presentation.pending||presentation.exiting;
    try{await leaveNativeFullscreen();}finally{
      presentation.exiting=false;
      if($('fullscreenBoardBtn'))$('fullscreenBoardBtn').disabled=presentation.pending;
      if(restoreFocus&&!presentation.active)returnFocus?.focus({preventScroll:true});
    }
  }
  function fullscreenChanged(){
    if(fullscreenElement()===boardSection){
      if(!presentation.active){void leaveNativeFullscreen();return;}
      presentation.native=true;syncPresentation();redraw();
    }else if(presentation.active&&presentation.native){
      void exitPresentation();
    }
  }
  document.querySelector('.controls')?.addEventListener('click',e=>{const button=e.target.closest('[data-tool]');if(button)setTool(button.dataset.tool);});
  $('tvTools')?.addEventListener('click',e=>{const button=e.target.closest('[data-tool]');if(button)setTool(button.dataset.tool);});
  $('arrowPalette')?.addEventListener('click',e=>{const b=e.target.closest('[data-arrow-color]');if(b)setArrowColor(b.dataset.arrowColor);});
  $('arrowColor')?.addEventListener('input',e=>setArrowColor(e.target.value));
  $('penPalette')?.addEventListener('click',e=>{const b=e.target.closest('[data-pen-color]');if(b)setPenColor(b.dataset.penColor);});
  $('penColor')?.addEventListener('input',e=>setPenColor(e.target.value));
  $('penWidth')?.addEventListener('change',e=>setPenWidth(e.target.value));
  $('clearInkBtn')?.addEventListener('click',clearStrokes);
  $('undoBtn')?.addEventListener('click',undo);
  $('redoBtn')?.addEventListener('click',redo);
  $('tvUndoBtn')?.addEventListener('click',undo);
  $('tvRedoBtn')?.addEventListener('click',redo);
  $('zoomInBtn')?.addEventListener('click',()=>zoomTo(viewport.scale*1.25));
  $('zoomOutBtn')?.addEventListener('click',()=>zoomTo(viewport.scale/1.25));
  $('zoomResetBtn')?.addEventListener('click',()=>resetViewport());
  $('unitSelect')?.addEventListener('change',e=>reset(e.target.value));
  $('groupSelect')?.addEventListener('change',e=>setView(e.target.value));
  $('sideSelect')?.addEventListener('change',e=>setSide(e.target.value));
  $('courtSelect')?.addEventListener('change',e=>setCourt(e.target.value));
  $('resetPositions')?.addEventListener('click',()=>reset(state.unit));
  $('focusBoardBtn')?.addEventListener('click',()=>toggleFocus());
  $('fullscreenBoardBtn')?.addEventListener('click',()=>{void enterPresentation();});
  $('exitFullscreenBtn')?.addEventListener('click',()=>{void exitPresentation();});
  $('tvResetViewBtn')?.addEventListener('click',()=>resetViewport());
  $('playTitle')?.addEventListener('input',syncPresentation);
  document.addEventListener('fullscreenchange',fullscreenChanged);
  document.addEventListener('webkitfullscreenchange',fullscreenChanged);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(presentation.active)void exitPresentation();else toggleFocus(false);}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&e.target===canvas){e.preventDefault();undo();}
  });
  window.addEventListener('resize',redraw);
  window.addEventListener('scroll',repaintAfterScroll,{passive:true});
  window.addEventListener('orientationchange',restoreDrawing);
  window.addEventListener('pageshow',restoreDrawing);
  window.visualViewport?.addEventListener('resize',repaintAfterScroll,{passive:true});
  window.visualViewport?.addEventListener('scroll',repaintAfterScroll,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)restoreDrawing();});
  // Safari can discard the backing store while scrolling or switching apps.
  // State is kept outside the canvas; rebuild the entire scene on restoration.
  canvas.addEventListener('contextrestored',restoreDrawing);
  if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',redraw);
  if('ResizeObserver' in window)new ResizeObserver(redraw).observe(canvas);
  function setReadOnly(value){readOnly=!!value;if(readOnly)cancelInteraction();syncUI();renderRoster();}
  async function exportPNG({title='',notes=''}={}) {
    const scene=document.createElement('canvas');scene.width=1400;scene.height=Math.round(1400/canvasRatio(false));
    const original={ctx,metrics:{...metrics},viewport:{...viewport}};
    try {
      ctx=scene.getContext('2d');Object.assign(metrics,{width:scene.width,height:scene.height,portrait:false,radius:18});
      viewport.scale=1;viewport.x=viewport.y=0;render();
    } finally {ctx=original.ctx;Object.assign(metrics,original.metrics);Object.assign(viewport,original.viewport);}
    const out=document.createElement('canvas'),o=out.getContext('2d'),lines=[];
    o.font='24px sans-serif';
    for(const paragraph of String(notes).split('\n')) {
      let line='';for(const character of paragraph){if(o.measureText(line+character).width>1320){lines.push(line);line='';}line+=character;}lines.push(line);
    }
    const visible=lines.slice(0,8);if(lines.length>8)visible[7]+='…';
    out.width=1400;out.height=scene.height+100+(notes?visible.length*32+32:0);
    o.fillStyle='#0c1521';o.fillRect(0,0,out.width,out.height);o.fillStyle='#edf4f8';o.font='700 32px sans-serif';
    o.fillText(String(title||'ラグビー戦術ノート').slice(0,60),36,54,1328);o.drawImage(scene,0,100);
    o.font='24px sans-serif';visible.forEach((line,i)=>{if(notes)o.fillText(line,36,scene.height+140+i*32);});
    return new Promise((resolve,reject)=>out.toBlob(blob=>blob?resolve(blob):reject(new Error('画像を書き出せませんでした')),'image/png'));
  }
  window.BoardAPI={reset,setView,setSide,setCourt,setTool,setArrowColor,setPenColor,setPenWidth,clearStrokes,getState:snapshot,setState,redraw,undo,redo,applyTemplate,getInitialState,setReadOnly,exportPNG,zoomTo,resetViewport,getViewport:()=>({...viewport}),enterPresentation,exitPresentation,getPresentation:()=>({active:presentation.active,native:presentation.native,pending:presentation.pending,exiting:presentation.exiting})};
  reset(15,false);
})();
