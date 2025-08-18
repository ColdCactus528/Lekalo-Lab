class WorkZone extends HTMLElement {
  connectedCallback() {
    this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML = `
      <style>
        :host { 
          display: block; 
          border: none; 
          height: 100%; 
          min-height: 300px;
          background:#f0f0f0; 
          position: relative;
          --ruler: 26px;
          --cell-px: 40;
          --units-per-cell: 10;
        }

        canvas {
          position: absolute;
          display: block;
          pointer-events: none;
        }

        #grid {
          position:absolute;
          left:  var(--ruler);
          top:   0;
          width:  calc(100% - var(--ruler));
          height: calc(100% - var(--ruler));
          z-index: 0;
          background:#2b2f36;
        }

        .ruler-x {
          position:absolute;
          left:  var(--ruler);
          bottom:0;
          width: calc(100% - var(--ruler));
          height: var(--ruler);
          z-index: 5;
          background:#4b4f56;
        }

        .ruler-y {
          position:absolute;
          left:0; top:0;
          width: var(--ruler);
          height: calc(100% - var(--ruler));
          z-index: 5;
          background:#4b4f56;
        }

        .corner{
          position: absolute; 
          left: 0; 
          bottom: 0; 
          width: var(--ruler);
          height: var(--ruler);
          background: #4b4f56; 
          z-index: 5;
          pointer-events:none;
        }

        #scene { 
          position:absolute; 
          left:0;
          top:0;
          width:100%; 
          height:calc(100% - var(--ruler));
          z-index:2;
          transform-origin:0 0;
          will-change:transform; 
        }
        
        svg { 
          position: absolute; 
          top: 0; 
          left: 0; 
          cursor: grab; 
          z-index: 3; 
          transform: translateZ(0);
          will-change: left, top;
          contain: layout paint;
        }
      </style>

      <canvas id="grid"></canvas>
      <div id="scene"></div>
      <canvas class="ruler-x"></canvas>
      <canvas class="ruler-y"></canvas>
      <canvas class="corner" id="corner"></canvas>
    `;

    this.$grid   = this.shadowRoot.getElementById('grid');
    this.$scene  = this.shadowRoot.getElementById('scene');
    this.$rx     = this.shadowRoot.querySelector('.ruler-x');
    this.$ry     = this.shadowRoot.querySelector('.ruler-y');
    this.$corner = this.shadowRoot.getElementById('corner');

    // ====== ЗУМ ======
    const cs = getComputedStyle(this);
    this._baseCell  = parseFloat(cs.getPropertyValue('--cell-px')) || 40;
    this._baseUnits = parseFloat(cs.getPropertyValue('--units-per-cell')) || 10;
    this._ppuBase   = this._baseCell / this._baseUnits;

    this._scale    = 1;
    this._minScale = 0.25;
    this._maxScale = 20;

    this._panX = 0;
    this._panY = 0;

    this._onPanStart = this._onPanStart.bind(this);
    this.$scene.addEventListener('mousedown', this._onPanStart);
    this.$grid .addEventListener('mousedown', this._onPanStart);

    this._niceStep = (ppu, targetPx = this._baseCell) => {
      // сколько единиц «хорошо» помещать на одну клетку при текущем масштабе
      const raw = targetPx / ppu;                     
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const n   = raw / pow;
      let m;
      if (n < 1.5) m = 1;
      else if (n < 3.5) m = 2;
      else if (n < 7.5) m = 5;
      else m = 10;
      return m * pow; // …,0.2,0.5,1,2,5,10,…
    };

    this._onWheel = this._onWheel.bind(this);
    this.addEventListener('wheel', this._onWheel, { passive: false });

    this._ppu = () => this._ppuBase * this._scale; // px per unit (текущие)
    this._gridCssSize = () => {
      const r = this.$grid.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };

    this._setSvgAtUnits = (svg, xUnits, yUnits, mutate = true, clamp = true) => {
      const { GL, GH } = this._gridLogical();

      // восстановление позиций (логические px)
      let left = GL + xUnits * this._ppuBase;
      
      const topWhenNoPan = GH - (yUnits * this._ppuBase);
      let top = topWhenNoPan - this._panY;
      //let top  = GB - yUnits * this._ppuBase;

      // клаймп по сетке
      if (clamp) {
        const { LEFT_MIN, LEFT_MAX, TOP_MIN, TOP_MAX } = this._gridBoundsLogicalFor(svg);
        if (left < LEFT_MIN) left = LEFT_MIN;
        if (left > LEFT_MAX) left = LEFT_MAX;
        if (top  < TOP_MIN)  top  = TOP_MIN;
        if (top  > TOP_MAX)  top  = TOP_MAX;
      }

      // применяем
      svg.style.left = `${left}px`;
      svg.style.top  = `${top}px`;

      // МЕНЯЕМ dataset ТОЛЬКО если явно разрешено (drag/создание)
      if (mutate) {
        svg.dataset.xUnits = String((left - GL) / this._ppuBase);
        svg.dataset.yUnits = String((GH - (top + this._panY)) / this._ppuBase);
      }
    };

    this._updateAllPolys = () => {
      // пересчитываем позиции всех svg после зума/resize
      this.$scene.querySelectorAll('svg').forEach(svg => {
        const xu = parseFloat(svg.dataset.xUnits ?? 'NaN');
        const yu = parseFloat(svg.dataset.yUnits ?? 'NaN');
        if (Number.isFinite(xu) && Number.isFinite(yu)) {
          this._setSvgAtUnits(svg, xu, yu, false, false); 
        }
      });
    };

    // ====== ЗУМ ======
    const ro = new ResizeObserver(() => this.layoutAndDraw());
    ro.observe(this);
    this._ro = ro;
    requestAnimationFrame(() => this.layoutAndDraw());
  }

  disconnectedCallback(){
    this._ro?.disconnect();
    this.removeEventListener('wheel', this._onWheel);
    this.$scene?.removeEventListener('mousedown', this._onPanStart);
    this.$grid ?.removeEventListener('mousedown', this._onPanStart);
  }

  _onPanStart(e){
    if (e.button !== 0) return;
    if (e.target !== this.$scene && e.target !== this.$grid) return;
    e.preventDefault();

    const startY = e.clientY;
    const panY0  = this._panY;

    const onMove = (ev) => {
      const dy = (ev.clientY - startY) / this._scale;
      this._panY = this._clamp(panY0 + dy, 0, 550);
      
      this.drawGrid();
      this.drawRulerY();
      this._updateAllPolys(); // <--- САМОЕ ВАЖНОЕ
      this._applyVisibilityByBounds();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _applyPan(){
    // сетка/линейки с учётом панорамирования
    this.drawGrid();
    this.drawRulerX();
    this.drawRulerY();

    // переставляем все svg из их dataset (как при зуме)
    this._updateAllPolys();

    const { GL, GT, GR, GB } = this._gridLogical();  // пересчитываем новые границы
    console.log('Новые границы сетки:', GL, GT, GR, GB);

    // и прячем те, что вышли за границы
    this._applyVisibilityByBounds();
  }

  _applySceneScale(){
    this.$scene.style.transform = `scale(${this._scale})`;
  }

  _applyVisibilityByBounds() {
    const { GL, GR, GH } = this._gridLogical(); // логические границы видимой сетки
    const panY = this._panY;

    const viewTopWorld    = panY;
    const viewBottomWorld = panY + GH;

    this.$scene.querySelectorAll('svg').forEach(svg => {
      const left = parseFloat(svg.style.left) || 0;   // логические px (до CSS-scale)
      const top  = parseFloat(svg.style.top)  || 0;

      const poly = svg.querySelector('polygon');
      if (!poly) { svg.style.visibility = 'hidden'; return; }

      // bbox в системе координат svg (тоже логические)
      const bbox = poly.getBBox();

      // логический AABB полигона в системе work-zone:
      const L = left + bbox.x;
      const T = top  + bbox.y;
      const R = L + bbox.width;
      const B = T + bbox.height;

      const overlapsX = (L < GR && R > GL);
      const overlapsY = (T < viewBottomWorld && B > viewTopWorld);

      // если полигон выходит за границы по вертикали, скрываем его
      if (overlapsX && overlapsY) {
          svg.style.visibility = 'visible';
      } else {
          svg.style.visibility = 'hidden';
      }
    });
  }

  _gridLogical() {
    const host = this.getBoundingClientRect();
    const g = this.$grid.getBoundingClientRect();
    const GL = (g.left - host.left) / this._scale;
    const GT = (g.top  - host.top ) / this._scale + this._panY; // сдвиг сетки вверх при скролле вниз
    const GW =  g.width  / this._scale;
    const GH =  g.height / this._scale;
    const GR = GL + GW;
    const GB = GT + GH;
    // console.log(GL, GT, GR, GB); 
    return { GL, GT, GR, GB, GW, GH };
  }

  _onWheel(e){
    e.preventDefault();

    const dir = e.deltaY < 0 ? 1 : -1; // вверх = увеличить
    const step = 0.1;                  // шаг масштаба
    const next = Math.min(this._maxScale, Math.max(this._minScale, +(this._scale * (1 + dir*step)).toFixed(3)));

    if (next === this._scale) return;

    this._scale = next;

    const ppu = this._ppuBase * this._scale;

    // «красивый» шаг сетки
    const unitsPerCell = this._niceStep(ppu, this._baseCell);
    const cellPx       = unitsPerCell * ppu;

    // в CSS
    this.style.setProperty('--units-per-cell', String(unitsPerCell));
    this.style.setProperty('--cell-px', String(+cellPx.toFixed(4)));

    this.layoutAndDraw();
    this._updateAllPolys();
    this._applySceneScale();
    this._applyVisibilityByBounds();
    console.log(this._scale);
  }

  layoutAndDraw(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    this.$grid.style.top    = '0px';
    this.$grid.style.height = 'calc(100% - var(--ruler))';

    this.$ry.style.top    = '0px';
    this.$ry.style.height = 'calc(100% - var(--ruler))';

    this._applySceneScale();

    const fit = (el) => {
      const r = el.getBoundingClientRect();
      el.width  = Math.max(1, Math.floor(r.width  * dpr));
      el.height = Math.max(1, Math.floor(r.height * dpr));
      const ctx = el.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0); // рисуем в CSS-px
      return ctx;
    };

    this._ctxGrid   = fit(this.$grid);
    this._ctxX      = fit(this.$rx);
    this._ctxY      = fit(this.$ry);
    this._ctxCorner = fit(this.$corner);

    this.drawGrid();
    this.drawRulerX();
    this.drawRulerY();
    this.drawCorner();
    this._updateAllPolys();
  }

  drawCorner() {
    const ctx = this._ctxCorner;
    const r = this.$corner.getBoundingClientRect();
    const w = r.width, h = r.height;

    ctx.fillStyle = '#e1e3e6';
    ctx.font = '12px system-ui,-apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('0', w / 2, h / 2);
  }

  drawGrid(){
    const ctx = this._ctxGrid;
    const r = this.$grid.getBoundingClientRect();
    const w = r.width, h = r.height;
    const cell = parseFloat(getComputedStyle(this).getPropertyValue('--cell-px')) || 40;

    // фон
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(0,0,w,h);

    const majorEach = 5;

    // Вертикали (без смещения по Y)
    for (let x = 0, i=0; x <= w + 0.5; x += cell, i++){
      const X = Math.floor(x)+0.5;
      ctx.beginPath();
      ctx.lineWidth   = (i % majorEach === 0) ? 1.2 : 1;
      ctx.strokeStyle = (i % majorEach === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
      ctx.moveTo(X, 0);
      ctx.lineTo(X, h);
      ctx.stroke();
    }

    // === Горизонтали: панорамирование считаем в CSS-px ===
    const cssPan = this._panY * this._scale;                       // px
    const off    = ((cssPan % (cell||1)) + (cell||1)) % (cell||1); // 0..cell
    const baseIdx = Math.floor(cssPan / (cell || 1));              // сколько клеток «пролистано»

    // Тянем вниз -> cssPan растёт -> линии едут вниз: стартуем с h + off
    for (let k = 0, yPix = h + off; yPix >= -0.5; yPix -= cell, k++){
      const Y = Math.floor(yPix) + 0.5;
      const i = baseIdx + k + 1; // индекс клетки для «жирности»
      ctx.beginPath();
      ctx.lineWidth   = (i % majorEach === 0) ? 1.2 : 1;
      ctx.strokeStyle = (i % majorEach === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
      ctx.moveTo(0, Y);
      ctx.lineTo(w, Y);
      ctx.stroke();
    }
  }

  _clamp(v,min,max){ return v < min ? min : v > max ? max : v; }

  _metrics(ctx, label) {
    const m = ctx.measureText(label);
    const asc = m.actualBoundingBoxAscent ?? 8;
    const dsc = m.actualBoundingBoxDescent ?? 3;
    return { w: m.width ?? 0, h: asc + dsc };
  }
  _fitsVertMiddle(y, hText, hCanvas, padTop=1, padBottom=1) {
    return y - hText/2 >= padTop && y + hText/2 <= hCanvas - padBottom;
  }
  _fitsHorizCenter(x, wText, wCanvas, pad=1) {
    return x - wText/2 >= pad && x + wText/2 <= wCanvas - pad;
  }
  _fitsHorizLeft(xLeft, wText, wCanvas, padLeft=4, padRight=2) {
    return xLeft >= padLeft && xLeft + wText <= wCanvas - padRight;
  }

  drawRulerX() {
    const ctx = this._ctxX;
    const w = this.$rx.getBoundingClientRect().width;
    const h = this.$rx.getBoundingClientRect().height;
    const cell  = parseFloat(getComputedStyle(this).getPropertyValue('--cell-px')) || 40;
    const units = parseFloat(getComputedStyle(this).getPropertyValue('--units-per-cell')) || 10;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#4b4f56';
    ctx.fillRect(0,0,w,h);

    ctx.fillStyle = '#e1e3e6';
    ctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const steps = Math.ceil(w / cell);
    for (let i = 1; i <= steps; i++) {
      const x = Math.floor(i * cell) + 0.5;
      const label = String(i * units);

      const { w: tw, h: th } = this._metrics(ctx, label);

      if (!this._fitsHorizCenter(x, tw, w, 1)) continue;
      if (!this._fitsVertMiddle(h/2, th, h, 1, 1)) continue;

      ctx.fillText(label, x, h / 2);
    }
  }

  drawRulerY() {
    const ctx = this._ctxY;
    const w = this.$ry.getBoundingClientRect().width;
    const h = this.$ry.getBoundingClientRect().height;
    const cell  = parseFloat(getComputedStyle(this).getPropertyValue('--cell-px')) || 40;
    const units = parseFloat(getComputedStyle(this).getPropertyValue('--units-per-cell')) || 10;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#4b4f56';
    ctx.fillRect(0,0,w,h);

    ctx.fillStyle = '#e1e3e6';
    ctx.font = '12px system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const xLeft = 4;
    const baseIdx = Math.floor((this._panY * this._scale) / cell);
    const off = (( (this._panY * this._scale) % (cell||1) ) + (cell||1)) % (cell||1);

    // метки от низа вверх
    for (let i = 1; ; i++){
      const yPix = Math.floor(h - (i*cell - off)) + 0.5;
      if (yPix < -0.5) break;

      const labelUnits = (i + baseIdx) * units;
      const text = String(labelUnits);

      const { w: tw, h: th } = this._metrics(ctx, text);
      if (!this._fitsHorizLeft(xLeft, tw, w, 4, 2)) continue;
      if (!this._fitsVertMiddle(yPix, th, h, 1, 1))  continue;

      ctx.fillText(text, xLeft, yPix);
    }
  }

  _gridBounds(svgWidth = 0, svgHeight = 0) {
    const host = this.getBoundingClientRect();
    const grid = this.$grid.getBoundingClientRect();
    const minLeft = grid.left - host.left;
    const minTop  = grid.top  - host.top;
    const maxLeft = minLeft + grid.width  - svgWidth;
    const maxTop  = minTop  + grid.height - svgHeight;
    return { minLeft, minTop, maxLeft, maxTop };
  }

  _gridBoundsLogicalFor(svg){
    const { GL, GR, GH } = this._gridLogical();
    const panY = this._panY;

    const viewTopWorld    = panY;
    const viewBottomWorld = panY + GH;

    const bbox = svg.querySelector('polygon').getBBox(); // логические

    return {
      LEFT_MIN: GL - bbox.x,
      LEFT_MAX: GR - (bbox.x + bbox.width),
      TOP_MIN:  viewTopWorld - bbox.y, 
      TOP_MAX:  viewBottomWorld - (bbox.y + bbox.height), 
    };
  }

  startDragFromBuffer(e, polygonData) {
    e.preventDefault();
    const hostRect = this.getBoundingClientRect();
    const svg = this.addPolygon(
      polygonData,
      e.clientX - hostRect.left,
      e.clientY - hostRect.top
    );

    const svgRect = svg.getBoundingClientRect();
    const offsetX = (e.clientX - svgRect.left) / this._scale;
    const offsetY = (e.clientY - svgRect.top ) / this._scale;

    const gridRect   = this.$grid.getBoundingClientRect();
    const gridLeft   = (gridRect.left   - hostRect.left) / this._scale;
    const gridTop    = (gridRect.top    - hostRect.top ) / this._scale;
    const gridRight  = gridLeft + (gridRect.width  / this._scale);
    const gridBottom = gridTop  + (gridRect.height / this._scale);

    const poly = svg.querySelector('polygon');
    const bbox = poly.getBBox();

    const bufferEl        = this.getRootNode()?.querySelector('buffer-zone');
    const bufferRect      = bufferEl?.getBoundingClientRect();
    const bufferTopLocal  = bufferRect ? (bufferRect.top - hostRect.top) / this._scale : 0;

    const LEFT_MAX_GRID = gridRight - (bbox.x + bbox.width);
    const TOP_MAX       = gridBottom - (bbox.y + bbox.height);

    const TOP_MIN_BUF   = bufferTopLocal - bbox.y;

    const onMouseMove = (ev) => {
      let left = (ev.clientX - hostRect.left) / this._scale - offsetX;
      let top  = (ev.clientY - hostRect.top ) / this._scale - offsetY;

      const polyTopLocal = top + bbox.y;

      if (polyTopLocal < gridTop) {
        const LEFT_MIN_BUF  = 0 - bbox.x;

        if (left < LEFT_MIN_BUF)  left = LEFT_MIN_BUF;
        if (left > LEFT_MAX_GRID) left = LEFT_MAX_GRID;
        if (top  < TOP_MIN_BUF)   top  = TOP_MIN_BUF;  
        if (top  > TOP_MAX)       top  = TOP_MAX;     
      } else {
        const LEFT_MIN_GRID = gridLeft - bbox.x;

        if (left < LEFT_MIN_GRID) left = LEFT_MIN_GRID;
        if (left > LEFT_MAX_GRID) left = LEFT_MAX_GRID;
        if (top  > TOP_MAX)       top  = TOP_MAX;
      }

      svg.style.left = `${left}px`;
      svg.style.top  = `${top}px`;

      const { GL, GB } = this._gridLogical();
      svg.dataset.xUnits = String((left - GL) / this._ppuBase);
      svg.dataset.yUnits = String((GB - top ) / this._ppuBase);
    };
    
    const onMouseUp = eve => {
      const workRect = this.getBoundingClientRect();
      const svgRect  = svg.getBoundingClientRect();
      const poly     = svg.querySelector('polygon');      
      const polyRect = poly.getBoundingClientRect();

      const dividerEl = this.getRootNode()?.querySelector('buffer-divider');
      const dividerH  = dividerEl
          ? dividerEl.getBoundingClientRect().height
          : 0;

      // верх полигона в локальных координатах work-zone
      const polyTopLocal = polyRect.top - workRect.top;

      // buffer находится выше на высоту divider
      if (polyTopLocal < -dividerH) {
        svg.remove();
      } else if (polyTopLocal < 0) {
        const offsetInSvg = polyRect.top - svgRect.top; // сдвиг верха полигона внутри svg
        const targetTop   = 0 - offsetInSvg;            // верх полигона ровно по top work-zone
        svg.style.top = `${Math.round(targetTop)}px`;
      }
      
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  addPolygon(polygonData, x, y) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", 120);
    svg.setAttribute("height", 90);
    svg.style.position = "absolute";

    const polygon = document.createElementNS(svgNS, "polygon");
    polygon.setAttribute(
      "points", 
      polygonData.points.map(pt => `${pt.x}, ${pt.y}`).join(" ")
    );
    polygon.setAttribute("fill", polygonData.fill);
    polygon.setAttribute("stroke", polygonData.stroke);
    polygon.setAttribute("stroke-width", 1);

    svg.appendChild(polygon);
    this.$scene.appendChild(svg);

    const leftLocal = (x - 60) / this._scale; // логические px (top-left svg)
    const topLocal  = (y - 45) / this._scale;

    const { GL, GH } = this._gridLogical();
    const xUnits = (leftLocal - GL) / this._ppuBase;   // от левого края grid
    const yUnits = (GH - (topLocal + this._panY)) / this._ppuBase;

    svg.style.left = `${leftLocal}px`;
    svg.style.top  = `${topLocal}px`;
    svg.dataset.xUnits = String(xUnits);
    svg.dataset.yUnits = String(yUnits);

    svg.addEventListener('mousedown', e => {
      this.startDrag(e, svg);
    });
    return svg;
  }

  startDrag(e, svg) {
    e.preventDefault();

    const hostRect = this.getBoundingClientRect();
    const svgRect  = svg.getBoundingClientRect();

    // смещение курсора внутри svg в ЛОГИЧЕСКИХ px
    const offsetX = (e.clientX - svgRect.left) / this._scale;
    const offsetY = (e.clientY - svgRect.top ) / this._scale;

    // единые корректные границы с учётом pan/scale/реального bbox
    const limitsFor = () => this._gridBoundsLogicalFor(svg);
    let { LEFT_MIN, LEFT_MAX, TOP_MIN, TOP_MAX } = limitsFor();
    const eps = 1e-3;

    const onMouseMove = (ev) => {
      // текущие желаемые координаты (логические px)
      let left = (ev.clientX - hostRect.left) / this._scale - offsetX;
      let top  = (ev.clientY - hostRect.top ) / this._scale - offsetY;

      // на всякий случай пересчитаем границы, если панорамирование могло измениться
      ({ LEFT_MIN, LEFT_MAX, TOP_MIN, TOP_MAX } = limitsFor());

      // клаймп
      if (left < LEFT_MIN - eps) left = LEFT_MIN;
      if (left > LEFT_MAX + eps) left = LEFT_MAX;
      if (top  < TOP_MIN  - eps) top  = TOP_MIN;
      if (top  > TOP_MAX  + eps) top  = TOP_MAX;

      svg.style.left = `${left}px`;
      svg.style.top  = `${top}px`;

      // обновляем логические координаты (единицы сетки)
      const { GL, GH } = this._gridLogical();
      svg.dataset.xUnits = String((left - GL) / this._ppuBase);
      svg.dataset.yUnits = String((GH - (top + this._panY)) / this._ppuBase);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }


  //set polygons(v){ this._ploys=v||[]; } 
  set view(v){ this._view=v; }
}

customElements.define('work-zone', WorkZone);
