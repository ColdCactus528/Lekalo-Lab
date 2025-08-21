class WorkZone extends HTMLElement {
  static LS_KEY = 'triumph.polys.v1'

// ── Lifecycle ───────────────────────────────
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { 
          display: block; 
          border: none; 
          height: 100%; 
          min-height: 300px;
          background: #f0f0f0; 
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
          position: absolute;
          left: var(--ruler);
          top: 0;
          width: calc(100% - var(--ruler));
          height: calc(100% - var(--ruler));
          z-index: 0;
          background: #2b2f36;
        }

        .ruler-x {
          position: absolute;
          left: var(--ruler);
          bottom: 0;
          width: calc(100% - var(--ruler));
          height: var(--ruler);
          z-index: 5;
          background: #4b4f56;
        }

        .ruler-y {
          position: absolute;
          left: 0;
          top: 0;
          width: var(--ruler);
          height: calc(100% - var(--ruler));
          z-index: 5;
          background: #4b4f56;
        }

        .corner {
          position: absolute; 
          left: 0; 
          bottom: 0; 
          width: var(--ruler);
          height: var(--ruler);
          background: #4b4f56; 
          z-index: 5;
          pointer-events: none;
        }

        #scene { 
          position: absolute; 
          left: 0;
          top: 0;
          width: 100%; 
          height: calc(100% - var(--ruler));
          z-index: 2; 
          pointer-events: none;
        }
        
        svg { 
          position: absolute; 
          top: 0; 
          left: 0; 
          cursor: grab; 
          z-index: 3; 
          transform: translateZ(0);
          will-change: left, top;
          pointer-events: none;
          transform-origin: top left;
        }

        #interaction-layer {
          position: absolute;
          left: var(--ruler);
          top: 0;
          width: calc(100% - var(--ruler));
          height: calc(100% - var(--ruler));
          z-index: 4; 
          cursor: grab;
        }
      </style>

      <canvas id="grid"></canvas>
      <div id="scene"></div>
      <div id="interaction-layer"></div>
      <canvas class="ruler-x"></canvas>
      <canvas class="ruler-y"></canvas>
      <canvas class="corner" id="corner"></canvas>
    `;

    this.$grid        = this.shadowRoot.getElementById('grid');
    this.$scene       = this.shadowRoot.getElementById('scene');
    this.$rx          = this.shadowRoot.querySelector('.ruler-x');
    this.$ry          = this.shadowRoot.querySelector('.ruler-y');
    this.$corner      = this.shadowRoot.getElementById('corner');
    this.$interaction = this.shadowRoot.getElementById('interaction-layer');

    const cs = getComputedStyle(this);
    this._baseCell  = parseFloat(cs.getPropertyValue('--cell-px')) || 40;
    this._baseUnits = parseFloat(cs.getPropertyValue('--units-per-cell')) || 10;
    this._ppuBase   = this._baseCell / this._baseUnits;
    
    this._scale     = 1;
    this._minScale  = 0.25;
    this._maxScale  = 20;
    this._panX      = 0;
    this._panY      = 0;  
    this._yMaxUnits = 550;
    this._xMaxUnits = 1700;

    this._niceStep = (ppu, targetPx = this._baseCell) => {
      const raw = targetPx / ppu;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const n = raw / pow;
      let m;
      if (n < 1.5) m = 1;
      else if (n < 3.5) m = 2;
      else if (n < 7.5) m = 5;
      else m = 10;
      return m * pow;
    };

    this._updateAllPolys = () => {
      this.$scene.querySelectorAll('svg').forEach(svg => {
        this._updateSvgAppearance(svg);
      });
    };

    this._onPointerDown = this._onPointerDown.bind(this);
    this.$interaction.addEventListener('mousedown', this._onPointerDown);
    this._onWheel = this._onWheel.bind(this);
    this.addEventListener('wheel', this._onWheel, { passive: false });

    const ro = new ResizeObserver(() => this.layoutAndDraw());
    ro.observe(this);
    this._ro = ro;

    requestAnimationFrame(() => {
      this.layoutAndDraw();
      this._loadFromStorage();
    });
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this.removeEventListener('wheel', this._onWheel);
    this.$interaction?.removeEventListener('mousedown', this._onPointerDown);
  }

// ── Public API ─────────────────────────────
  exportPolygons() {
  const out = [];
  this.$scene.querySelectorAll('svg').forEach(svg => {
    const poly = svg.querySelector('polygon');
    if (!poly) return;

    const pointsString = poly.getAttribute('points') || '';
    const numbers = pointsString.match(/-?[\d.]+/g) || []; 
    
    const points = [];

    for (let i = 0; i < numbers.length; i += 2) {
      if (numbers[i + 1] !== undefined) { 
        const x = parseFloat(numbers[i]);
        const y = parseFloat(numbers[i + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          points.push({ x, y });
        }
      }
    }

    out.push({
      points: points, 
      fill: poly.getAttribute('fill') || '#ccc',
      stroke: poly.getAttribute('stroke') || '#333',
      xUnits: +svg.dataset.xUnits,
      yUnits: +svg.dataset.yUnits,
      baseWidth: +svg.dataset.baseWidth || 120,
      baseHeight: +svg.dataset.baseHeight || 90,
    });
  });
  return out;
}

  importPolygons(list = [], {clear=true} = {}) {
    if (clear) this.clearPolygons();
    for (const item of list) {
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      const bw = item.baseWidth  ?? 120;
      const bh = item.baseHeight ?? 90;
      svg.setAttribute("width", bw);
      svg.setAttribute("height", bh);
      svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
      svg.dataset.baseWidth = bw;
      svg.dataset.baseHeight = bh;

      const polygon = document.createElementNS(svgNS, "polygon");
      polygon.setAttribute("points", item.points.map(pt => `${pt.x}, ${pt.y}`).join(" "));
      polygon.setAttribute("fill", item.fill);
      polygon.setAttribute("stroke", item.stroke);
      polygon.setAttribute("stroke-width", 1);
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      polygon.style.pointerEvents = 'auto';

      svg.appendChild(polygon);
      this.$scene.appendChild(svg);

      svg.dataset.xUnits = String(item.xUnits ?? 0);
      svg.dataset.yUnits = String(item.yUnits ?? 0);
      this._updateSvgAppearance(svg);
    }
    this._applyVisibilityByBounds();
  }

  clearPolygons() {
    this.$scene.querySelectorAll('svg').forEach(svg => svg.remove());
  }

  save() {
    try {
      const data = this.exportPolygons();
      localStorage.setItem(this.constructor.LS_KEY, JSON.stringify(data));
      console.info('Polygons saved:', data.length);
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  }

  reset() {
    try {
      localStorage.removeItem(this.constructor.LS_KEY);
      this.clearPolygons();
      console.info('Polygons reset');
      return true;
    } catch (e) {
      console.error('Reset failed', e);
      return false;
    }
  }

  addPolygon(polygonData, x, y) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");

    const baseWidth = 120;
    const baseHeight = 90;
    svg.setAttribute("width", baseWidth);
    svg.setAttribute("height", baseHeight);
    svg.setAttribute('viewBox', `0 0 ${baseWidth} ${baseHeight}`);
    svg.dataset.baseWidth = baseWidth;
    svg.dataset.baseHeight = baseHeight;

    const polygon = document.createElementNS(svgNS, "polygon");
    polygon.setAttribute(
      "points",
      polygonData.points.map(pt => `${pt.x}, ${pt.y}`).join(" ")
    );
    polygon.setAttribute("fill", polygonData.fill);
    polygon.setAttribute("stroke", polygonData.stroke);
    polygon.setAttribute("stroke-width", 1);
    polygon.setAttribute("vector-effect", "non-scaling-stroke");

    polygon.style.pointerEvents = 'auto';

    svg.appendChild(polygon);
    this.$scene.appendChild(svg);

    const logicalX = x / this._scale;
    const logicalY = y / this._scale;

    const logicalLeft = logicalX - baseWidth / 2;
    const logicalTop  = logicalY - baseHeight / 2;

    const { GL, GH } = this._gridLogical();
    const xUnits = (logicalLeft - GL - this._panX) / this._ppuBase;
    const yUnits = (GH - (logicalTop - this._panY)) / this._ppuBase;

    svg.dataset.xUnits = String(xUnits);
    svg.dataset.yUnits = String(yUnits);

    this._updateSvgAppearance(svg);
    return svg;
  }

  startDrag(e, svg) {
    e.preventDefault();
    e.stopPropagation();
    this.$interaction.style.cursor = 'grabbing';
    const hostRect = this.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    
    const offsetX = (e.clientX - svgRect.left) / this._scale;
    const offsetY = (e.clientY - svgRect.top) / this._scale;
    
    const onMouseMove = (ev) => {
      const desiredLogicalLeft = (ev.clientX - hostRect.left) / this._scale - offsetX;
      const desiredLogicalTop = (ev.clientY - hostRect.top) / this._scale - offsetY;

      const { LEFT_MIN, LEFT_MAX, TOP_MIN, TOP_MAX } = this._gridBoundsLogicalFor(svg);

      const finalLogicalLeft = this._clamp(desiredLogicalLeft, LEFT_MIN, LEFT_MAX);
      const finalLogicalTop = this._clamp(desiredLogicalTop, TOP_MIN, TOP_MAX);
      
      const { GL, GH } = this._gridLogical();
      svg.dataset.xUnits = String((finalLogicalLeft - GL - this._panX) / this._ppuBase);
      svg.dataset.yUnits = String((GH - (finalLogicalTop - this._panY)) / this._ppuBase);
      
      this._updateSvgAppearance(svg);
    };

    const onMouseUp = () => {
      this.$interaction.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
    const offsetY = (e.clientY - svgRect.top) / this._scale;

    const gridRect = this.$grid.getBoundingClientRect();
    const gridLeft = (gridRect.left - hostRect.left) / this._scale;
    const gridTop = (gridRect.top - hostRect.top) / this._scale;
    const gridRight = gridLeft + (gridRect.width / this._scale);
    const gridBottom = gridTop + (gridRect.height / this._scale);

    const poly = svg.querySelector('polygon');
    const bbox = poly.getBBox();

    const bufferEl = this.getRootNode()?.querySelector('buffer-zone');
    const bufferRect = bufferEl?.getBoundingClientRect();
    const bufferTopLocal = bufferRect ? (bufferRect.top - hostRect.top) / this._scale : 0;
    
    const LEFT_MAX_GRID = gridRight - (bbox.x + bbox.width);
    const TOP_MAX = gridBottom - (bbox.y + bbox.height);
    const TOP_MIN_BUF = bufferTopLocal - bbox.y;
    const LEFT_MIN =  gridLeft - bbox.x;

    const onMouseMove = (ev) => {
      let left = (ev.clientX - hostRect.left) / this._scale - offsetX;
      let top = (ev.clientY - hostRect.top) / this._scale - offsetY;

      if (left < LEFT_MIN) left = LEFT_MIN;
      if (left > LEFT_MAX_GRID) left = LEFT_MAX_GRID;
      if (top < TOP_MIN_BUF) top = TOP_MIN_BUF;
      if (top > TOP_MAX) top = TOP_MAX;

      svg.style.left = `${left * this._scale}px`;
      svg.style.top = `${top * this._scale}px`;

      const { GL, GH } = this._gridLogical();
      svg.dataset.xUnits = String((left - GL - this._panX) / this._ppuBase);
      svg.dataset.yUnits = String((GH - (top - this._panY)) / this._ppuBase);
    };

    const onMouseUp = () => {
      const workRect = this.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const poly = svg.querySelector('polygon');
      const polyRect = poly.getBoundingClientRect();

      const dividerEl = this.getRootNode()?.querySelector('buffer-divider');
      const dividerH = dividerEl ? dividerEl.getBoundingClientRect().height : 0;

      const polyTopLocal = polyRect.top - workRect.top;

      if (polyTopLocal < -dividerH) {
        svg.remove();
      } else if (polyTopLocal < 0) {
        const offsetInSvg = polyRect.top - svgRect.top;
        const targetTop = 0 - offsetInSvg;
        const newTopPx = Math.round(targetTop);
        svg.style.top = `${newTopPx}px`;

        const logicalTop = newTopPx / this._scale;
        const { GH } = this._gridLogical();
        svg.dataset.yUnits = String((GH - (logicalTop - this._panY)) / this._ppuBase);
      }

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

// ── Event handlers ─────────────────────────
    _onPointerDown(e) {
    if (e.button !== 0) return;

    this.$interaction.style.pointerEvents = 'none';
    const elementUnder = this.shadowRoot.elementFromPoint(e.clientX, e.clientY);
    this.$interaction.style.pointerEvents = 'auto';
    
    const svgTarget = elementUnder?.closest('svg');

    if (svgTarget) {
        this.startDrag(e, svgTarget);
    } else {
        this._onPanStart(e);
    }
  }

  _onPanStart(e) {
    this.$interaction.style.cursor = 'grabbing';
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const panX0 = this._panX;
    const panY0 = this._panY;
    
    const { GW, GH } = this._gridLogical();

    const onMouseMove = (ev) => {
      const dx = (ev.clientX - startX) / this._scale;
      const dy = (ev.clientY - startY) / this._scale;
      
      this._panX = this._clamp(panX0 + dx, -Math.max(0, this._xMaxPx() - GW), 0);
      this._panY = this._clamp(panY0 + dy, 0, Math.max(0, this._yMaxPx() - GH));

      this.drawGrid();
      this.drawRulerX();
      this.drawRulerY();
      this._updateAllPolys();
      this._applyVisibilityByBounds();
    };

    const onMouseUp = () => {
      this.$interaction.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  _onWheel(e) {
    e.preventDefault();

    const dir = e.deltaY < 0 ? 1 : -1;
    const step = 0.1;
    const prevScale = this._scale;
    const nextScale = this._clamp(prevScale * (1 + dir * step), this._minScale, this._maxScale);

    if (Math.abs(nextScale - prevScale) < 1e-5) return;

    const hostRect = this.getBoundingClientRect();
    const cursorX_host = e.clientX - hostRect.left;
    const cursorY_host = e.clientY - hostRect.top;

    const { GL: GL0, GH: GH0 } = this._gridLogical();
    const xLogical = cursorX_host / prevScale - GL0 - this._panX;

    const yLogical = GH0 - (cursorY_host / prevScale - this._panY);

    this._scale = nextScale;

    const { GL: GL1, GH: GH1, GW: GW1 } = this._gridLogical();

    const newPanX = cursorX_host / nextScale - GL1 - xLogical;
    const newPanY = cursorY_host / nextScale - GH1 + yLogical;
    const minPanX = -Math.max(0, this._xMaxPx() - GW1);
    const maxPanY = Math.max(0, this._yMaxPx() - GH1);
    
    this._panX = this._clamp(newPanX, minPanX, 0);
    this._panY = this._clamp(newPanY, 0, maxPanY);

    const ppu = this._ppuBase * this._scale;
    const unitsPerCell = this._niceStep(ppu, this._baseCell);
    const cellPx = unitsPerCell * ppu;

    this.style.setProperty('--units-per-cell', String(unitsPerCell));
    this.style.setProperty('--cell-px', String(+cellPx.toFixed(4)));

    this.layoutAndDraw();
    this._updateAllPolys();
    this._applyVisibilityByBounds();
  }

// ── Persistence ────────────────────────────
  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(this.constructor.LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) this.importPolygons(data, {clear:true});
    } catch (e) {
      console.warn('Failed to load saved polygons:', e);
    }
  }

// ── Rendering ──────────────────────────────  
  layoutAndDraw() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    this.$grid.style.top = '0px';
    this.$grid.style.height = 'calc(100% - var(--ruler))';

    this.$ry.style.top = '0px';
    this.$ry.style.height = 'calc(100% - var(--ruler))';

    const fit = (el) => {
      const r = el.getBoundingClientRect();
      const ctx = el.getContext('2d');
      el.width = Math.max(1, Math.floor(r.width * dpr));
      el.height = Math.max(1, Math.floor(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    this._ctxGrid = fit(this.$grid);
    this._ctxX = fit(this.$rx);
    this._ctxY = fit(this.$ry);
    this._ctxCorner = fit(this.$corner);

    this.drawGrid();
    this.drawRulerX();
    this.drawRulerY();
    this.drawCorner();
    this._updateAllPolys();
    this._applyVisibilityByBounds();
  }

  drawCorner() {
    const ctx = this._ctxCorner;
    const r = this.$corner.getBoundingClientRect();
    const w = r.width, h = r.height;

    ctx.fillStyle = '#e1e3e6';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('0', w / 2, h / 2);
  }

  drawGrid() {
    const ctx = this._ctxGrid;
    const r = this.$grid.getBoundingClientRect();
    const w = r.width, h = r.height;
    const cell = parseFloat(getComputedStyle(this).getPropertyValue('--cell-px')) || 40;
    const units = parseFloat(getComputedStyle(this).getPropertyValue('--units-per-cell')) || this._baseUnits;

    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(0, 0, w, h);

    const majorEach = 5;

    const cssPanX = this._panX * this._scale;
    const offX = ((cssPanX % cell) + cell) % cell;
    const baseIdxX = Math.floor(-cssPanX / cell);
    const maxIdxX = Math.floor(this._xMaxUnits / units);

    for (let k = 0; ; k++) {
      const xPix = Math.floor(k * cell + offX) + 0.5;
      if (xPix < -0.5) continue;
      if (xPix > w + 0.5) break;
      const i = baseIdxX + k;
      if (i < 0) continue;
      if (i > maxIdxX) break;
      ctx.beginPath();
      ctx.lineWidth = (i % majorEach === 0) ? 1.2 : 1;
      ctx.strokeStyle = (i % majorEach === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
      ctx.moveTo(xPix, 0);
      ctx.lineTo(xPix, h);
      ctx.stroke();
    }

    const cssPanY = this._panY * this._scale;
    const offY = ((cssPanY % cell) + cell) % cell;
    const baseIdxY = Math.floor(cssPanY / cell);
    const maxIdxY = Math.floor(this._yMaxUnits / units);

    for (let k = 0; ; k++) {
      const yPix = Math.floor(h - (k * cell - offY)) + 0.5;
      if (yPix < -0.5) break;
      if (yPix > h + 0.5) continue;
      const i = baseIdxY + k;
      if (i < 0) continue;
      if (i > maxIdxY) break; 
      ctx.beginPath();
      ctx.lineWidth = (i % majorEach === 0) ? 1.2 : 1;
      ctx.strokeStyle = (i % majorEach === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
      ctx.moveTo(0, yPix);
      ctx.lineTo(w, yPix);
      ctx.stroke();
    }
  }

  drawRulerX() {
    const ctx = this._ctxX;
    const r = this.$rx.getBoundingClientRect();
    const w = r.width, h = r.height;

    const units = parseFloat(getComputedStyle(this).getPropertyValue('--units-per-cell')) || this._baseUnits;
    const ppu   = this._ppuBase * this._scale;                 
    const cssPanX = this._panX * this._scale;

    const worldLeftU  = -cssPanX / ppu;
    const worldRightU = worldLeftU + w / ppu;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#4b4f56';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#e1e3e6';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let u = Math.ceil(worldLeftU / units) * units;

    const cornerW = parseFloat(getComputedStyle(this).getPropertyValue('--ruler')) || 26;
    while (u <= worldRightU + 1e-9) {
      const xPix = Math.round((u - worldLeftU) * ppu) + 0.5;

      if (Math.abs(u) < 1e-9 && xPix < cornerW + 8) { u += units; continue; }

      const label = String(u);
      const { w: tw, h: th } = this._metrics(ctx, label);
      if (this._fitsHorizCenter(xPix, tw, w, 1) && this._fitsVertMiddle(h / 2, th, h, 1, 1)) {
        ctx.fillText(label, xPix, h / 2);
      }
      u += units;
    }
  }

  drawRulerY() {
    const ctx = this._ctxY;
    const w = this.$ry.getBoundingClientRect().width;
    const h = this.$ry.getBoundingClientRect().height;
    const cell = parseFloat(getComputedStyle(this).getPropertyValue('--cell-px')) || 40;
    const units = parseFloat(getComputedStyle(this).getPropertyValue('--units-per-cell')) || 10;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#4b4f56';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#e1e3e6';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const xLeft = 4;
    const cssPanY = this._panY * this._scale;
    const off = ((cssPanY % cell) + cell) % cell;
    const baseIdx = Math.floor(cssPanY / cell);

    const maxIdx = Math.floor(this._yMaxUnits / units);
    for (let k = 0; ; k++) {
      const yPix = Math.floor(h - (k * cell - off)) + 0.5;
      if (yPix < -0.5) break;
      const i = baseIdx + k;
      if (i < 0) continue;
      if (i > maxIdx) break; 
      const labelUnits = i * units;
      const text = String(labelUnits);

      const { w: tw, h: th } = this._metrics(ctx, text);
      if (!this._fitsHorizLeft(xLeft, tw, w, 4, 2)) continue;
      if (!this._fitsVertMiddle(yPix, th, h, 1, 1)) continue;

      ctx.fillText(text, xLeft, yPix);
    }
  }

  _updateSvgAppearance(svg) {
    const xu = parseFloat(svg.dataset.xUnits ?? 'NaN');
    const yu = parseFloat(svg.dataset.yUnits ?? 'NaN');
    if (!Number.isFinite(xu) || !Number.isFinite(yu)) return;
    
    const baseWidth = parseFloat(svg.dataset.baseWidth);
    const baseHeight = parseFloat(svg.dataset.baseHeight);
    const scaledWidth = baseWidth * this._scale;
    const scaledHeight = baseHeight * this._scale;

    svg.setAttribute('width', scaledWidth);
    svg.setAttribute('height', scaledHeight);
    
    const { GL, GH } = this._gridLogical();
    const logicalLeft = GL + xu * this._ppuBase + this._panX;
    const logicalTop = GH - (yu * this._ppuBase) + this._panY;
    
    svg.style.left = `${Math.round(logicalLeft * this._scale)}px`;
    svg.style.top = `${Math.round(logicalTop * this._scale)}px`;
  }

  _applyVisibilityByBounds() {
    const hostRect = this.getBoundingClientRect();
    const gridRect = this.$grid.getBoundingClientRect();
    const viewLeft   = gridRect.left   - hostRect.left;
    const viewTop    = gridRect.top    - hostRect.top;
    const viewRight  = viewLeft  + gridRect.width;
    const viewBottom = viewTop   + gridRect.height;

    this.$scene.querySelectorAll('svg').forEach(svg => {
      const r = svg.getBoundingClientRect();
      const left   = r.left - hostRect.left;
      const top    = r.top  - hostRect.top;
      const right  = left + r.width;
      const bottom = top  + r.height;

      const overlaps = (left < viewRight && right > viewLeft && top < viewBottom && bottom > viewTop);

      if (!overlaps) {
        svg.style.visibility = 'hidden';
        svg.style.clipPath = '';
        return;
      }

      svg.style.visibility = 'visible';

      const topClip    = Math.max(0, viewTop    - top);
      const bottomClip = Math.max(0, bottom     - viewBottom);
      const leftClip   = Math.max(0, viewLeft   - left);
      const rightClip  = Math.max(0, right      - viewRight);

      if (topClip > 0.5 || bottomClip > 0.5 || leftClip > 0.5 || rightClip > 0.5) {
        svg.style.clipPath = `inset(${topClip}px ${rightClip}px ${bottomClip}px ${leftClip}px)`;
      } else {
        svg.style.clipPath = '';
      }
    });
  }

// ── Geometry / Utils ───────────────────────  
  _gridLogical() {
    const host = this.getBoundingClientRect();
    const g = this.$grid.getBoundingClientRect();
    const GL = (g.left - host.left) / this._scale ;
    const GT = (g.top - host.top) / this._scale ;
    const GW = g.width / this._scale;
    const GH = g.height / this._scale;
    const GR = GL + GW;
    const GB = GT + GH;
    return { GL, GT, GR, GB, GW, GH };
  }

  _yMaxPx() { return this._yMaxUnits * this._ppuBase; }
  _xMaxPx() { return this._xMaxUnits * this._ppuBase; }


  _clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  _metrics(ctx, label) {
    const m = ctx.measureText(label);
    const asc = m.actualBoundingBoxAscent ?? 8;
    const dsc = m.actualBoundingBoxDescent ?? 3;
    return { w: m.width ?? 0, h: asc + dsc };
  }

  _fitsVertMiddle(y, hText, hCanvas, padTop = 1, padBottom = 1) {
    return y - hText / 2 >= padTop && y + hText / 2 <= hCanvas - padBottom;
  }

  _fitsHorizCenter(x, wText, wCanvas, pad = 1) {
    return x - wText / 2 >= pad && x + wText / 2 <= wCanvas - pad;
  }

  _fitsHorizLeft(xLeft, wText, wCanvas, padLeft = 4, padRight = 2) {
    return xLeft >= padLeft && xLeft + wText <= wCanvas - padRight;
  }

  _gridBoundsLogicalFor(svg) {
    const { GL, GR, GH } = this._gridLogical();
    const viewTopWorld = 0;
    const viewBottomWorld = GH;
    const viewRightWorld = Math.min(GR, this._xMaxPx() + GL);

    const bbox = svg.querySelector('polygon').getBBox();

    return {
      LEFT_MIN: GL - bbox.x,
      LEFT_MAX: viewRightWorld - (bbox.x + bbox.width),
      TOP_MIN: viewTopWorld - bbox.y,
      TOP_MAX: viewBottomWorld - (bbox.y + bbox.height),
    };
  }  
}

customElements.define('work-zone', WorkZone);