/* Gift wrap toggle + message in the cart drawer (markup: snippets/gift-wrap.liquid). */
customElements.get('gift-wrap') || customElements.define('gift-wrap', class extends HTMLElement {
  connectedCallback() {
    const box = this.querySelector('input');
    const msg = this.querySelector('textarea');
    const id = this.dataset.variant;
    const save = () => this.post({ attributes: { Presentmeddelande: msg.value } });

    box.addEventListener('change', () => this.post({
      updates: { [id]: box.checked ? 1 : 0 },
      attributes: box.checked ? {} : { Presentmeddelande: '' },
    }, true));
    msg.addEventListener('input', debounce(save, 400));
    msg.addEventListener('change', save);

    if (this.dataset.fix !== undefined) {
      const qty = Number(this.dataset.fix);
      this.post({ updates: { [id]: qty }, attributes: qty ? {} : { Presentmeddelande: '' } }, true);
    }
  }

  post(body, render) {
    if (render) {
      body.sections = 'cart-drawer,cart-icon-bubble';
      this.setAttribute('aria-busy', 'true');
    }
    return fetch(routes.cart_update_url, { ...fetchConfig(), body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((state) => {
        if (!render || !state.sections) return;
        // Same swap as CartDrawerItems: only .drawer__inner, so the overlay keeps its close listener and the
        // drawer does not pop open when data-fix runs on page load.
        const parse = (html, sel) => new DOMParser().parseFromString(html, 'text/html').querySelector(sel);
        const inner = document.querySelector('#CartDrawer .drawer__inner');
        const bubble = document.getElementById('cart-icon-bubble');
        if (inner) inner.innerHTML = parse(state.sections['cart-drawer'], '.drawer__inner').innerHTML;
        if (bubble) bubble.innerHTML = parse(state.sections['cart-icon-bubble'], '.shopify-section').innerHTML;
        document.querySelector('cart-drawer')?.classList.toggle('is-empty', state.item_count === 0);
        if (this.dataset.fix === undefined) document.querySelector('gift-wrap input')?.focus();
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items', cartData: state });
      })
      .catch(() => this.removeAttribute('aria-busy'));
  }
});
