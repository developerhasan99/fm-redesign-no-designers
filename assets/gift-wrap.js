/* Gift wrap, one per order (markup: snippets/gift-wrap.liquid).
   <gift-wrap>     cart drawer footer.
   <gift-wrap-pdp> product page, under the buy button. With products in the cart it sets the wrap right
                   away; with an empty cart it waits for the add to cart (a wrap alone is removed by the drawer).
   One request at a time: while one is in flight every gift wrap checkbox ignores clicks (rapid clicking). */
(() => {
  const parse = (html, sel) => new DOMParser().parseFromString(html, 'text/html').querySelector(sel);
  const all = (sel) => document.querySelectorAll(sel);
  let busy = false;

  const setBusy = (on) => {
    busy = on;
    all('gift-wrap, gift-wrap-pdp').forEach((el) => el.toggleAttribute('aria-busy', on));
  };

  // Wrap to 0 or 1, then repaint drawer + bubble. Same swap as CartDrawerItems (.drawer__inner only), so the
  // overlay keeps its close listener and the drawer does not pop open.
  const setWrap = (id, qty) => {
    setBusy(true);
    return fetch(routes.cart_update_url, {
      ...fetchConfig(),
      body: JSON.stringify({ updates: { [id]: qty }, sections: 'cart-drawer,cart-icon-bubble' }),
    })
      .then((r) => r.json())
      .then((state) => {
        if (!state.sections) throw new Error(state.description || 'cart update failed');
        const inner = document.querySelector('#CartDrawer .drawer__inner');
        const bubble = document.getElementById('cart-icon-bubble');
        if (inner) inner.innerHTML = parse(state.sections['cart-drawer'], '.drawer__inner').innerHTML;
        if (bubble) bubble.innerHTML = parse(state.sections['cart-icon-bubble'], '.shopify-section').innerHTML;
        document.querySelector('cart-drawer')?.classList.toggle('is-empty', state.item_count === 0);
        const inCart = state.items.some((i) => String(i.variant_id) === String(id));
        all('gift-wrap-pdp input').forEach((el) => { el.checked = inCart; });
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items', cartData: state });
      })
      .catch(() => all('gift-wrap input, gift-wrap-pdp input').forEach((el) => { el.checked = !qty; }))
      .finally(() => setBusy(false));
  };

  // Clicks (and Space on the focused box) while a request runs do not toggle the box.
  const guard = (box) => box.addEventListener('click', (e) => { if (busy) e.preventDefault(); });

  customElements.get('gift-wrap') || customElements.define('gift-wrap', class extends HTMLElement {
    connectedCallback() {
      const box = this.querySelector('input');
      const id = this.dataset.variant;
      guard(box);
      box.addEventListener('change', () => {
        setWrap(id, box.checked ? 1 : 0).then(() => document.querySelector('gift-wrap input')?.focus());
      });
      if (this.dataset.fix !== undefined) setWrap(id, Number(this.dataset.fix));
    }
  });

  customElements.get('gift-wrap-pdp') || customElements.define('gift-wrap-pdp', class extends HTMLElement {
    connectedCallback() {
      const box = this.querySelector('input');
      guard(box);
      box.addEventListener('change', () => {
        if (!document.querySelector('cart-drawer.is-empty')) setWrap(this.dataset.variant, box.checked ? 1 : 0);
      });
      this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, (e) => {
        if (e.source === 'product-form') this.afterAdd();
      });
    }

    disconnectedCallback() {
      this.unsubscribe?.();
    }

    // Called after a product lands in the cart (product-form event, or snippets/fmx-bundle-builder.liquid directly).
    afterAdd() {
      if (this.querySelector('input').checked) setWrap(this.dataset.variant, 1);
    }
  });
})();
