class ControlsBar extends HTMLElement {
  connectedCallback() {
    this.attachShadow({mode: 'open'});
    this.shadowRoot.innerHTML = `
      <style>
        :host, :host * {
          -webkit-user-select: none;
          -moz-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-tap-highlight-color: transparent;
        }

        button { margin-right: 8px; }
        select { margin-left: 12px; }
      </style>

      <button id="create">Создать</button>
      <button id="save">Сохранить</button>
      <button id="reset">Сбросить</button>
    
      <label>
        Тип:
        <select id="polyType">
          <option value="simple" selected>Обычные</option>
          <option value="convex">Выпуклые</option>
        </select>
      </label>
      `;

    const send = (type, detail={}) =>
      this.dispatchEvent( new CustomEvent(type,{detail,bubbles:true,composed:true}));

      this.shadowRoot.getElementById('create').onclick = () => {
        const type = this.shadowRoot.getElementById('polyType').value;
        send ('polys:create', { type });
      };

      this.shadowRoot.getElementById('save').onclick = () => send('polys:save');
      this.shadowRoot.getElementById('reset').onclick = () => send('polys:reset');
  }
}
customElements.define('controls-bar', ControlsBar);