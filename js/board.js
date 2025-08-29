// js/board.js  — できるだけ既存の形を維持した再実装
(() => {
  const canvas = document.getElementById('board');
  const ctx    = canvas.getContext('2d');

  // ===== 状態 =====
  const state = {
    unit: 15,           // 15 or 12
    view: 'ALL',        // 'ALL' | 'FW' | 'BK'
    side: 'BOTH',       // 'BOTH' | 'ALLY' | 'OPP'
    tool: 'move',       // 'move' | 'arrow' | 'ball'
    allies: [],         // 味方: {x,y,role:'FW'|'BK'|'BENCH', no, color}
    opps:   [],         // 敵
    bench:  [],         // ベンチ（描画・保存対象なら保持）
    arrows: [],         // {from:{x,y}, to:{x,y}}  ※正規化で保持
    hover: null,        // {side:'ALLY'|'OPP', idx}
    dragging: null,     // {side, idx}
    drawingArrow: null, // {start:{x,y}, now:{x,y}}
    ball: { x: 0.50, y: 0.50 }, // ボール座標（正規化）
    draggingBall: false,
    _history: []
  };

  // ===== 定数（ピクセル半径は描画専用）=====
  const C = {
    PLAYER_R: 12,
    HIT_R:    14,
    BALL_R:   10,
    MARGIN:   24,
  };

  // ===== 正規化 <-> ピクセル 変換 =====
  function x(t){ return canvas.width  * t; }
  function y(t){ return canvas.height * t; }
  function invX(px){ return px / canvas.width; }
  function invY(py){ return py / canvas.height; }

 // 画面座標 -> キャンバス実ピクセル & 正規化(0..1)
function getPointer(e){
  const r  = canvas.getBoundingClientRect();
  // CSS上の座標 → キャンバス実ピクセル
  const px = (e.clientX - r.left) * (canvas.width  / r.width);
  const py = (e.clientY - r.top ) * (canvas.height / r.height);
  // 正規化（状態はこれで保存）
  const nx = px / canvas.width;
  const ny = py / canvas.height;
  return { px, py, nx, ny };
}

  // ===== ピッチ描画 =====
  // ===== コート描画（実寸比） =====
function drawPitch() {
  const w = canvas.width, h = canvas.height, m = C.MARGIN;
  const L = { left: m, right: w - m, top: m, bottom: h - m };
  const pitchW = L.right - L.left, pitchH = L.bottom - L.top;

  // 実寸（m）
  const DIM = {
    LEN: 100,         // ゴールライン〜ゴールライン
    WID: 70,          // 幅
    IN: 10            // インゴール（片側）
  };
  const TOTAL_X = DIM.LEN + DIM.IN * 2; // 120m
  const TOTAL_Y = DIM.WID;              // 70m

  // 変換: メートル -> キャンバス座標
  const X = (mx) => L.left  + (mx / TOTAL_X) * pitchW;
  const Y = (my) => L.top   + (my / TOTAL_Y) * pitchH;

  // 背景（芝）
  ctx.fillStyle = '#238d23';
  ctx.fillRect(L.left, L.top, pitchW, pitchH);
  // 縞（芝の陰影）
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(L.left + (pitchW / 8) * i, L.top, pitchW / 8, pitchH);
  }

  // 共通線スタイル
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;

  // 小ヘルパー
  const line = (x1,y1,x2,y2) => { ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); };
  const dash = (x1,y1,x2,y2) => { ctx.save(); ctx.setLineDash([10,7]); line(x1,y1,x2,y2); ctx.restore(); };
  const thick = (x1,y1,x2,y2,w) => { ctx.save(); const lw=ctx.lineWidth; ctx.lineWidth=w; line(x1,y1,x2,y2); ctx.lineWidth=lw; ctx.restore(); };

  // ===== 外枠（タッチ & デッドボール）=====
  ctx.strokeRect(L.left, L.top, pitchW, pitchH);

  // ===== 縦方向（長辺方向の線）=====
  // ゴールライン（インゴール10m内側）
  line(X(DIM.IN),      Y(0), X(DIM.IN),      Y(DIM.WID));
  line(X(DIM.IN+DIM.LEN), Y(0), X(DIM.IN+DIM.LEN), Y(DIM.WID));

  // ハーフ
  line(X(DIM.IN + DIM.LEN/2), Y(0), X(DIM.IN + DIM.LEN/2), Y(DIM.WID));

  // 22m
  line(X(DIM.IN + 22),         Y(0), X(DIM.IN + 22),         Y(DIM.WID));
  line(X(DIM.IN + DIM.LEN-22), Y(0), X(DIM.IN + DIM.LEN-22), Y(DIM.WID));

  // 10m（ハーフから±10）
  line(X(DIM.IN + DIM.LEN/2 - 10), Y(0), X(DIM.IN + DIM.LEN/2 - 10), Y(DIM.WID));
  line(X(DIM.IN + DIM.LEN/2 + 10), Y(0), X(DIM.IN + DIM.LEN/2 + 10), Y(DIM.WID));

  // 5m（各ゴールラインから5m）…破線
  dash(X(DIM.IN + 5),           Y(0), X(DIM.IN + 5),           Y(DIM.WID));
  dash(X(DIM.IN + DIM.LEN - 5), Y(0), X(DIM.IN + DIM.LEN - 5), Y(DIM.WID));

  // ===== 横方向（短辺方向の線）=====
  // 5m / 15m ライン（タッチから内側へ）…破線
  dash(X(0), Y(5),  X(TOTAL_X), Y(5));
  dash(X(0), Y(15), X(TOTAL_X), Y(15));
  dash(X(0), Y(TOTAL_Y-15), X(TOTAL_X), Y(TOTAL_Y-15));
  dash(X(0), Y(TOTAL_Y-5),  X(TOTAL_X), Y(TOTAL_Y-5));

  // ===== センターサークル（10m）…破線 =====
  ctx.save();
  ctx.setLineDash([10,7]);
  ctx.beginPath();
  ctx.arc(X(DIM.IN + DIM.LEN/2), Y(DIM.WID/2),
          (10 / TOTAL_Y) * pitchH, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();

  // （お好み）ゴールラインを太めに
  thick(X(DIM.IN),  Y(0), X(DIM.IN),  Y(DIM.WID), 3);
  thick(X(DIM.IN + DIM.LEN), Y(0), X(DIM.IN + DIM.LEN), Y(DIM.WID), 3);
}

  // ===== 描画ユーティリティ =====
  function drawArrowHead(from, to) {
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const len = 12;
    ctx.lineTo(x(to.x) - len * Math.cos(ang - Math.PI/6),
               y(to.y) - len * Math.sin(ang - Math.PI/6));
    ctx.moveTo(x(to.x), y(to.y));
    ctx.lineTo(x(to.x) - len * Math.cos(ang + Math.PI/6),
               y(to.y) - len * Math.sin(ang + Math.PI/6));
  }

  function drawPlayer(p){
    const px = x(p.x), py = y(p.y);
    ctx.beginPath();
    ctx.fillStyle   = p.color;
    ctx.strokeStyle = '#222';
    ctx.lineWidth   = 1.5;
    ctx.arc(px, py, C.PLAYER_R, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    if (p.no != null){
      const isWhite = /#fff/i.test(p.color) || p.color === 'white';
      ctx.fillStyle   = isWhite ? '#111' : '#fff';
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.font        = '12px system-ui, sans-serif';
      ctx.fillText(String(p.no), px, py);
    }
  }

  function drawBall(){
  const {x:bx,y:by} = state.ball;
  ctx.save();
  ctx.translate(x(bx), y(by));
  ctx.rotate(0.35);

  // 本体
  ctx.fillStyle   = '#f8f0d8';
  ctx.strokeStyle = '#222';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.ellipse(0,0, C.BALL_R+8, C.BALL_R, 0, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // サイドパネル色
  ctx.strokeStyle = '#c04';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.ellipse(0,0, C.BALL_R+6, C.BALL_R-2, 0, 0, Math.PI*2);
  ctx.stroke();

  // 縫い目（中央の短い破線）
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4,3]);
  ctx.beginPath();
  ctx.moveTo(-C.BALL_R-4, 0);
  ctx.lineTo( C.BALL_R+4, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  // うっすら影
  const grd = ctx.createRadialGradient(-6,-6,2, 0,0, C.BALL_R+10);
  grd.addColorStop(0, 'rgba(0,0,0,0.10)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(0,0, C.BALL_R+8, C.BALL_R, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

  // ===== 履歴ユーティリティ =====
function snapshot(){
  return JSON.parse(JSON.stringify({
    unit: state.unit,
    view: state.view,
    allies: state.allies,
    opps: state.opps,
    bench: state.bench,
    arrows: state.arrows,
    ball: state.ball
  }));
}

function pushHistory(){
  state._history.push(snapshot());
  if (state._history.length > 50) state._history.shift(); // 履歴は最大50手まで
}

function undo(){
  const prev = state._history.pop();
  if (!prev) return;
  state.unit   = prev.unit;
  state.view   = prev.view;
  state.allies = prev.allies;
  state.opps   = prev.opps;
  state.bench  = prev.bench;
  state.arrows = prev.arrows;
  state.ball   = prev.ball;
  render(); // 描画更新
}

// HTMLの「戻る」ボタンと接続
document.getElementById('undoBtn')?.addEventListener('click', undo);
  
  function render(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawPitch();

    // 矢印（黄色）
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'yellow';
    state.arrows.forEach(a=>{
      ctx.beginPath();
      ctx.moveTo(x(a.from.x), y(a.from.y));
      ctx.lineTo(x(a.to.x),   y(a.to.y));
      drawArrowHead(a.from, a.to);
      ctx.stroke();
    });
    if (state.drawingArrow){
      const a = state.drawingArrow;
      ctx.beginPath();
      ctx.moveTo(x(a.start.x), y(a.start.y));
      ctx.lineTo(x(a.now.x),   y(a.now.y));
      drawArrowHead(a.start, a.now);
      ctx.stroke();
    }

    // プレイヤー描画（view/sideフィルタ適用）
    const filterByView = (p)=> state.view==='ALL' ? true : (p.role===state.view);
    if (state.side !== 'OPP')  state.allies.filter(filterByView).forEach(drawPlayer);
    if (state.side !== 'ALLY') state.opps  .filter(filterByView).forEach(drawPlayer);
  
      // ベンチ描画：味方または両チーム表示のときだけ
    if (state.view === 'ALL' && state.side !== 'OPP') {
      state.bench.forEach(drawPlayer);
    }
    drawBall();
    renderRoster();
  }

  // ===== ヒットテスト =====
  function hit(list, px, py, filter=null){
    for (let i=list.length-1; i>=0; i--){
      const p = list[i];
      if (filter && !filter(p)) continue;
      const dx = x(p.x) - px;
      const dy = y(p.y) - py;
      if (dx*dx + dy*dy <= C.HIT_R*C.HIT_R) return i;
    }
    return null;
  }
  function hitBall(px, py){
    const dx = x(state.ball.x) - px;
    const dy = y(state.ball.y) - py;
    return (dx*dx + dy*dy) <= (C.BALL_R + C.PLAYER_R) ** 2;
  }

  // ===== 初期配置（J SPORTS 画像の向きで、味方=左, 敵=右）=====
  function gridLine(startX, startY, stepX, count, role, startNo, color){
    const arr = [];
    for (let i=0;i<count;i++){
      arr.push({ x: startX + stepX*i, y: startY, role, no: startNo+i, color });
    }
    return arr;
  }

  function makeAllies(unit){
  const FW   = '#e74c3c', BK = '#3498db', BENCH = '#ffffff';
  const leftBand = 0.20;   // 味方の基準X（左20% 付近から）
  const dy = 0.09;         // 縦の間隔
  const cy = 0.50;         // 中央Y

  const A = [];
if (unit === 15){
  // 0〜1 正規化座標で、味方は x<0.49 に収める
  const cy = 0.50, dy = 0.09;
  const L = x => Math.min(x, 0.49 - 0.005); // 相手陣地に入らないクリップ

  // ===== FW（1〜8）=====
  // 1,2,3（フロントロー）横一列：左ハーフ内に
  A.push({ x: L(0.36), y: cy - 1*dy, role:'FW', no:1, color:FW });
  A.push({ x: L(0.40), y: cy - 1*dy, role:'FW', no:2, color:FW });
  A.push({ x: L(0.44), y: cy - 1*dy, role:'FW', no:3, color:FW });

  // 4,5（ロック）縦2枚・少し右寄せ
  A.push({ x: L(0.42), y: cy + 0.00, role:'FW', no:4, color:FW });
  A.push({ x: L(0.46), y: cy + 0.00, role:'FW', no:5, color:FW });

  // 6（ブラインド）上・やや外
  A.push({ x: L(0.28), y: cy - 2*dy, role:'FW', no:6, color:FW });
  // 7（オープン）下・やや外
  A.push({ x: L(0.46), y: cy + 2*dy, role:'FW', no:7, color:FW });

  // 8（No.8）ロックの後ろ
  A.push({ x: L(0.42), y: cy + 1*dy, role:'FW', no:8, color:FW });

  // ===== BK（9〜15）=====
  // 9,10 縦並び（中央レーン）
  A.push({ x: L(0.48), y: cy - 0.04, role:'BK', no: 9, color:BK });
  A.push({ x: L(0.46), y: cy + 0.04, role:'BK', no:10, color:BK });

  // 11,12,13 三人横一列
  A.push({ x: L(0.38), y: cy + 0.18, role:'BK', no:11, color:BK });
  A.push({ x: L(0.42), y: cy + 0.18, role:'BK', no:12, color:BK });
  A.push({ x: L(0.46), y: cy + 0.18, role:'BK', no:13, color:BK });

  // 14（右WTB）
  A.push({ x: L(0.48), y: cy + 0.24, role:'BK', no:14, color:BK });
  // 15（FB）
  A.push({ x: L(0.44), y: cy + 0.30, role:'BK', no:15, color:BK });
}
   else {
    // ===== 12人制（元のロジックを軽調整して流用）=====
    // 1,2,3（横）
    A.push(...gridLine(leftBand + 0.30, cy - 1*dy, 0.04, 3, 'FW', 1, FW));
    // 4,5（縦）
    A.push({ x: leftBand + 0.30, y: cy + 0.00, role:'FW', no:4, color:FW });
    A.push({ x: leftBand + 0.34, y: cy + 0.00, role:'FW', no:5, color:FW });
    // 6（上外）
    A.push({ x: leftBand + 0.06, y: cy - 2*dy, role:'FW', no:6, color:FW });
    // 7,8 は 12人制では除外
    // 9,10
    A.push({ x: leftBand + 0.46, y: cy - 0.04, role:'BK', no:9,  color:BK });
    A.push({ x: leftBand + 0.50, y: cy + 0.04, role:'BK', no:10, color:BK });
    // 11,12,13 横
    A.push(...gridLine(leftBand + 0.38, cy + 0.18, 0.04, 3, 'BK', 11, BK));
    // 14,15 は 12人制では除外
  }

  // ベンチ（16〜23）— 下に白で並べる（既存の描画で色白＆番号表示）
  const BENCH_N = (unit === 12) ? 6 : 8;
  const startNo = unit + 1;        // 12なら13から、15なら16から
  for (let i = 0; i < BENCH_N; i++){
    const no = startNo + i;
    // 画面下に横一列
    const x = 0.08 + i * 0.04;
    const y = 0.92;
    A.push({ x, y, role:'BENCH', no, color: BENCH });
  }
  return A;
}

  function makeOpponents(unit){
    const PURPLE = '#8e44ad';
    return makeAllies(unit)
    .filter(p => p.role !== 'BENCH')
    
    // role（FW/BK）は維持したまま、色と左右反転だけ変える
    .map(p => ({ x: 1 - p.x, y: p.y, role: p.role, no: p.no, color: PURPLE }));
  }

  function reset(unit = state.unit){
    state.unit = unit;
    state.allies = makeAllies(unit);
    state.opps   = makeOpponents(unit);
    state.bench  = state.allies.filter(p => p.role === 'BENCH');
    state.allies = state.allies.filter(p => p.role !== 'BENCH');

    // 12人のときは 6,7,8 を外す（FW）
    if (unit === 12){
      const drop = new Set([6,7,8]);
      state.allies = state.allies.filter(p => !drop.has(p.no));
      state.opps   = state.opps  .filter(p => !drop.has(p.no));
    }

    state.arrows = [];
    state.hover  = state.dragging = state.drawingArrow = null;
    state.draggingBall = false;
    state.ball   = { x: 0.50, y: 0.50 };

    render();
  }

  // ===== API 露出 =====
  window.BoardAPI = {
    reset,
    setView(v){ state.view = (v==='FW'||v==='BK') ? v : 'ALL'; render(); },
    setSide(s){ state.side = (s==='ALLY'||s==='OPP') ? s : 'BOTH'; render(); },
    setTool(t){ state.tool = (t==='arrow'||t==='ball') ? t : 'move'; },
    getState(){ return {
      unit:state.unit, view:state.view, side:state.side,
      allies:state.allies, opps:state.opps, arrows:state.arrows, ball:state.ball
    }; },
    setState(s={}){
      if (s.unit) state.unit = s.unit;
      if (s.view) state.view = s.view;
      if (s.side) state.side = s.side;
      if (Array.isArray(s.allies)) state.allies = s.allies;
      if (Array.isArray(s.opps))   state.opps   = s.opps;
      if (Array.isArray(s.arrows)) state.arrows = s.arrows;
      if (s.ball) state.ball = s.ball;
      render();
    }
  };

  // ===== ツールバー（index.html の .controls）=====
  const controls = document.querySelector('.controls');
  controls?.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-tool]'); if(!btn) return;
    controls.querySelectorAll('[data-tool].active').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    window.BoardAPI.setTool(btn.dataset.tool);
  });

  // mousemove
canvas.addEventListener('mousemove', (e) => {
  const {px, py, nx, ny} = getPointer(e);

  // 矢印描画中
  if (state.drawingArrow){
    state.drawingArrow.now = { x:nx, y:ny };
    render(); return;
  }
  // ボールドラッグ中
  if (state.draggingBall){
    state.ball = { x:nx, y:ny };
    render(); return;
  }
  // プレイヤードラッグ中（ALLY / OPP / BENCH）
  if (state.dragging != null){
    const list =
      state.dragging.side === 'ALLY' ? state.allies :
      state.dragging.side === 'OPP'  ? state.opps   :
      state.bench;
    const p = list[state.dragging.idx];
    p.x = nx; p.y = ny;
    render(); return;
  }

  // ---- ホバー判定（ここは関数の中）----
  let h = null;
  const viewFilter = p => state.view === 'ALL' ? true : p.role === state.view;

  if (state.side !== 'OPP'){
    const i = hit(state.allies, px, py, viewFilter);
    if (i != null) h = { side:'ALLY', idx:i };
  }
  if (!h && state.side !== 'ALLY'){
    const i = hit(state.opps, px, py, viewFilter);
    if (i != null) h = { side:'OPP', idx:i };
  }
  // ベンチは ALL の時だけ触れる
  if (!h && state.view === 'ALL'){
    const i = hit(state.bench, px, py);
    if (i != null) h = { side:'BENCH', idx:i };
  }

  state.hover = h;
  canvas.style.cursor = h ? 'grab' : 'default';
  render();
});

// mousedown
canvas.addEventListener('mousedown', (e) => {
   const {px, py, nx, ny} = getPointer(e);

  if (state.tool==='arrow'){
    // ★正規化で開始/現在を持つ
    state.drawingArrow = { start:{x:nx,y:ny}, now:{x:nx,y:ny} };
    render();
    return;
  }
  if (state.tool==='ball' && hitBall(px,py)){
    state.draggingBall = true;
    pushHistory();              // ★直前保存
    render();
    return;
  }
  if (state.hover){             // プレイヤー掴む
    state.dragging = state.hover;
    pushHistory();              // ★直前保存
    render();
  }
});

// mouseup
canvas.addEventListener('mouseup', (e) => {
  if (state.dragging){ state.dragging=null; render(); return; }
  if (state.draggingBall){ state.draggingBall=false; render(); return; }
  if (state.drawingArrow){
    // ★矢印確定（正規化のまま配列へ）
    state.arrows.push({ from: state.drawingArrow.start, to: state.drawingArrow.now });
    state.drawingArrow = null;
    pushHistory();              // ★直前保存（確定したので）
    render(); return;
  }
});

  // ★ ダブルクリック：番号だけ編集（名前は無し）
  canvas.addEventListener('dblclick', (e)=>{
    const px = e.offsetX, py = e.offsetY;
    let side='ALLY', idx = hit(state.allies, px, py);
    if (idx==null){ side='OPP'; idx = hit(state.opps, px, py); }
    if (idx==null) return;
    const list = (side==='ALLY') ? state.allies : state.opps;
    const p = list[idx];
    const no = prompt('背番号（空欄で変更しない）', p.no ?? '');
    if (no==null || no.trim()==='') return;
    if (!/^\d+$/.test(no.trim())) { alert('数字を入れてください'); return; }
    p.no = Number(no.trim());
    render();
  });

  // 右クリックのメニュー抑止（矢印描画で使う場合の保険）
  canvas.addEventListener('contextmenu', (e)=> e.preventDefault());

  // 外部セレクト（index.htmlの#sideSelect等があれば拾う）
  document.getElementById('sideSelect')?.addEventListener('change', (e)=>{
    window.BoardAPI.setSide(e.target.value);
  document.getElementById('resetPositions')?.addEventListener('click', () => {
  reset(state.unit); // 今の人数(12/15)を維持したまま初期配置
  });  
  });

  // === 名簿UI ===（IIFEの“中”に置く）========================
  const rosterEl = document.getElementById('roster');

  // 初期表示
  reset(15);

function currentPlayersForRoster(){
  const viewFilter = p => state.view === 'ALL' ? true : p.role === state.view;

  // 味方のみ
  let rows = state.allies.filter(viewFilter).map(p => ({...p, side:'ALLY'}));

  // ベンチは「全員表示」かつ「相手のみでない」時だけ足す
  if (state.view === 'ALL' && state.side !== 'OPP'){
    rows = rows.concat(state.bench.map(p => ({...p, side:'BENCH'})));
  }

  // 番号昇順
  rows.sort((a,b)=> (a.no??999)-(b.no??999));
  return rows;
}

function renderRoster(){
  if (!rosterEl) return;
  rosterEl.innerHTML = ''; // 全消去して再構築

  const rows = currentPlayersForRoster();
  rows.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'item';

    // マーカー（番号付き丸）
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.style.setProperty('--color', p.color);
    marker.textContent = p.no ?? '';

    // 白いマーカーのときだけ文字色を黒に
    if (p.color === '#fff' || p.color.toLowerCase()==='white'){
      marker.classList.add('is-white');
    }

    // 名前入力欄
    const input = document.createElement('input');
    input.type = 'text';
    input.value = p.name ?? '';
    input.placeholder = '選手名';
    input.addEventListener('input', () => {
      const list =
        p.side === 'ALLY' ? state.allies :
        p.side === 'OPP'  ? state.opps   :
        state.bench;
      const i = list.findIndex(x => x.no === p.no && x.role === p.role);
      if (i >= 0) list[i].name = input.value.trim();
    });

    item.appendChild(marker);
    item.appendChild(input);
    rosterEl.appendChild(item);
  });
}
 
// === タッチ→マウス変換（スマホ対応） ===
function touchHandler(event) {
  const touches = event.changedTouches;
  if (!touches || touches.length === 0) return;

  const t = touches[0];
  let type = "";
  if (event.type === "touchstart") type = "mousedown";
  if (event.type === "touchmove")  type = "mousemove";
  if (event.type === "touchend")   type = "mouseup";

  if (type) {
    const simulatedEvent = new MouseEvent(type, {
      bubbles: true,
      clientX: t.clientX,
      clientY: t.clientY
    });
    // キャンバスへディスパッチ
    canvas.dispatchEvent(simulatedEvent);
  }

  // 画面スクロールを抑止（ドラッグ優先）
  event.preventDefault();
}

// タッチイベント登録（passive:false で preventDefault を有効化）
canvas.addEventListener("touchstart", touchHandler, { passive: false });
canvas.addEventListener("touchmove",  touchHandler, { passive: false });
canvas.addEventListener("touchend",   touchHandler, { passive: false });


  // リサイズ時に再描画
  window.addEventListener('resize', render);
  })(); // ← IIFE はここで閉じる（名簿も含めて中に入っていること）
  // タッチをマウスイベントに変換するユーティリティ
