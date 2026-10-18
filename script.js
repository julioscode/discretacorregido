(function(){
  "use strict";

  let vertices = [
    {label:'A', x:2, y:1},
    {label:'B', x:4, y:1},
    {label:'C', x:3, y:3}
  ];
  let transformed = null;
  let lastMatrix = null;
  let lastCenter = {x:0,y:0};
  let lastLabel = '';
  let displayVerts = null;
  let animId = null;
  let history = [];

  let compQueue = [];

  const view = { scale:40, offX:0, offY:0 };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function toast(msg){
    const wrap = $('#toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .2s'; setTimeout(()=>el.remove(),200); }, 2600);
  }

  function fmt(n){
    if (Math.abs(n) < 1e-9) n = 0;
    return (Math.round(n*1000)/1000).toString();
  }

  function matMul(A,B){
    return [
      [A[0][0]*B[0][0]+A[0][1]*B[1][0], A[0][0]*B[0][1]+A[0][1]*B[1][1]],
      [A[1][0]*B[0][0]+A[1][1]*B[1][0], A[1][0]*B[0][1]+A[1][1]*B[1][1]]
    ];
  }
  function matVec(A, p){
    return { x: A[0][0]*p.x + A[0][1]*p.y, y: A[1][0]*p.x + A[1][1]*p.y };
  }
  function identity(){ return [[1,0],[0,1]]; }

  function polygonArea(pts){
    let area = 0;
    for (let i=0;i<pts.length;i++){
      const p1 = pts[i], p2 = pts[(i+1)%pts.length];
      area += p1.x*p2.y - p2.x*p1.y;
    }
    return area/2;
  }

  function detOf(A){
    return A[0][0]*A[1][1] - A[0][1]*A[1][0];
  }

  function detDescription(det){
    if (Math.abs(det) < 1e-9) return 'no invertible · colapsa la figura en una línea o un punto';
    if (Math.abs(Math.abs(det)-1) < 1e-9 && det < 0) return 'invierte la orientación · conserva el área';
    if (Math.abs(Math.abs(det)-1) < 1e-9) return 'conserva el área y la orientación';
    if (det < 0) return 'invierte la orientación · escala el área ×' + fmt(Math.abs(det));
    return 'conserva la orientación · escala el área ×' + fmt(det);
  }

  function runPreApplyValidations(t){
    const area = Math.abs(polygonArea(vertices));
    if (area < 1e-6){
      toast('Advertencia: los vértices de entrada son colineales o coinciden (área ≈ 0).');
    }
    const det = detOf(t.A);
    if (Math.abs(det) < 1e-9){
      toast('Advertencia: det(A) ≈ 0 — esta transformación colapsa la figura (caso límite, no invertible).');
    }
  }

  function rotationMatrix(deg, clockwise){
    let rad = deg * Math.PI/180;
    if (clockwise) rad = -rad;
    const c = Math.cos(rad), s = Math.sin(rad);
    return [[c,-s],[s,c]];
  }
  function homoteciaMatrix(k){ return [[k,0],[0,k]]; }
  function homoteciaMatrixXY(kx,ky){ return [[kx,0],[0,ky]]; }
  function reflectionAngleMatrix(deg){
    const rad2 = (deg*2)*Math.PI/180;
    return [[Math.cos(rad2), Math.sin(rad2)],[Math.sin(rad2), -Math.cos(rad2)]];
  }
  const REFLECT_X  = [[1,0],[0,-1]];
  const REFLECT_Y  = [[-1,0],[0,1]];
  const REFLECT_YX = [[0,1],[1,0]];

  function applyAffine(points, A, center){
    center = center || {x:0,y:0};
    return points.map(p => {
      const rel = {x:p.x-center.x, y:p.y-center.y};
      const t = matVec(A, rel);
      return {label:p.label, x:t.x+center.x, y:t.y+center.y};
    });
  }

  function readNumber(id, fallback){
    const el = document.getElementById(id);
    const v = parseFloat(el.value);
    if (el.value.trim()==='' || isNaN(v)){
      toast('Revisa el campo "'+id+'": debe ser un número.');
      return fallback;
    }
    return v;
  }

  function nextLabel(){
    const used = new Set(vertices.map(v=>v.label));
    let i=0;
    while(true){
      const l = String.fromCharCode(65 + (i%26)) + (i>=26 ? Math.floor(i/26):'');
      if(!used.has(l)) return l;
      i++;
    }
  }

  function renderVTable(){
    const tbody = $('#vtable-body');
    tbody.innerHTML = '';
    vertices.forEach((v, idx)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="label-in" data-idx="${idx}" data-f="label" value="${v.label}"></td>
        <td><input type="number" step="any" data-idx="${idx}" data-f="x" value="${v.x}"></td>
        <td><input type="number" step="any" data-idx="${idx}" data-f="y" value="${v.y}"></td>
        <td><button class="row-del" data-idx="${idx}" title="Eliminar">&times;</button></td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input', e=>{
        const idx = +e.target.dataset.idx;
        const f = e.target.dataset.f;
        if (f==='label'){
          vertices[idx].label = e.target.value || '?';
        } else {
          const val = parseFloat(e.target.value);
          if (!isNaN(val)) vertices[idx][f] = val;
        }
        transformed = null; displayVerts = null;
        clearResultPanels();
        redraw();
      });
    });
    tbody.querySelectorAll('.row-del').forEach(btn=>{
      btn.addEventListener('click', e=>{
        const idx = +e.target.dataset.idx;
        if (vertices.length <= 3){ toast('Se necesitan al menos 3 vértices.'); return; }
        vertices.splice(idx,1);
        transformed = null; displayVerts = null;
        clearResultPanels();
        renderVTable();
        redraw();
      });
    });
  }

  $('#add-vertex').addEventListener('click', ()=>{
    vertices.push({label: nextLabel(), x:0, y:0});
    renderVTable();
    redraw();
  });

  const dz = $('#dropzone');
  const fileInput = $('#file-input');
  dz.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', e=>{
    if (e.target.files[0]) readFile(e.target.files[0]);
  });
  ['dragenter','dragover'].forEach(ev=>{
    dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); });
  });
  ['dragleave','drop'].forEach(ev=>{
    dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); });
  });
  dz.addEventListener('drop', e=>{
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  function readFile(file){
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const parsed = parseVertexText(reader.result);
        if (parsed.length < 3){
          toast('El archivo debe tener al menos 3 puntos válidos (x,y).');
          return;
        }
        vertices = parsed;
        transformed = null; displayVerts = null;
        history = [];
        clearResultPanels();
        renderVTable();
        fitView();
        toast('Se cargaron '+parsed.length+' vértices desde '+file.name);
        if (Math.abs(polygonArea(vertices)) < 1e-6){
          toast('Advertencia: los puntos cargados son colineales o coinciden (área ≈ 0).');
        }
      }catch(err){
        toast('No se pudo leer el archivo: formato inválido.');
      }
    };
    reader.onerror = ()=> toast('Error al leer el archivo.');
    reader.readAsText(file);
  }

  function parseVertexText(text){
    const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length);
    const pts = [];
    let i=0;
    for (const line of lines){
      const nums = line.split(/[,\s]+/).map(s=>s.trim()).filter(s=>s.length);
      if (nums.length >= 2){
        const x = parseFloat(nums[0]), y = parseFloat(nums[1]);
        if (!isNaN(x) && !isNaN(y)){
          pts.push({label:String.fromCharCode(65+(i%26)), x, y});
          i++;
        }
      }
    }
    return pts;
  }

  $$('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab-btn').forEach(b=>b.classList.remove('active'));
      $$('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      $(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
  });

  function linkSliderNumber(sliderId, numberId, valueLabelId, suffix){
    const slider = document.getElementById(sliderId);
    const number = document.getElementById(numberId);
    const label = valueLabelId ? document.getElementById(valueLabelId) : null;
    slider.addEventListener('input', ()=>{
      number.value = slider.value;
      if (label) label.textContent = slider.value + (suffix||'');
    });
    number.addEventListener('input', ()=>{
      const v = parseFloat(number.value);
      if (!isNaN(v)){
        slider.value = v;
        if (label) label.textContent = v + (suffix||'');
      }
    });
  }
  linkSliderNumber('rot-angle-slider','rot-angle','rot-angle-val','°');
  linkSliderNumber('homo-k-slider','homo-k','homo-k-val','');
  linkSliderNumber('refl-angle-slider','refl-angle','refl-angle-val','°');

  $('#homo-independiente').addEventListener('change', e=>{
    $('#homo-k-field').style.display = e.target.checked ? 'none' : 'block';
    $('#homo-kxky-field').style.display = e.target.checked ? 'flex' : 'none';
  });

  $$('input[name=refl]').forEach(r=>{
    r.addEventListener('change', ()=>{
      $$('.radio-opt').forEach(o=>o.classList.remove('selected'));
      r.closest('.radio-opt').classList.add('selected');
      const v = r.value;
      $('#refl-angle-field').style.display = (v==='angulo'||v==='arbitraria') ? 'block' : 'none';
      $('#refl-point-field').style.display = (v==='arbitraria') ? 'flex' : 'none';
    });
  });

  function getRotacionMatrixAndCenter(){
    const sentido = $('#rot-sentido').value;
    const angle = readNumber('rot-angle', 0);
    const cx = readNumber('rot-cx', 0);
    const cy = readNumber('rot-cy', 0);
    const A = rotationMatrix(angle, sentido==='horario');
    const label = `Rotación ${sentido==='horario'?'horaria':'antihoraria'} ${fmt(angle)}° · C(${fmt(cx)},${fmt(cy)})`;
    return {A, center:{x:cx,y:cy}, label};
  }

  function getHomoteciaMatrixAndCenter(){
    const indep = $('#homo-independiente').checked;
    const cx = readNumber('homo-cx', 0);
    const cy = readNumber('homo-cy', 0);
    let A, label;
    if (indep){
      const kx = readNumber('homo-kx', 1);
      const ky = readNumber('homo-ky', 1);
      A = homoteciaMatrixXY(kx,ky);
      label = `Homotecia kx=${fmt(kx)}, ky=${fmt(ky)} · C(${fmt(cx)},${fmt(cy)})`;
    } else {
      const k = readNumber('homo-k', 1);
      A = homoteciaMatrix(k);
      label = `Homotecia k=${fmt(k)} · C(${fmt(cx)},${fmt(cy)})`;
    }
    return {A, center:{x:cx,y:cy}, label};
  }

  function getReflexionMatrixAndCenter(){
    const tipo = $('input[name=refl]:checked').value;
    let A, center = {x:0,y:0}, label;
    if (tipo==='x'){ A = REFLECT_X; label='Reflexión respecto al eje X'; }
    else if (tipo==='y'){ A = REFLECT_Y; label='Reflexión respecto al eje Y'; }
    else if (tipo==='yx'){ A = REFLECT_YX; label='Reflexión respecto a y = x'; }
    else if (tipo==='angulo'){
      const angle = readNumber('refl-angle', 45);
      A = reflectionAngleMatrix(angle);
      label = `Reflexión · recta por el origen, α=${fmt(angle)}°`;
    } else {
      const angle = readNumber('refl-angle', 45);
      const px = readNumber('refl-px', 0);
      const py = readNumber('refl-py', 0);
      A = reflectionAngleMatrix(angle);
      center = {x:px,y:py};
      label = `Reflexión · recta arbitraria α=${fmt(angle)}°, por (${fmt(px)},${fmt(py)})`;
    }
    return {A, center, label};
  }

  function getActiveTransform(){
    const tab = $('.tab-btn.active').dataset.tab;
    if (tab==='rotacion') return {...getRotacionMatrixAndCenter(), tab};
    if (tab==='homotecia') return {...getHomoteciaMatrixAndCenter(), tab};
    if (tab==='reflexion') return {...getReflexionMatrixAndCenter(), tab};
    return null;
  }

  function renderCompParams(){
    const type = $('#comp-type').value;
    const box = $('#comp-params');
    if (type==='rotacion'){
      box.innerHTML = `
        <div class="field">
          <label>Sentido</label>
          <select id="c-rot-sentido">
            <option value="antihorario">Antihorario (+)</option>
            <option value="horario">Horario (−)</option>
          </select>
        </div>
        <div class="field">
          <label>Ángulo α</label>
          <input type="number" id="c-rot-angle" value="90">
        </div>`;
    } else if (type==='homotecia'){
      box.innerHTML = `
        <div class="field"><label>Factor k</label><input type="number" id="c-homo-k" value="2" step="0.1"></div>`;
    } else {
      box.innerHTML = `
        <div class="field">
          <label>Eje / recta</label>
          <select id="c-refl-tipo">
            <option value="x">Eje X</option>
            <option value="y">Eje Y</option>
            <option value="yx">Recta y = x</option>
            <option value="angulo">Por el origen, ángulo α</option>
          </select>
        </div>
        <div class="field" id="c-refl-angle-field" style="display:none;">
          <label>Ángulo α</label>
          <input type="number" id="c-refl-angle" value="45">
        </div>`;
      $('#c-refl-tipo').addEventListener('change', e=>{
        $('#c-refl-angle-field').style.display = e.target.value==='angulo' ? 'block' : 'none';
      });
    }
  }
  $('#comp-type').addEventListener('change', renderCompParams);
  renderCompParams();

  function renderQueue(){
    const ul = $('#comp-queue');
    ul.innerHTML = '';
    if (compQueue.length===0){
      ul.innerHTML = '<li class="queue-empty">Aún no hay pasos. Agrega uno arriba.</li>';
      return;
    }
    compQueue.forEach((step, i)=>{
      const li = document.createElement('li');
      li.className = 'queue-item';
      li.innerHTML = `<span><span class="qi-index">${i+1}.</span><span class="qi-label">${step.label}</span></span>
        <button data-idx="${i}">&times;</button>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', e=>{
        compQueue.splice(+e.target.dataset.idx,1);
        renderQueue();
      });
    });
  }

  $('#comp-add').addEventListener('click', ()=>{
    const type = $('#comp-type').value;
    let A, label;
    if (type==='rotacion'){
      const sentido = $('#c-rot-sentido').value;
      const angle = readNumber('c-rot-angle', 0);
      A = rotationMatrix(angle, sentido==='horario');
      label = `Rotación ${sentido==='horario'?'horaria':'antihoraria'} ${fmt(angle)}°`;
    } else if (type==='homotecia'){
      const k = readNumber('c-homo-k', 1);
      A = homoteciaMatrix(k);
      label = `Homotecia k=${fmt(k)}`;
    } else {
      const tipo = $('#c-refl-tipo').value;
      if (tipo==='x'){ A=REFLECT_X; label='Reflexión eje X'; }
      else if (tipo==='y'){ A=REFLECT_Y; label='Reflexión eje Y'; }
      else if (tipo==='yx'){ A=REFLECT_YX; label='Reflexión y = x'; }
      else { const angle = readNumber('c-refl-angle', 45); A = reflectionAngleMatrix(angle); label = `Reflexión α=${fmt(angle)}°`; }
    }
    compQueue.push({type, label, matrix:A});
    renderQueue();
  });
  renderQueue();

  function getCompositeTransform(){
    if (compQueue.length===0){
      toast('Agrega al menos un paso a la composición.');
      return null;
    }
    let A = identity();

    for (const step of compQueue){
      A = matMul(step.matrix, A);
    }
    const label = 'Composición: ' + compQueue.map(s=>s.label).join('  →  ');
    return {A, center:{x:0,y:0}, label, tab:'composicion'};
  }

  function computeCurrentTransform(){
    const tab = $('.tab-btn.active').dataset.tab;
    if (tab==='composicion') return getCompositeTransform();
    return getActiveTransform();
  }

  $('#btn-apply').addEventListener('click', ()=>{
    const t = computeCurrentTransform();
    if (!t) return;
    runPreApplyValidations(t);
    stopAnimation();
    history.push({ transformed, lastMatrix, lastCenter, lastLabel });
    lastMatrix = t.A;
    lastCenter = t.center;
    lastLabel = t.label;
    transformed = applyAffine(vertices, t.A, t.center);
    displayVerts = transformed;
    renderMathPanels(t);
    redraw();
    toast('Transformación aplicada: ' + t.label);
  });

  $('#btn-animate').addEventListener('click', ()=>{
    const t = computeCurrentTransform();
    if (!t) return;
    runPreApplyValidations(t);
    stopAnimation();
    history.push({ transformed, lastMatrix, lastCenter, lastLabel });
    lastMatrix = t.A;
    lastCenter = t.center;
    lastLabel = t.label;
    transformed = applyAffine(vertices, t.A, t.center);
    renderMathPanels(t);
    animateTransition(vertices, transformed, 1200);
  });

  $('#btn-undo').addEventListener('click', ()=>{
    if (history.length === 0){
      toast('No hay ninguna transformación previa para deshacer.');
      return;
    }
    stopAnimation();
    const prev = history.pop();
    transformed = prev.transformed;
    lastMatrix = prev.lastMatrix;
    lastCenter = prev.lastCenter;
    lastLabel = prev.lastLabel;
    displayVerts = transformed;
    if (transformed && lastMatrix){
      renderMathPanels({ A:lastMatrix, label:lastLabel });
    } else {
      clearResultPanels();
    }
    redraw();
    toast('Se deshizo la última transformación.');
  });

  $('#btn-reset').addEventListener('click', ()=>{
    stopAnimation();
    vertices = [
      {label:'A', x:2, y:1},
      {label:'B', x:4, y:1},
      {label:'C', x:3, y:3}
    ];
    transformed = null;
    displayVerts = null;
    lastMatrix = null;
    lastLabel = '';
    history = [];
    compQueue = [];
    renderQueue();
    renderVTable();
    clearResultPanels();
    fitView();
    toast('Todo restablecido.');
  });

  function stopAnimation(){
    if (animId){ cancelAnimationFrame(animId); animId=null; }
  }

  function animateTransition(from, to, duration){
    const start = performance.now();
    function step(now){
      const p = Math.min(1, (now-start)/duration);
      const eased = p<0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
      displayVerts = from.map((v,i)=>({
        label:v.label,
        x: v.x + (to[i].x - v.x)*eased,
        y: v.y + (to[i].y - v.y)*eased
      }));
      redraw();
      if (p<1){
        animId = requestAnimationFrame(step);
      } else {
        displayVerts = to;
        redraw();
        animId = null;
      }
    }
    animId = requestAnimationFrame(step);
  }

  function clearResultPanels(){
    $('#matrix-panel').innerHTML = '<p class="empty-note">Aplica una transformación para ver su matriz asociada.</p>';
    $('#coord-panel').innerHTML = '<p class="empty-note">La tabla comparativa de vértices aparecerá aquí.</p>';
    $('#basis-block').style.display = 'none';
  }

  function renderMathPanels(t){
    const A = t.A;
    const det = detOf(A);
    $('#matrix-panel').innerHTML = `
      <div class="matrix-wrap">
        <div class="bracket left"></div>
        <div class="matrix-grid">
          <span>${fmt(A[0][0])}</span><span>${fmt(A[0][1])}</span>
          <span>${fmt(A[1][0])}</span><span>${fmt(A[1][1])}</span>
        </div>
        <div class="bracket right"></div>
      </div>
      <p class="empty-note" style="padding-top:0;">${t.label}</p>
      <div class="det-row ${Math.abs(det)<1e-9 ? 'det-row-warn' : ''}">
        <span class="det-val">det(A) = ${fmt(det)}</span>
        <span class="det-desc">${detDescription(det)}</span>
      </div>
    `;
    $('#basis-block').style.display = 'block';
    $('#te1').textContent = `(${fmt(A[0][0])}, ${fmt(A[1][0])})`;
    $('#te2').textContent = `(${fmt(A[0][1])}, ${fmt(A[1][1])})`;

    if (transformed){
      let rows = '';
      vertices.forEach((v,i)=>{
        const tp = transformed[i];
        rows += `<tr>
          <td class="in">${v.label} (${fmt(v.x)}, ${fmt(v.y)})</td>
          <td class="arrow">→</td>
          <td class="out">${v.label}' (${fmt(tp.x)}, ${fmt(tp.y)})</td>
        </tr>`;
      });
      $('#coord-panel').innerHTML = `<table class="coord-table"><thead><tr><th>Entrada</th><th></th><th>Salida</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  }

  const canvas = $('#cv');
  const ctx = canvas.getContext('2d');

  function resizeCanvas(){
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width+'px';
    canvas.style.height = rect.height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if (view.offX===0 && view.offY===0){
      view.offX = rect.width/2;
      view.offY = rect.height/2;
    }
    redraw();
  }

  function worldToScreen(x,y){
    return { x: view.offX + x*view.scale, y: view.offY - y*view.scale };
  }

  function drawGrid(w,h){
    ctx.save();
    ctx.lineWidth = 1;

    let step = 1;
    while (step*view.scale < 40) step *= 2;
    while (step*view.scale > 160) step /= 2;

    const startX = Math.floor((-view.offX)/view.scale/step)*step;
    const endX = Math.ceil((w-view.offX)/view.scale/step)*step;
    const startY = Math.floor((-(h-view.offY))/view.scale/step)*step;
    const endY = Math.ceil((view.offY)/view.scale/step)*step;

    ctx.strokeStyle = getCss('--grid-line');
    ctx.beginPath();
    for (let x=startX; x<=endX; x+=step){
      const sx = worldToScreen(x,0).x;
      ctx.moveTo(sx,0); ctx.lineTo(sx,h);
    }
    for (let y=startY; y<=endY; y+=step){
      const sy = worldToScreen(0,y).y;
      ctx.moveTo(0,sy); ctx.lineTo(w,sy);
    }
    ctx.stroke();

    ctx.strokeStyle = getCss('--grid-line-strong');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const originS = worldToScreen(0,0);
    ctx.moveTo(0, originS.y); ctx.lineTo(w, originS.y);
    ctx.moveTo(originS.x, 0); ctx.lineTo(originS.x, h);
    ctx.stroke();

    ctx.fillStyle = getCss('--text-faint');
    ctx.font = '10px "IBM Plex Mono", monospace';
    for (let x=startX; x<=endX; x+=step){
      if (Math.abs(x)<1e-9) continue;
      const sx = worldToScreen(x,0).x;
      ctx.fillText(fmt(x), sx+3, originS.y+12);
    }
    for (let y=startY; y<=endY; y+=step){
      if (Math.abs(y)<1e-9) continue;
      const sy = worldToScreen(0,y).y;
      ctx.fillText(fmt(y), originS.x+4, sy-3);
    }
    ctx.fillStyle = getCss('--text-dim');
    ctx.font = '11px "Space Grotesk", sans-serif';
    ctx.fillText('X', w-16, originS.y-6);
    ctx.fillText('Y', originS.x+7, 14);

    ctx.restore();
  }

  function getCss(varName){
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  function drawPolygon(points, strokeColor, fillColor, dashed, labelSuffix){
    if (points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    points.forEach((p,i)=>{
      const s = worldToScreen(p.x,p.y);
      if (i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y);
    });
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.setLineDash(dashed ? [6,5] : []);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = dashed ? 1.5 : 2.2;
    ctx.stroke();
    ctx.setLineDash([]);

    points.forEach(p=>{
      const s = worldToScreen(p.x,p.y);
      ctx.beginPath();
      ctx.arc(s.x,s.y,3.2,0,Math.PI*2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
      ctx.fillStyle = getCss('--text');
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      ctx.fillText(`${p.label}${labelSuffix||''} (${fmt(p.x)}, ${fmt(p.y)})`, s.x+7, s.y-7);
    });
    ctx.restore();
  }

  function redraw(){
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    ctx.clearRect(0,0,w,h);
    drawGrid(w,h);

    drawPolygon(vertices, getCss('--accent-o'), hexToRgba(getCss('--accent-o'),0.18), true, '');

    if (displayVerts){
      drawPolygon(displayVerts, getCss('--accent-t'), hexToRgba(getCss('--accent-t'),0.20), false, "'");
    }

    $('#zoom-readout').textContent = `${Math.round(view.scale/40*100)}% · 1 u = ${Math.round(view.scale)}px`;
  }

  function hexToRgba(hex, a){
    hex = hex.replace('#','');
    const r = parseInt(hex.substring(0,2),16);
    const g = parseInt(hex.substring(2,4),16);
    const b = parseInt(hex.substring(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function fitView(){
    const rect = canvas.getBoundingClientRect();
    const all = vertices.concat(transformed || []);
    if (all.length===0) return;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    all.forEach(p=>{
      minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
      minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
    });
    const spanX = Math.max(maxX-minX, 2);
    const spanY = Math.max(maxY-minY, 2);
    const pad = 1.6;
    const scaleX = rect.width/(spanX*pad);
    const scaleY = rect.height/(spanY*pad);
    view.scale = Math.max(8, Math.min(scaleX, scaleY, 140));
    const cx = (minX+maxX)/2, cy=(minY+maxY)/2;
    view.offX = rect.width/2 - cx*view.scale;
    view.offY = rect.height/2 + cy*view.scale;
    redraw();
  }

  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX-rect.left, my = e.clientY-rect.top;
    const wx = (mx-view.offX)/view.scale, wy = -(my-view.offY)/view.scale;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    view.scale = Math.max(4, Math.min(400, view.scale*factor));
    view.offX = mx - wx*view.scale;
    view.offY = my + wy*view.scale;
    redraw();
  }, {passive:false});

  $('#zoom-in').addEventListener('click', ()=>{ view.scale=Math.min(400,view.scale*1.25); redraw(); });
  $('#zoom-out').addEventListener('click', ()=>{ view.scale=Math.max(4,view.scale*0.8); redraw(); });
  $('#zoom-fit').addEventListener('click', fitView);

  let dragging=false, lastX=0, lastY=0;
  canvas.addEventListener('mousedown', e=>{
    dragging=true; lastX=e.clientX; lastY=e.clientY;
    canvas.classList.add('panning');
  });
  window.addEventListener('mousemove', e=>{
    if (!dragging) return;
    view.offX += (e.clientX-lastX);
    view.offY += (e.clientY-lastY);
    lastX=e.clientX; lastY=e.clientY;
    redraw();
  });
  window.addEventListener('mouseup', ()=>{ dragging=false; canvas.classList.remove('panning'); });

  window.addEventListener('resize', resizeCanvas);

  $('#btn-export').addEventListener('click', exportFigure);

  function roundRect(c, x, y, w, h, r){
    c.beginPath();
    c.moveTo(x+r, y);
    c.arcTo(x+w, y, x+w, y+h, r);
    c.arcTo(x+w, y+h, x, y+h, r);
    c.arcTo(x, y+h, x, y, r);
    c.arcTo(x, y, x+w, y, r);
    c.closePath();
  }

  function fitPoints(points, w, h, padFactor){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    points.forEach(p=>{
      minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
      minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
    });
    const spanX = Math.max(maxX-minX, 2);
    const spanY = Math.max(maxY-minY, 2);
    const pad = padFactor || 1.5;
    const scale = Math.max(6, Math.min(w/(spanX*pad), h/(spanY*pad), 160));
    return { scale, cx:(minX+maxX)/2, cy:(minY+maxY)/2 };
  }

  function drawExportPanel(c, x, y, w, h, points, color, title, suffix){
    c.save();
    c.fillStyle = getCss('--panel');
    c.strokeStyle = getCss('--border');
    c.lineWidth = 1;
    roundRect(c, x, y, w, h, 6);
    c.fill(); c.stroke();

    c.save();
    roundRect(c, x, y, w, h, 6);
    c.clip();

    const marginTop = 52, marginBottom = 16, marginSide = 20;
    const left = x+marginSide, right = x+w-marginSide;
    const top = y+marginTop, bottom = y+h-marginBottom;
    const availW = right-left, availH = bottom-top;

    const { scale, cx, cy } = fitPoints(points, availW, availH);
    const offX = left + availW/2 - cx*scale;
    const offY = top + availH/2 + cy*scale;
    const toScreen = (px,py)=>({ x: offX+px*scale, y: offY-py*scale });

    let step = 1;
    while (step*scale < 36) step *= 2;
    while (step*scale > 140) step /= 2;

    const wMinX=(left-offX)/scale, wMaxX=(right-offX)/scale;
    const wMinY=-(bottom-offY)/scale, wMaxY=-(top-offY)/scale;
    const sX=Math.floor(wMinX/step)*step, eX=Math.ceil(wMaxX/step)*step;
    const sY=Math.floor(wMinY/step)*step, eY=Math.ceil(wMaxY/step)*step;

    c.strokeStyle = getCss('--grid-line');
    c.lineWidth = 1;
    c.beginPath();
    for (let gx=sX; gx<=eX; gx+=step){
      const sx = toScreen(gx,0).x;
      c.moveTo(sx, top); c.lineTo(sx, bottom);
    }
    for (let gy=sY; gy<=eY; gy+=step){
      const sy = toScreen(0,gy).y;
      c.moveTo(left, sy); c.lineTo(right, sy);
    }
    c.stroke();

    c.strokeStyle = getCss('--grid-line-strong');
    c.lineWidth = 1.5;
    c.beginPath();
    const origin = toScreen(0,0);
    c.moveTo(left, origin.y); c.lineTo(right, origin.y);
    c.moveTo(origin.x, top); c.lineTo(origin.x, bottom);
    c.stroke();

    c.beginPath();
    points.forEach((p,i)=>{
      const s = toScreen(p.x,p.y);
      if (i===0) c.moveTo(s.x,s.y); else c.lineTo(s.x,s.y);
    });
    c.closePath();
    c.fillStyle = hexToRgba(color, 0.18);
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = 2.4;
    c.stroke();

    points.forEach(p=>{
      const s = toScreen(p.x,p.y);
      c.beginPath();
      c.arc(s.x,s.y,3.6,0,Math.PI*2);
      c.fillStyle = color;
      c.fill();
      c.fillStyle = getCss('--text');
      c.font = '600 12px "IBM Plex Mono", monospace';
      c.fillText(`${p.label}${suffix} (${fmt(p.x)}, ${fmt(p.y)})`, s.x+8, s.y-8);
    });

    c.restore();

    c.fillStyle = color;
    c.font = '700 13px "Space Grotesk", sans-serif';
    c.fillText(title, x+16, y+26);
    c.restore();
  }

  function drawExportMatrix(c, x, y, w, h, A){
    c.save();
    c.fillStyle = getCss('--panel');
    c.strokeStyle = getCss('--border');
    c.lineWidth = 1;
    roundRect(c, x, y, w, h, 6);
    c.fill(); c.stroke();

    c.fillStyle = getCss('--text-faint');
    c.font = '600 11px "Space Grotesk", sans-serif';
    c.fillText('MATRIZ ASOCIADA A', x+18, y+24);

    const mx = x+60, my = y+h/2+6;
    c.strokeStyle = getCss('--text-dim');
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(mx, my-28); c.lineTo(mx-9, my-28); c.lineTo(mx-9, my+28); c.lineTo(mx, my+28);
    c.stroke();

    c.fillStyle = getCss('--accent-t');
    c.font = '600 16px "IBM Plex Mono", monospace';
    c.textAlign = 'right';
    c.fillText(fmt(A[0][0]), mx+56, my-6);
    c.fillText(fmt(A[0][1]), mx+118, my-6);
    c.fillText(fmt(A[1][0]), mx+56, my+20);
    c.fillText(fmt(A[1][1]), mx+118, my+20);
    c.textAlign = 'left';

    const rx = mx+130;
    c.beginPath();
    c.moveTo(rx, my-28); c.lineTo(rx+9, my-28); c.lineTo(rx+9, my+28); c.lineTo(rx, my+28);
    c.stroke();

    const det = A[0][0]*A[1][1]-A[0][1]*A[1][0];
    c.fillStyle = getCss('--text-dim');
    c.font = '13px "IBM Plex Mono", monospace';
    c.fillText(`det(A) = ${fmt(det)}`, rx+46, my-8);
    c.fillStyle = getCss('--text-faint');
    c.font = '11.5px "Space Grotesk", sans-serif';
    c.fillText(det<0 ? 'invierte la orientación' : 'conserva la orientación', rx+46, my+12);

    c.restore();
  }

  function drawExportTable(c, x, y, w, h, orig, trans){
    c.save();
    c.fillStyle = getCss('--panel');
    c.strokeStyle = getCss('--border');
    c.lineWidth = 1;
    roundRect(c, x, y, w, h, 6);
    c.fill(); c.stroke();

    c.fillStyle = getCss('--text-faint');
    c.font = '600 11px "Space Grotesk", sans-serif';
    c.fillText('COORDENADAS: ENTRADA → SALIDA', x+18, y+24);

    const rowH = 24;
    let ry = y+46;
    orig.forEach((v,i)=>{
      const t = trans[i];
      c.font = '12.5px "IBM Plex Mono", monospace';
      c.fillStyle = getCss('--accent-o');
      c.fillText(`${v.label} (${fmt(v.x)}, ${fmt(v.y)})`, x+22, ry);
      c.fillStyle = getCss('--text-faint');
      c.fillText('→', x+230, ry);
      c.fillStyle = getCss('--accent-t');
      c.fillText(`${v.label}' (${fmt(t.x)}, ${fmt(t.y)})`, x+260, ry);
      ry += rowH;
    });

    c.restore();
  }

  function exportFigure(){
    if (!transformed || !lastMatrix){
      toast('Primero aplica una transformación para poder exportar.');
      return;
    }

    const PAD = 28, GAP = 22;
    const HEADER_H = 58;
    const PANEL_W = 540, PANEL_H = 440;
    const MATRIX_H = 110;
    const TABLE_H = 46 + vertices.length*24 + 16;

    const W = PAD*2 + PANEL_W*2 + GAP;
    const H = PAD*2 + HEADER_H + PANEL_H + GAP + MATRIX_H + GAP + TABLE_H;

    const ex = document.createElement('canvas');
    ex.width = W; ex.height = H;
    const ectx = ex.getContext('2d');

    ectx.fillStyle = getCss('--bg');
    ectx.fillRect(0,0,W,H);

    ectx.fillStyle = getCss('--text');
    ectx.font = '600 20px "Space Grotesk", sans-serif';
    ectx.fillText('Editor de Transformaciones Lineales · ℝ²', PAD, PAD+20);
    ectx.fillStyle = getCss('--text-dim');
    ectx.font = '13px "IBM Plex Mono", monospace';
    ectx.fillText(lastLabel || '', PAD, PAD+42);

    const y0 = PAD+HEADER_H;
    drawExportPanel(ectx, PAD, y0, PANEL_W, PANEL_H, vertices, getCss('--accent-o'), 'ORIGINAL', '');
    drawExportPanel(ectx, PAD+PANEL_W+GAP, y0, PANEL_W, PANEL_H, transformed, getCss('--accent-t'), 'TRANSFORMADA', "'");

    const y1 = y0+PANEL_H+GAP;
    drawExportMatrix(ectx, PAD, y1, W-PAD*2, MATRIX_H, lastMatrix);

    const y2 = y1+MATRIX_H+GAP;
    drawExportTable(ectx, PAD, y2, W-PAD*2, TABLE_H, vertices, transformed);

    ex.toBlob(blob=>{
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      a.href = url;
      a.download = `transformacion_${ts}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }, 'image/png');

    toast('Figura exportada: original y transformada por separado.');
  }

  renderVTable();
  resizeCanvas();
  fitView();

})();