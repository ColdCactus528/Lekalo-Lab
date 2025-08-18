class BufferDivider extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host{
          display:block;
          height: var(--divider-h, 12px);
          pointer-events: none;               /* не перехватывать drag */
          background:
            linear-gradient(to bottom,
              rgba(255,255,255,.10),
              rgba(255,255,255,0));
          box-shadow: inset 0 -1px 0 rgba(255,255,255,.08);
        }
      </style>
      <div aria-hidden="true"></div>
    `;
  }
}
customElements.define('buffer-divider', BufferDivider);
