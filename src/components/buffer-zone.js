class BufferZone extends HTMLElement {
  connectedCallback() { 
    this.attachShadow({mode:'open'}); 
    this._polys = [];
    this._selectedId = null;
    this.render();
  }

  set polygons(v) {
   this._polys= v || [];
   this.render();
  }

  render() {
    const svgItems = this._polys.map(p => {
      const pointsStr = p.points.map(pt => `${pt.x},${pt.y}`).join(" ");
      
      const isSelected = this._selectedId === p.id;
      
      return `
        <svg width="120" height="90" viewBox="0 0 120 90" data-id="${p.id}">
          ${isSelected ? `
            <defs>
              <filter id="glow" height="150%" width="150%">
                <feDropShadow dx="0" dy="0" stdDeviation="6.5" flood-color="orange" flood-opacity="0.9"/>
              </filter>
            </defs>` : ''} 
        <polygon points="${pointsStr}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1" filter="${isSelected ? 'url(#glow)' : ''}"/>
        </svg>
      `;
    }).join(" ");

    this.shadowRoot.innerHTML = `
    <style>
      :host { 
        display: block; 
        padding: 8px; 
        overflow: auto; 
      }

      div[part="wrap"] { 
        position: relative; 
        display: flex; 
        flex-wrap: wrap;
      }

      svg { 
        pointer-events: auto;
        cursor: pointer;
        margin-right: 2px;
        margin-bottom: 3px; 
      }

    </style>
    <div part="wrap">
      ${svgItems || '<em>Нажмите «Создать»</em>'}
    </div>
    `;

    this.shadowRoot.querySelectorAll('svg').forEach(svg => {
      svg.addEventListener('click', () => {
        this._selectedId = svg.dataset.id;
        this.render();
      });

      svg.addEventListener('mousedown', e => {
        const polygon = this._polys.find(p => p.id === svg.dataset.id);
        const appRoot = this.getRootNode().host;
        const workZone = appRoot.shadowRoot.querySelector('work-zone'); 

        if(!workZone) return;

        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;

        const onMouseMove = ev => {
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);

          if(!dragging && (dx > 3 || dy > 3)) {
            dragging = true;
            workZone.startDragFromBuffer(ev, polygon);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          }
        };

        const onMouseUp = ev => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }
}

customElements.define('buffer-zone', BufferZone);