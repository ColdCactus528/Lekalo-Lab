import './controls-bar.js';
import './buffer-zone.js';
import './work-zone.js';
import './buffer-divider.js';

import { store, setBuffer } from '../store.js';
import { makeManySimple, makeManyConvex } from '../utils/polygen.js';

class AppRoot extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { 
          display: grid;
          grid-template-rows: auto 1fr;
          height: 100vh;
          min-height: 0;
          --header-h: 0px;
          --divider-h: 12px;
        }

        header { 
          padding: 12px 16px;
          border-bottom: 1px solid var(--border, #2b3342);
          background: linear-gradient(0deg, var(--panel, #151a21), #11161f);
          color: var(--text, #e9eef5);
          user-select: none;
        }
       
        main { 
          display: grid;
          grid-template-rows: 220px var(--divider-h) 1fr; 
          height: calc(100% - var(--header-h));
          border: none;
          background: var(--bg, #0f1216);
          position: relative;
          min-height: 0;
          overflow: hidden;
        }
       
        .buffer{
          position: relative;
          background: var(--panel, #151a21);
        }

        .work{
          position: relative;
          background: var(--panel, #151a21);
          min-height: 0;
        }
          
      </style>
      <header><strong>Triumph</strong> · <controls-bar></controls-bar></header>
      <main>
        <buffer-zone class="buffer"></buffer-zone>
        <buffer-divider></buffer-divider>
        <work-zone class="work"></work-zone>
      </main>
    `;

    const header = this.shadowRoot.querySelector('header');
    this._setHeaderHeight = () => {
      // ceil, чтобы убрать дробные пиксели и возможный 1px вертикальный скролл
      const hh = Math.ceil(header.getBoundingClientRect().height);
      this.style.setProperty('--header-h', `${hh}px`);
    };
    this._setHeaderHeight();

    this._headerRO = new ResizeObserver(this._setHeaderHeight);
    this._headerRO.observe(header);
    window.addEventListener('resize', this._setHeaderHeight);

    this.addEventListener('polys:create', (e)=> {
      let polys;
      if (e.detail.type === 'convex') {
        polys = makeManyConvex();
      } else {
        polys = makeManySimple();
      }

      setBuffer(polys);

      const bufferZone = this.shadowRoot.querySelector('buffer-zone');
      bufferZone.polygons = store.buffer;
    });


    this.addEventListener('polys:save', ()=>console.log('save'));
    this.addEventListener('polys:reset', ()=>console.log('reset'));
  }
}
customElements.define('app-root', AppRoot);