/**
 * Search overlay (sections/pm-search-overlay.liquid), ported from magicperfume.co (mgx-search.js).
 *
 * - Opens from any [data-pm-search-open] (the header field .pm-hsearch, the field on the search page):
 *   one capture-phase click listener on the document. Triggers are <a href="/search">, so without JS (or
 *   with a modifier key) they still lead to the search page. A trigger with data-pm-search-query opens
 *   with that text in the field.
 * - Scents come from /collections/all?view=pm-search-index (snippets/pm-search-index.liquid), fetched
 *   once on first intent (pointer, touch or focus on a trigger, or the open itself) and kept in
 *   sessionStorage for 30 minutes. Typing then needs no network: every input event scores all scents
 *   with window.pmSearchCore (assets/pm-search-core.js).
 * - Enter opens the results page (/search?q=...), unless a row was picked with the arrow keys; then that
 *   scent. The set cards show on top of the results when the query asks for a bundle.
 * - The phone's back button closes it (history entry), Esc and the X too; the query is kept for the next
 *   open. Fires pm:search:open / pm:search:close on document and sets html.pm-search-open while open.
 * - Every text comes from the [data-pm-search-text] elements in the section (translated by Weglot with
 *   the page); rows carry only the scent number, the brand-free designer name (d) and the price.
 * - Search comparator (assets/pm-frag.js, contract PRICE-COMPARE.md): a query naming a designer perfume
 *   ("sauvage") shows our scent made after it as the hero card above the rows ([data-pm-search-frag]), the rows
 *   are the engine's related list under "Fler i samma doftfamilj" (other close matches, then our scents of the
 *   same scent family; the hero is not repeated), and the retailer price list follows the rows
 *   ([data-pm-search-price]). A house alone ("creed") lists our scents of that house under "Relaterade dofter".
 *   No badge, no percentage; rows print only the brand-free name (d); designer names appear only inside pmFrag's
 *   price list. A size added from the hero (pm:frag:added) closes the panel so the cart drawer shows. Any other
 *   query, and a page without window.pmFrag, works as before.
 *
 * window.pmSearch = { open(opener?, query?), close(), loadIndex() }
 */
(() => {
  if (window.pmSearch) return;

  const INDEX_KEY = 'pmSearchIndex:v6';
  const QUERY_KEY = 'pmSearchQuery:v1';
  const INDEX_TTL = 30 * 60 * 1000;
  const MAX_ROWS = 20;
  // Queries that ask for a bundle: the set cards come back on top of the results.
  const SET_WORDS = /^(paket|bundle|set|flask|flaskor|ml|presentask|present|gave|lahja)/;

  const designMode = () => !!(window.Shopify && window.Shopify.designMode);
  const getRoot = () => document.querySelector('[data-pm-search]');
  const fill = (template, values) =>
    String(template || '').replace(/\[(count|query)\]/g, (_, key) => (key in values ? values[key] : ''));
  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  const store = (method, key, value) => {
    try {
      return method === 'get' ? window.sessionStorage.getItem(key) : window.sessionStorage.setItem(key, value);
    } catch (e) {
      return null;
    }
  };

  // What a comparator container (hero / price list) was last asked to show: key = product id or id list,
  // seq = render generation, ok = null pending, true shown, false nothing to show.
  const newSlot = () => ({ key: '', seq: 0, ok: null });

  const state = {
    open: false,
    pushed: false, // our history entry is (or should be) on top
    restored: false, // opened because the page loaded on our history entry (reload, no bfcache)
    skipPop: 0,
    opener: null,
    prevOverflow: '',
    query: '',
    hits: [],
    total: 0,
    active: -1,
  };

  // ---------- elements ----------
  let ui = null;
  const getUi = () => {
    const root = getRoot();
    if (!root) return null;
    if (ui && ui.root === root) return ui;
    const text = {};
    root.querySelectorAll('[data-pm-search-text]').forEach((el) => {
      text[el.dataset.pmSearchText] = el.textContent.trim();
    });
    ui = {
      root,
      input: root.querySelector('.pm-search__input'),
      clear: root.querySelector('[data-pm-search-clear]'),
      start: root.querySelector('[data-pm-search-start]'),
      results: root.querySelector('[data-pm-search-results]'),
      sets: root.querySelector('[data-pm-search-sets]'),
      msg: root.querySelector('[data-pm-search-msg]'),
      frag: root.querySelector('[data-pm-search-frag]'),
      price: root.querySelector('[data-pm-search-price]'),
      heroSlot: newSlot(),
      priceSlot: newSlot(),
      list: root.querySelector('[data-pm-search-list]'),
      all: root.querySelector('[data-pm-search-all]'),
      emptyCats: root.querySelector('[data-pm-search-empty]'),
      status: root.querySelector('[data-pm-search-status]'),
      text,
    };
    if (!ui.input || !ui.list || !ui.results || !ui.start) {
      ui = null;
      return null;
    }
    bind(ui);
    return ui;
  };

  // ---------- index ----------
  let items = null;
  let loading = null;
  let failed = false;

  // The index carries formatted prices, so a cached copy is only valid for the same currency, language
  // and market.
  const cacheKey = (url) => {
    const shop = window.Shopify || {};
    const currency = (shop.currency && shop.currency.active) || '';
    return [url, currency, shop.locale || '', shop.country || ''].join('|');
  };

  const readCache = (key) => {
    try {
      const data = JSON.parse(store('get', INDEX_KEY) || 'null');
      if (data && data.k === key && Array.isArray(data.items) && Date.now() - data.t < INDEX_TTL) return data.items;
    } catch (e) {}
    return null;
  };

  const onIndexSettled = () => {
    if (state.open && ui && ui.input.value.trim()) render();
  };

  const loadIndex = () => {
    if (items) return Promise.resolve(items);
    if (loading) return loading;
    if (failed) return Promise.reject(new Error('pm-search: index failed'));
    const root = getRoot();
    const url = root && root.dataset.indexUrl;
    if (!url) return Promise.reject(new Error('pm-search: no index url'));
    const key = cacheKey(url);
    const cached = readCache(key);
    if (cached) {
      items = cached;
      onIndexSettled();
      return Promise.resolve(items);
    }
    loading = fetch(url, { credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error(`pm-search: index HTTP ${response.status}`);
        return response.text();
      })
      .then((body) => {
        const data = JSON.parse(body);
        if (!data || !Array.isArray(data.items)) throw new Error('pm-search: unexpected index');
        // Cached before any scoring, so the memoised haystacks (item._hay) never go into storage.
        store('set', INDEX_KEY, JSON.stringify({ t: Date.now(), k: key, items: data.items }));
        items = data.items;
        loading = null;
        onIndexSettled();
        return items;
      })
      .catch((error) => {
        loading = null;
        failed = true;
        onIndexSettled();
        throw error;
      });
    return loading;
  };

  const prefetch = () => {
    if (items || loading) return;
    loadIndex().catch(() => {});
  };

  // ---------- highlighting ----------
  // Folds one character the way pm-search-core folds text (ä/ö to ae/oe or plain, accents off,
  // apostrophes dropped, anything else non-alphanumeric to a space), so the bold parts can be mapped back
  // onto the original name.
  const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  const foldChar = (ch, umlauts) => {
    let text = ch.toLowerCase();
    if (/['’`]/.test(text)) return '';
    if (umlauts) text = text.replace(/[äöüß]/g, (letter) => UMLAUTS[letter]);
    try {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (e) {}
    return text
      .replace(/ß/g, 'ss')
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/ø/g, 'o')
      .replace(/[^a-z0-9]/g, ' ');
  };

  const foldMap = (text, umlauts) => {
    let folded = '';
    const starts = [];
    const ends = [];
    for (let i = 0; i < text.length; ) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      const out = foldChar(ch, umlauts);
      for (let k = 0; k < out.length; k += 1) {
        folded += out[k];
        starts.push(i);
        ends.push(i + ch.length);
      }
      i += ch.length;
    }
    return { folded, starts, ends };
  };

  // Same rules as the matcher: numbers as whole numbers (leading zeros ignored), terms up to 3 letters at
  // a word start, longer terms anywhere.
  const hitsIn = (folded, term) => {
    const found = [];
    if (/^\d+$/.test(term)) {
      const digits = /\d+/g;
      let match = digits.exec(folded);
      while (match) {
        if (match[0].replace(/^0+(?=\d)/, '') === term) found.push([match.index, match.index + match[0].length]);
        match = digits.exec(folded);
      }
      return found;
    }
    let at = folded.indexOf(term);
    while (at > -1) {
      if (term.length > 3 || at === 0 || folded[at - 1] === ' ') found.push([at, at + term.length]);
      at = folded.indexOf(term, at + 1);
    }
    return found;
  };

  const highlight = (value, terms) => {
    let text = String(value == null ? '' : value);
    try {
      text = text.normalize('NFC');
    } catch (e) {}
    if (!text || !terms.length) return escapeHtml(text);
    const ranges = [];
    [true, false].forEach((umlauts) => {
      const { folded, starts, ends } = foldMap(text, umlauts);
      terms.forEach((term) => {
        if (term) hitsIn(folded, term).forEach(([from, to]) => ranges.push([starts[from], ends[to - 1]]));
      });
    });
    if (!ranges.length) return escapeHtml(text);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    ranges.forEach(([from, to]) => {
      const last = merged[merged.length - 1];
      if (last && from <= last[1]) last[1] = Math.max(last[1], to);
      else merged.push([from, to]);
    });
    let html = '';
    let pos = 0;
    merged.forEach(([from, to]) => {
      html += `${escapeHtml(text.slice(pos, from))}<mark>${escapeHtml(text.slice(from, to))}</mark>`;
      pos = to;
    });
    return html + escapeHtml(text.slice(pos));
  };

  // ---------- rendering ----------
  const viewAllUrl = (shown) => {
    const base = (ui && ui.root.dataset.searchUrl) || '/search';
    return `${base}?q=${encodeURIComponent(shown)}`;
  };

  const setStatus = (line) => {
    if (ui && ui.status && ui.status.textContent !== line) ui.status.textContent = line;
  };

  const setActive = (index, scroll) => {
    if (!ui) return;
    // Rows only: a comparator search puts a heading item above the related rows (the hero and the price list sit
    // outside the list).
    const rows = ui.list.querySelectorAll('.pm-search__row');
    const previous = rows[state.active];
    if (previous) {
      previous.classList.remove('is-active');
      previous.setAttribute('aria-selected', 'false');
    }
    state.active = index >= 0 && index < rows.length ? index : -1;
    const row = rows[state.active];
    if (row) {
      row.classList.add('is-active');
      row.setAttribute('aria-selected', 'true');
      ui.input.setAttribute('aria-activedescendant', row.id);
      if (scroll) row.scrollIntoView({ block: 'nearest' });
    } else {
      ui.input.removeAttribute('aria-activedescendant');
    }
  };

  // One row = the FM row card (.pm-card--row): thumb, "No. 248", "Inspirerad av Versace Eros", price.
  // Without an inspiration (data still being filled in) the product title stands in.
  // Same meta line in every mode, comparator rows included (Adrian 15.11: only the L'Oréal / Coty houses lose the
  // "Inspirerad av" line; every other scent keeps it).
  const rowHtml = (item, index, terms) => {
    const id = `${ui.list.id}-opt-${index}`;
    const image = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" width="56" height="56" decoding="async"${
          index > 7 ? ' loading="lazy"' : ''
        }>`
      : '';
    // tryscent.co copy theme: the row title is the product title as it stands in the store (own scent names,
    // "<Name> - No. 234"), read from the index at render time; the inspiration line only when there is one.
    // Designer not named in search (m): no line at all, no match percentage either (Adrian 15.11); k / kb are never
    // printed. d is the brand-free name (NO-DESIGNERS.md), the only designer field a row prints, in every mode.
    const title = highlight(item.title, terms);
    const meta = !item.m && item.d ? `${escapeHtml(ui.text.inspired || '')} <b>${highlight(item.d, terms)}</b>` : '';
    const price = `${item.varies && ui.text.from ? `${escapeHtml(ui.text.from)} ` : ''}${escapeHtml(item.price)}`;
    const was = item.compare ? ` <s class="pm-card__compare">${escapeHtml(item.compare)}</s>` : '';
    const soldOut = item.available === false && ui.text.soldOut ? `<span class="pm-search__sold">${escapeHtml(ui.text.soldOut)}</span>` : '';
    return (
      `<li class="pm-search__row" id="${id}" role="option" aria-selected="false" data-index="${index}">` +
      `<a class="pm-card pm-card--row pm-search__link" href="${escapeHtml(item.url)}" tabindex="-1">` +
      `<span class="pm-card__media">${image}</span>` +
      `<span class="pm-card__body"><span class="pm-card__title">${title}</span>` +
      (meta ? `<span class="pm-card__meta pm-search__meta">${meta}</span>` : '') +
      `<span class="pm-card__price"><span>${price}</span>${was}${soldOut}</span></span>` +
      '</a></li>'
    );
  };

  const showRows = (html) => {
    ui.list.innerHTML = html;
    state.active = -1;
    ui.input.setAttribute('aria-expanded', html ? 'true' : 'false');
    if (!html) ui.input.removeAttribute('aria-activedescendant');
  };

  // ---------- comparator containers (assets/pm-frag.js, PRICE-COMPARE.md) ----------
  // pmFrag fills the hero and the price list asynchronously (the price feed loads on the first designer perfume
  // search). The same hero / id list is not rendered again on the next key, so the hero picture does not reload
  // and the price list keeps its chosen size, sort and open groups. Always reset through pmFrag.clear, which also
  // cancels a render still loading.
  const clearSlot = (el, slot) => {
    if (!el || !slot) return;
    if (!slot.key && el.hidden) return; // nothing shown, nothing loading
    slot.key = '';
    slot.seq += 1;
    slot.ok = null;
    if (window.pmFrag && typeof window.pmFrag.clear === 'function') {
      window.pmFrag.clear(el);
    } else {
      el.innerHTML = '';
      el.hidden = true;
    }
  };

  // run() starts the render now (pmFrag stamps the container on the call) and returns pmFrag's Promise<bool>.
  // onFail runs when this render (still the latest) ended with nothing shown.
  const fillSlot = (el, slot, key, run, onFail) => {
    if (!el || !slot) return;
    if (!key || !window.pmFrag) {
      clearSlot(el, slot);
      return;
    }
    if (slot.key === key) return;
    slot.key = key;
    slot.seq += 1;
    slot.ok = null;
    const seq = slot.seq;
    let pending;
    try {
      pending = run();
    } catch (error) {
      pending = Promise.reject(error);
    }
    Promise.resolve(pending).then(
      (shown) => {
        if (slot.seq !== seq) return;
        slot.ok = !!shown;
        if (!shown && onFail) onFail();
      },
      () => {
        if (slot.seq !== seq) return;
        window.pmFrag.clear(el);
        slot.ok = false;
        if (onFail) onFail();
      }
    );
  };

  const clearFrag = () => {
    if (!ui) return;
    clearSlot(ui.frag, ui.heroSlot);
    clearSlot(ui.price, ui.priceSlot);
  };

  // The hero card: our scent made after the searched perfume. When it cannot be shown (no feed, product not in
  // it), render() lists that scent as the first row instead, so the searched scent is never missing.
  const showHero = (heroId) => {
    const el = ui.frag;
    fillSlot(el, ui.heroSlot, heroId, () => window.pmFrag.renderHero(el, heroId), () => {
      if (state.open) render();
    });
  };

  // The retailer price list after the rows (pmFrag shows it only on the Swedish page in SEK). mode = detect()'s:
  // 'perfume' (searched perfume first, then its family) or 'brand' (up to 5 of the house's originals).
  const showPrices = (priceIds, mode) => {
    const el = ui.price;
    const ids = Array.isArray(priceIds) ? priceIds.map(String) : [];
    fillSlot(el, ui.priceSlot, ids.length ? `${mode}:${ids.join(',')}` : '', () => window.pmFrag.renderPrices(el, ids, mode));
  };

  // window.pmFrag.detect over the whole index (not only the hits). Designer words come from inspiration / brand,
  // or from the match-only k / kb of a masked scent; none of them is printed. family = custom.fragrance_family,
  // scents = only the scent tags (same family = same family key, most shared scent tags first). null = mode ''
  // (panel as before), also when pm-frag.js is missing (old cached page).
  const fragFields = (item) => ({
    id: item.id,
    title: item.title,
    name: item.inspiration || item.k,
    brand: item.brand || item.kb,
    family: item.family,
    scents: (Array.isArray(item.tags) ? item.tags : []).filter((tag) => /^scent:/i.test(String(tag))),
  });
  const fragDetect = (raw) => {
    const frag = window.pmFrag;
    if (!frag || typeof frag.detect !== 'function' || !Array.isArray(items)) return null;
    try {
      const result = frag.detect(items, raw, fragFields);
      return result && (result.mode === 'perfume' || result.mode === 'brand') ? result : null;
    } catch (e) {
      return null;
    }
  };

  let collator = null;
  try {
    collator = new Intl.Collator('sv');
  } catch (e) {}
  const byName = (a, b) => {
    const x = String((a && (a.d || a.title)) || '');
    const y = String((b && (b.d || b.title)) || '');
    return collator ? collator.compare(x, y) : x < y ? -1 : x > y ? 1 : 0;
  };

  // Scores every scent; shared with the results page (assets/pm-search-results.js). keepAll: scents that do not
  // match stay in, last (the house list of the comparator's 'brand' mode is already chosen, only the order is ours).
  const rank = (list, query, keepAll) => {
    const core = window.pmSearchCore;
    if (!core || !Array.isArray(list)) return [];
    const scored = [];
    list.forEach((item, order) => {
      const points = core.score(item, query);
      if (points > 0 || keepAll) scored.push([points, order, item]);
    });
    scored.sort((a, b) => b[0] - a[0] || byName(a[2], b[2]) || a[1] - b[1]);
    return scored.map((entry) => entry[2]);
  };

  const asksForSets = (terms) => terms.some((term) => SET_WORDS.test(term) || /^\d+(x\d*|ml)$/.test(term));

  function render() {
    if (!getUi()) return;
    const raw = ui.input.value;
    const shown = raw.trim();
    state.query = raw;
    store('set', QUERY_KEY, raw);
    if (ui.clear) ui.clear.hidden = !raw;
    const core = window.pmSearchCore;
    const query = core ? core.parseQuery(raw) : { terms: shown ? [shown] : [], compact: '' };
    state.hits = [];
    state.total = 0;

    if (!query.terms.length) {
      ui.start.hidden = false;
      ui.results.hidden = true;
      showRows('');
      clearFrag();
      setStatus('');
      return;
    }

    ui.start.hidden = true;
    ui.results.hidden = false;
    ui.all.href = viewAllUrl(shown);
    if (ui.emptyCats) ui.emptyCats.hidden = true;
    const sets = asksForSets(query.terms);
    if (ui.sets) ui.sets.hidden = !sets;

    // The index failed (or the matcher is missing): only the way to the full results page.
    if (!core || (!items && failed)) {
      showRows('');
      clearFrag();
      ui.msg.hidden = true;
      ui.all.textContent = fill(ui.text.viewAll, { query: shown, count: '' }).replace(/\s{2,}/g, ' ');
      ui.all.hidden = false;
      setStatus('');
      return;
    }

    if (!items) {
      // The results page works without the index, so its link is there while the scents load.
      showRows('');
      clearFrag();
      ui.msg.textContent = ui.text.loading || '';
      ui.msg.hidden = false;
      ui.all.textContent = fill(ui.text.viewAll, { query: shown, count: '' }).replace(/\s{2,}/g, ' ');
      ui.all.hidden = false;
      setStatus(ui.text.loading || '');
      prefetch();
      return;
    }

    // Comparator modes (PRICE-COMPARE.md): 'perfume' = hero card above the rows, the rows are the engine's
    // related list in its order (other close matches, then our scents of the same family; hero not repeated),
    // price list after the rows; 'brand' = every scent of that house in our ranking order; null = the hits as before.
    const frag = fragDetect(raw);
    const perfume = !!frag && frag.mode === 'perfume';
    const heroId = perfume && frag.hero && frag.heroId ? String(frag.heroId) : '';
    // The hero card could not be shown (no feed, product not in it): keep its slot, list the scent as a row.
    const heroFailed = !!heroId && ui.heroSlot.key === heroId && ui.heroSlot.ok === false;
    const heroCard = !!heroId && !heroFailed;
    const heroAsRow = perfume && !!frag.hero && !heroCard;
    const rows = frag
      ? perfume
        ? (heroAsRow ? [frag.hero] : []).concat(frag.related || [])
        : rank(frag.related, query, true)
      : rank(items, query);
    // The hero counts as one result, as the card on top or as the first row.
    state.total = rows.length + (heroCard ? 1 : 0);
    state.hits = rows.slice(0, MAX_ROWS);

    if (!state.hits.length && !heroCard) {
      showRows('');
      clearFrag();
      ui.all.hidden = true;
      if (sets) {
        // A bundle query with no scent in it ("paket"): the set cards are the answer.
        ui.msg.hidden = true;
        setStatus('');
        return;
      }
      const line = fill(ui.text.empty, { query: shown });
      ui.msg.textContent = line;
      ui.msg.hidden = false;
      if (ui.emptyCats) ui.emptyCats.hidden = false;
      setStatus(line);
      return;
    }

    if (frag) {
      // The headings replace the notice line; the button never repeats the query (it may be a designer name).
      ui.msg.hidden = true;
      if (perfume) {
        // A failed hero keeps its slot key (already empty and hidden), so it is not tried again on every key.
        if (heroCard) showHero(heroId);
        else if (!heroFailed) clearSlot(ui.frag, ui.heroSlot);
        showPrices(frag.priceIds, 'perfume');
      } else {
        // House search: no hero card; the house's originals in the price list.
        clearSlot(ui.frag, ui.heroSlot);
        showPrices(frag.priceIds, 'brand');
      }
      const plainText = state.total === 1 && ui.text.viewOnePlain ? ui.text.viewOnePlain : ui.text.viewAllPlain || ui.text.viewAll;
      ui.all.textContent = fill(plainText, { query: '', count: state.total }).replace(/\s{2,}/g, ' ').trim();
      ui.all.hidden = false;
      // "Fler i samma doftfamilj" (perfume) / "Relaterade dofter" (brand) over the related rows, only when there
      // are any; a hero shown as a row stays above it. Rows only in state.hits, so the arrow keys skip the heading.
      const lead = heroAsRow ? 1 : 0;
      const heading = state.hits.length > lead ? window.pmFrag.headingHtml(frag.mode) : '';
      showRows(
        state.hits
          .map((item, index) => {
            const head = index === lead && heading ? `<li class="pm-search__subhead" aria-hidden="true">${heading}</li>` : '';
            return head + rowHtml(item, index, query.terms);
          })
          .join('')
      );
      setStatus(fill(ui.text.count, { count: state.total }));
      return;
    }
    clearFrag();

    // A designer search (the query reached a scent through its hidden designer words): say these are the most
    // accurate matches and keep the query out of the button, so the panel never prints that name back.
    const designer = !!core.designerHit && state.hits.some((item) => core.designerHit(item, query));
    if (designer && ui.text.notice) {
      ui.msg.textContent = ui.text.notice;
      ui.msg.hidden = false;
    } else {
      ui.msg.hidden = true;
    }
    const allText = designer
      ? state.total === 1 && ui.text.viewOnePlain ? ui.text.viewOnePlain : ui.text.viewAllPlain || ui.text.viewAll
      : state.total === 1 && ui.text.viewOne ? ui.text.viewOne : ui.text.viewAll;
    ui.all.textContent = fill(allText, { query: shown, count: state.total });
    ui.all.hidden = false;
    showRows(state.hits.map((item, index) => rowHtml(item, index, query.terms)).join(''));
    setStatus(fill(ui.text.count, { count: state.total }));
  }

  const go = (url) => {
    if (url) window.location.assign(url);
  };

  // ---------- open / close ----------
  // The phone menu (Dawn's header-drawer) closes first, so its focus trap and scroll lock are gone before
  // the overlay takes over.
  const closeHeaderDrawer = () => {
    document.querySelectorAll('header-drawer, menu-drawer').forEach((drawer) => {
      const details = drawer.querySelector('details');
      if (!details || !details.hasAttribute('open')) return;
      const summary = details.querySelector('summary');
      try {
        drawer.closeMenuDrawer(new CustomEvent('pm:search:open'), summary);
      } catch (e) {
        details.classList.remove('menu-opening');
        details.removeAttribute('open');
        document.body.classList.remove('overflow-hidden-tablet', 'overflow-hidden-desktop', 'overflow-hidden-mobile');
      }
      if (summary) summary.setAttribute('aria-expanded', 'false');
    });
  };

  // A trigger inside a closed menu cannot take focus; the caller then tries the next target.
  const focusBack = (el) => {
    if (!el || !el.isConnected || typeof el.focus !== 'function') return false;
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  };

  const open = (opener, options = {}) => {
    if (!getUi()) return false;
    if (typeof options.query === 'string') ui.input.value = options.query;
    if (state.open) {
      if (typeof options.query === 'string') render();
      if (options.focus !== false) ui.input.focus({ preventScroll: true });
      return true;
    }
    closeHeaderDrawer();
    state.opener = opener || (document.activeElement !== document.body ? document.activeElement : null);
    state.open = true;
    ui.root.hidden = false;
    state.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.classList.add('pm-search-open');
    if (!ui.input.value && state.query) ui.input.value = state.query;
    // Focus in the same tap, so the phone keyboard comes up (iOS ignores focus() after a delay).
    if (options.focus !== false) {
      ui.input.focus({ preventScroll: true });
      try {
        const end = ui.input.value.length;
        ui.input.setSelectionRange(end, end);
      } catch (e) {}
    }
    // A failed index is tried again on every open; reset first, so a kept query shows the loading line
    // instead of the failure state while it loads.
    if (failed) failed = false;
    prefetch();
    render();
    if (options.fromHistory) {
      state.pushed = true;
    } else if (!designMode()) {
      try {
        window.history.pushState({ pmSearch: true }, '');
        state.pushed = true;
      } catch (e) {
        state.pushed = false;
      }
    }
    window.requestAnimationFrame(() => {
      if (state.open && ui) ui.root.classList.add('is-visible');
    });
    document.dispatchEvent(new CustomEvent('pm:search:open'));
    return true;
  };

  const close = (options = {}) => {
    if (!state.open) return;
    state.open = false;
    if (ui) {
      ui.root.classList.remove('is-visible');
      ui.root.hidden = true;
    }
    document.body.style.overflow = state.prevOverflow;
    document.documentElement.classList.remove('pm-search-open');

    const onOurEntry = !!(window.history.state && window.history.state.pmSearch);
    if (!options.fromHistory && state.pushed && onOurEntry) {
      if (state.restored) {
        // The page was reloaded on our entry, so the entry below belongs to an older document and going
        // back would reload the page: mark this entry as "closed" instead.
        try {
          window.history.replaceState(null, '');
        } catch (e) {}
      } else {
        state.skipPop += 1;
        window.history.back();
      }
    }
    state.pushed = false;
    state.restored = false;

    if (!options.keepFocus) {
      const opener = state.opener;
      if (!focusBack(opener)) {
        // Opened from the phone menu, which is closed now: back to the menu button.
        const drawer = opener && opener.closest && opener.closest('header-drawer, menu-drawer');
        focusBack(drawer && drawer.querySelector('summary'));
      }
    }
    state.opener = null;
    document.dispatchEvent(new CustomEvent('pm:search:close'));
  };

  // ---------- events inside the overlay ----------
  const focusables = (root) =>
    [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]')].filter(
      (el) => el.tabIndex > -1 && el.getClientRects().length > 0
    );

  const onInputKeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const count = state.hits.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!count) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      let next = state.active + step;
      if (next >= count) next = 0;
      if (next < 0) next = count - 1;
      setActive(next, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = state.hits[state.active];
      if (hit) go(hit.url);
      else if (ui.input.value.trim()) go(viewAllUrl(ui.input.value.trim()));
    }
  };

  const onRootKeydown = (event) => {
    if (event.key === 'Escape' || event.key === 'Esc') {
      // Also stops type="search" from clearing the field: the query is kept for the next open.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const list = focusables(ui.root);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !ui.root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !ui.root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const onRootClick = (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('[data-pm-search-close]')) {
      event.preventDefault();
      close();
      return;
    }
    if (target.closest('[data-pm-search-clear]')) {
      event.preventDefault();
      ui.input.value = '';
      render();
      ui.input.focus({ preventScroll: true });
      return;
    }
    const term = target.closest('[data-pm-search-term]');
    if (term) {
      event.preventDefault();
      ui.input.value = term.dataset.pmSearchTerm || term.textContent.trim();
      render();
      ui.input.focus({ preventScroll: true });
      try {
        const end = ui.input.value.length;
        ui.input.setSelectionRange(end, end);
      } catch (e) {}
      return;
    }
    // A click on the grey field around the input puts the caret in it.
    if (target.closest('.pm-search__field') && target !== ui.input) ui.input.focus({ preventScroll: true });
  };

  // The mouse only highlights; Enter still opens the results page unless the arrow keys picked a row.
  const onRootMousemove = (event) => {
    const row = event.target && event.target.closest && event.target.closest('.pm-search__row');
    ui.list.querySelectorAll('.is-hover').forEach((el) => {
      if (el !== row) el.classList.remove('is-hover');
    });
    if (row) row.classList.add('is-hover');
  };

  function bind(refs) {
    if (refs.root.dataset.pmSearchReady) return;
    refs.root.dataset.pmSearchReady = '1';
    refs.input.addEventListener('input', render);
    refs.input.addEventListener('keydown', onInputKeydown);
    refs.root.addEventListener('keydown', onRootKeydown);
    refs.root.addEventListener('click', onRootClick);
    refs.root.addEventListener('mousemove', onRootMousemove);
  }

  // ---------- page-level listeners ----------
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      const trigger = target && target.closest && target.closest('[data-pm-search-open]');
      if (!trigger) return;
      // Modified clicks open /search in a new tab, as the link says.
      if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!getUi()) return;
      event.preventDefault();
      // Dawn's details-modal closes on any body click; the overlay is not one of them.
      event.stopPropagation();
      const query = trigger.hasAttribute('data-pm-search-query') ? trigger.getAttribute('data-pm-search-query') : undefined;
      open(trigger, { query });
    },
    true
  );

  // Start loading the index as soon as a shopper is about to open the search.
  const onIntent = (event) => {
    if (items || loading) return;
    const target = event.target;
    if (target && target.closest && target.closest('[data-pm-search-open]')) prefetch();
  };
  document.addEventListener('pointerenter', onIntent, { capture: true, passive: true });
  document.addEventListener('touchstart', onIntent, { capture: true, passive: true });
  document.addEventListener('focusin', onIntent, true);

  // Focus that lands outside the open overlay comes back to the field.
  document.addEventListener('focusin', (event) => {
    if (!state.open || !ui || designMode()) return;
    if (event.target instanceof Node && !ui.root.contains(event.target)) ui.input.focus({ preventScroll: true });
  });

  // Steps onto or off our own entry only open or close the overlay; other popstate listeners (Dawn's
  // facets.js on collections, loaded after this file) must not see them.
  window.addEventListener('popstate', (event) => {
    if (state.skipPop > 0) {
      state.skipPop -= 1;
      event.stopImmediatePropagation();
      return;
    }
    const entry = event.state;
    if (entry && entry.pmSearch) {
      if (!state.open) open(null, { fromHistory: true, focus: false });
      event.stopImmediatePropagation();
    } else if (state.open) {
      close({ fromHistory: true });
      event.stopImmediatePropagation();
    }
  });

  // The matcher and the Fragrantica engine can arrive after this file.
  document.addEventListener('pm:search-core:ready', () => {
    if (state.open && ui && ui.input.value.trim()) render();
  });
  document.addEventListener('pm:frag:ready', () => {
    if (state.open && ui && ui.input.value.trim()) render();
  });

  // A size was added from the hero card (pmFrag): the cart drawer opens under the panel, so the panel closes.
  // The hero is emptied too, so the next open renders it fresh (no "added" state left on it).
  // Focus stays in the drawer; when the drawer closes it goes back to what opened the panel (the hero button that
  // gg-core recorded is hidden by then), as the finder does.
  document.addEventListener('pm:frag:added', () => {
    if (!state.open) return;
    const opener = state.opener;
    const drawer = document.querySelector('cart-drawer');
    close({ keepFocus: true });
    if (drawer && opener && opener.isConnected && typeof drawer.setActiveElement === 'function') drawer.setActiveElement(opener);
    if (ui) clearSlot(ui.frag, ui.heroSlot);
  });

  // ---------- theme editor ----------
  const holdsOverlay = (node) => !!(node && node.querySelector && node.querySelector('[data-pm-search]'));

  document.addEventListener('shopify:section:unload', (event) => {
    if (!holdsOverlay(event.target)) return;
    if (state.open) close({ fromHistory: true, keepFocus: true });
    ui = null;
  });

  document.addEventListener('shopify:section:load', (event) => {
    if (!holdsOverlay(event.target)) return;
    const wasOpen = state.open;
    if (wasOpen) {
      state.open = false;
      document.body.style.overflow = state.prevOverflow;
      document.documentElement.classList.remove('pm-search-open');
    }
    ui = null;
    if (!getUi()) return;
    if (state.query) ui.input.value = state.query;
    // No focus: the merchant is typing in the editor's sidebar.
    if (wasOpen) open(null, { fromHistory: true, focus: false });
  });

  document.addEventListener('shopify:section:select', (event) => {
    if (holdsOverlay(event.target)) open(null, { focus: false });
  });

  document.addEventListener('shopify:section:deselect', (event) => {
    if (holdsOverlay(event.target)) close({ fromHistory: true, keepFocus: true });
  });

  document.addEventListener('shopify:block:select', (event) => {
    const block = event.target;
    if (!block || !block.closest || !block.closest('[data-pm-search]')) return;
    if (state.open && ui && ui.input.value) {
      // Show the "before typing" screen, where the blocks are.
      ui.input.value = '';
      render();
    }
    open(null, { focus: false });
    if (block.scrollIntoView) block.scrollIntoView({ block: 'nearest' });
  });

  // ---------- start ----------
  const start = () => {
    if (!getUi()) return;
    // The page was reloaded (or restored without bfcache) on our history entry: show the overlay again
    // with the last query, so the next back press closes it as expected.
    const entry = window.history.state;
    if (entry && entry.pmSearch && !designMode() && !state.open) {
      state.query = store('get', QUERY_KEY) || '';
      if (open(null, { fromHistory: true, focus: false })) state.restored = true;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.pmSearch = {
    open: (opener, query) => open(opener || null, { query }),
    close: () => close(),
    loadIndex,
    rank,
  };
})();
