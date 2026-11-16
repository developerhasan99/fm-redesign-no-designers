/**
 * /search, designer perfume search (box B of PRICE-COMPARE.md): our scent on top, more of its scent family under
 * the heading, the retailer price list at the bottom. Same output as pmFrag.detect() (assets/pm-frag.js) gives the
 * header panel, the collection search and the finder.
 *
 * sections/main-search.liquid decides the mode with the Liquid twin (snippets/pm-frag-search-match.liquid) over this
 * page of Shopify results and loads this file in perfume mode and in house mode (data-pm-frag-mode="brand" on the
 * marker: only the price list, with up to 5 of the house's originals, see run()). Perfume mode prints:
 *   [data-pm-search-hero]            data-product-id = our scent made after the searched perfume (empty, hidden)
 *   [data-pm-search-family-heading]  settings.pm_family_heading, hidden when the list is empty
 *   the grid                         the other close matches on this page (the list without this script)
 *   [data-pm-search-price]           data-ids = our scent + up to 2 more close matches (empty, hidden)
 * This script:
 *   1. fills the hero at once (pmFrag.renderHero);
 *   2. runs pmFrag.detect on the header panel's index (window.pmSearch.loadIndex, cached in sessionStorage): the
 *      family's scents are not in these Shopify results ("aventus" finds No. 288, not the other woody scents).
 *      detect() gives the hero, `related` (other close matches, then our scents of the hero's family, most shared
 *      scent tags first, then catalogue order; max 5, hero left out) and `priceIds` (searched first, then the family);
 *   3. puts `related` in the grid in that order. Cards already on the page are reused, the others load from
 *      /products/<handle>?view=pm-search-card (templates/product.pm-search-card.liquid: no designer line, no badge;
 *      at most 3 requests at a time). Sorting or filtering replaces the list (assets/facets.js), so the list is put
 *      back each time. When the hero card cannot be shown, our scent heads the list instead;
 *   4. fills the price list (pmFrag.renderPrices) with `priceIds`.
 * Anything missing (index, detect() not in perfume mode, a card) keeps what Liquid printed: the hero, the close
 * matches on this page and prices for those.
 */
(() => {
  const marker = document.querySelector('[data-pm-frag-related]');
  if (!marker || marker.dataset.pmFragDone) return;
  marker.dataset.pmFragDone = '1';
  const raw = marker.dataset.pmFragQuery || '';
  // 'brand' (house search, e.g. "creed"): only the price list, with up to 5 of the house's originals; the grid and
  // the "Relaterade dofter" heading stay as Liquid printed them.
  const brandMode = marker.dataset.pmFragMode === 'brand';
  const heroEl = document.querySelector('[data-pm-search-hero]');
  const priceEl = document.querySelector('[data-pm-search-price]');
  const headingEl = document.querySelector('[data-pm-search-family-heading]');

  // Index item (snippets/pm-search-index.liquid) -> detect() fields. Designer words come from inspiration / brand or
  // the match-only k / kb of a masked scent; none of them is printed. scents = the scent:* tags only.
  const SCENT_TAG = /^\s*scent\s*:/i;
  const fields = (item) => ({
    id: item.id,
    title: item.title,
    name: item.inspiration || item.k,
    brand: item.brand || item.kb,
    family: item.family,
    scents: (Array.isArray(item.tags) ? item.tags : []).filter((tag) => SCENT_TAG.test(String(tag))),
  });

  // On this page #product-grid is the wrapper <div>; the cards sit in the <ul class="product-grid"> inside it.
  // Looked up every time: sorting and filtering put a new list in its place.
  const gridEl = () => document.querySelector('#ProductGridContainer ul.product-grid');

  // Weglot serves DK / FI / NO under its own folder; index URLs already carry the shopper's folder, so this
  // only puts a missing language folder back in front (otherwise the card would come back untranslated).
  const localUrl = (url) => {
    const folder = window.location.pathname.match(/^\/[a-z]{2}(?=\/[a-z]{2}-[a-z]{2}\/)/);
    return folder && !url.startsWith(`${folder[0]}/`) ? `${folder[0]}${url}` : url;
  };

  const loadCard = (item) => {
    const base = localUrl(String(item.url || ''));
    if (!base) return Promise.resolve(null);
    return fetch(`${base}${base.includes('?') ? '&' : '?'}view=pm-search-card`, { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.text() : ''))
      .then((html) => new DOMParser().parseFromString(html, 'text/html').querySelector('li.grid__item[data-pm-pid]'))
      .catch(() => null);
  };

  // At most 3 card requests at a time (the storefront answers bursts with 429); results keep the list order.
  const loadAll = (list) =>
    new Promise((resolve) => {
      const out = new Array(list.length).fill(null);
      let next = 0;
      let running = 0;
      const pump = () => {
        if (next >= list.length && running === 0) {
          resolve(out);
          return;
        }
        while (running < 3 && next < list.length) {
          const index = next;
          next += 1;
          running += 1;
          loadCard(list[index]).then((li) => {
            out[index] = li;
            running -= 1;
            pump();
          });
        }
      };
      pump();
    });

  // <li> cards for these index items, in their order: the ones on the page reused, the rest fetched; missing ones dropped.
  const cardsFor = (list) => {
    const grid = gridEl();
    const onPage = new Map();
    if (grid) grid.querySelectorAll(':scope > li[data-pm-pid]').forEach((li) => onPage.set(li.dataset.pmPid, li));
    const missing = list.filter((item) => !onPage.has(String(item.id)));
    return loadAll(missing).then((found) => {
      const fetched = new Map();
      missing.forEach((item, index) => {
        if (found[index]) fetched.set(String(item.id), document.importNode(found[index], true));
      });
      return list
        .map((item) => {
          const key = String(item.id);
          const li = onPage.has(key) ? onPage.get(key).cloneNode(true) : fetched.get(key) || null;
          // The searched scent's own card is printed hidden (main-search.liquid); a listed copy is a normal card.
          if (li) {
            li.removeAttribute('hidden');
            li.removeAttribute('data-pm-hero-card');
          }
          return li;
        })
        .filter(Boolean);
    });
  };

  // The final list; null = keep what Liquid printed.
  let rows = null;
  const DONE = 'data-pm-family-list';
  const apply = () => {
    const grid = gridEl();
    if (!rows || !grid || grid.hasAttribute(DONE)) return;
    grid.setAttribute(DONE, '');
    grid.querySelectorAll(':scope > li').forEach((li) => li.remove());
    rows.forEach((li) => grid.appendChild(li.cloneNode(true)));
    if (headingEl) headingEl.hidden = !rows.length;
  };
  let observing = false;
  const observe = () => {
    const box = document.getElementById('ProductGridContainer');
    if (observing || !box || !window.MutationObserver) return;
    observing = true;
    // Sorting / filtering swaps the list inside this box: put the family list back.
    new MutationObserver(apply).observe(box, { childList: true, subtree: true });
  };

  const idList = (value) =>
    String(value || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

  // The searched scent's own grid card (printed hidden): gone once the card on top is drawn, shown when it cannot be,
  // so the scent someone searched for never disappears from the page.
  const settleHeroCard = (shown) => {
    const grid = gridEl();
    const li = grid && grid.querySelector(':scope > li[data-pm-hero-card]');
    if (!li) return;
    if (shown) li.remove();
    else li.removeAttribute('hidden');
  };

  const run = () => {
    const frag = window.pmFrag;
    if (!frag || typeof frag.detect !== 'function') {
      settleHeroCard(false);
      return;
    }

    const showPrices = (ids, mode = 'perfume') => {
      if (!priceEl) return;
      priceEl.setAttribute('data-ids', ids.join(','));
      if (ids.length) frag.renderPrices(priceEl, ids, mode);
      else frag.clear(priceEl);
    };

    const search = window.pmSearch;
    const loadIndex = () =>
      search && typeof search.loadIndex === 'function' ? search.loadIndex().catch(() => null) : Promise.resolve(null);

    if (brandMode) {
      // Every scent of the house from the panel index; without it, the house's scents on this page.
      const pageIds = priceEl ? idList(priceEl.getAttribute('data-ids')) : [];
      loadIndex()
        .then((items) => {
          const result = Array.isArray(items) && items.length ? frag.detect(items, raw, fields) : null;
          const ids = result && result.mode === 'brand' && (result.priceIds || []).length ? result.priceIds : pageIds;
          showPrices(ids, 'brand');
        })
        .catch(() => showPrices(pageIds, 'brand'));
      return;
    }

    let heroId = heroEl ? heroEl.getAttribute('data-product-id') || '' : '';
    let heroShown = heroEl && heroId ? frag.renderHero(heroEl, heroId) : Promise.resolve(false);
    const fallbackPrices = priceEl ? idList(priceEl.getAttribute('data-ids')) : [];

    loadIndex()
      .then((items) => {
        const result = Array.isArray(items) && items.length ? frag.detect(items, raw, fields) : null;
        if (!result || result.mode !== 'perfume' || !result.hero) {
          showPrices(fallbackPrices);
          heroShown.then(settleHeroCard);
          return null;
        }
        if (heroEl && result.heroId && result.heroId !== heroId) {
          heroId = result.heroId;
          heroEl.setAttribute('data-product-id', heroId);
          heroShown = frag.renderHero(heroEl, heroId);
        }
        showPrices(result.priceIds || []);
        return Promise.all([heroShown, cardsFor(result.related || [])]).then(([shown, list]) =>
          shown ? list : cardsFor([result.hero]).then((hero) => hero.concat(list))
        );
      })
      .then((list) => {
        if (!list) return;
        rows = list;
        apply();
        observe();
      })
      .catch(() => {
        heroShown.then(settleHeroCard);
      });
  };

  // pm-frag.js is deferred in the head, so it normally exists by now; otherwise wait for it.
  const start = () => {
    if (window.pmFrag) run();
    else {
      document.addEventListener('pm:frag:ready', run, { once: true });
      // pm-frag.js never arrived (blocked or failed): show the searched scent's own card.
      window.addEventListener('load', () => {
        if (!window.pmFrag) settleHeroCard(false);
      }, { once: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
