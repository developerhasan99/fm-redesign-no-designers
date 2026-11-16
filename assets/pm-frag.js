/**
 * Search comparator (window.pmFrag). One rule for the four search boxes:
 *   header panel (assets/pm-search.js), /search (sections/main-search.liquid + snippets/pm-frag-search-match.liquid),
 *   collection search (assets/pm-collection-search.js), "Find your scent" finder (assets/fuel06-finder.js).
 * Contract, data shapes and texts: PRICE-COMPARE.md in the repo. Replaces the Fragrantica card (Adrian 15.11).
 *
 * Modes for a query:
 *   'perfume'  the query names the designer perfume a scent is made after ("aventus", "oud wood"):
 *              hero = our scent made after it, shown as a card on top (family tag, notes, sizes; NO percentage);
 *              related = other close matches + our scents of the same scent family (max 5, no badge);
 *              priceIds = product ids for the price list: the searched perfume first, then its family.
 *   'brand'    the query names only a house ("creed", "ysl"): related = all our scents of that house. No hero;
 *              priceIds = the same scents, for a price list of up to 5 of the house's originals (no "searched" one).
 *   ''         anything else: the box behaves as before.
 * Designer names are printed ONLY inside the price list (renderPrices), Swedish market only (SEK + Swedish page).
 *
 * API:
 *   fold(str)                         folded text, same folding as pm-search-core ("Lancôme" -> "lancome")
 *   lang()                            'sv' | 'en' (Weglot language)
 *   texts()                           settings texts (hidden page text from snippets/pm-frag-texts.liquid, Weglot-translated)
 *   familyKey(family)                 folded scent family used for "same family" (Vedartad = Träig, Akvatisk/Marin = Fräsch)
 *   detect(items, query, get)         { mode, hero, heroId, close, related, priceIds }
 *                                     get(item) -> { id, title, name, brand, family, scents }
 *                                     scents = the item's scent tags (with or without the "scent:" prefix), only those
 *   headingHtml(mode)                 heading over the related list: 'perfume' = familyHeading, 'brand' = relatedHeading
 *   loadFeed()                        Promise<feed|null> (/collections/all?view=pm-price-feed, sessionStorage 30 min)
 *   renderHero(el, productId)         Promise<bool>; fills el with our scent's card, hides el when there is none
 *   renderPrices(el, priceIds, mode)  Promise<bool>; fills el with the price list, hides el when not shown. mode = detect()'s
 *                                     mode: 'perfume' (default) = the first id is the searched perfume, 'brand' = no first
 *   clear(el)                         empties + hides el and cancels a pending render into it (use instead of innerHTML = '')
 *   badgeHtml(), cardsHtml(), localize()  kept for old callers: return '' / do nothing
 * Fires 'pm:frag:ready' on document; 'pm:frag:added' (detail { id }) after a hero size was added to the cart.
 * Safe to load twice.
 */
(() => {
  if (window.pmFrag) return;

  // Same folding as assets/pm-search-core.js fold() (ä -> ae, accents off, punctuation -> space).
  const UMLAUTS = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
  const fold = (value) => {
    let text = String(value == null ? '' : value).toLowerCase();
    try {
      text = text.normalize('NFC');
    } catch (e) {}
    text = text.replace(/[äöüß]/g, (letter) => UMLAUTS[letter]);
    try {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (e) {}
    return text
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/ø/g, 'o')
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  };

  // Names shoppers use for the same house (folded). A brand in this list also answers to the other names.
  const BRAND_GROUPS = [
    ['jean paul gaultier', 'jpgaultier', 'jp gaultier', 'jpg', 'gaultier'],
    ['yves saint laurent', 'ysl', 'saint laurent'],
    ['maison francis kurkdjian', 'maison francis', 'mfk', 'kurkdjian'],
    ['dolce gabbana', 'dolce and gabbana', 'dg'],
    ['louis vuitton', 'lv'],
    ['thierry mugler', 'mugler'],
    ['paco rabanne', 'rabanne'],
    ['giorgio armani', 'emporio armani', 'armani'],
    ['christian dior', 'dior'],
    ['carolina herrera', 'herrera'],
    ['tom ford', 'tomford'],
    ['escentric molecules', 'molecules'],
    ['by kilian', 'kilian'],
    ['tiziana terenzi', 'terenzi'],
    ['le labo', 'lelabo'],
    ['viktor rolf', 'viktor and rolf', 'viktorrolf'],
  ];
  // Ignored in a query ("chanel no 5", "sauvage by dior").
  // Italian "di" too, so typing "di" on the way to "dior" does not jump to Acqua di Gio; "herr" / "dam" are gender
  // searches (and "herr" starts "Herrera").
  const FILLER = new Set(['no', 'nr', 'n', 'de', 'du', 'di', 'da', 'del', 'the', 'by', 'for', 'pour', 'la', 'le', 'les', 'l', 'of', 'och', 'and', 'from', 'herr', 'herre', 'dam']);
  // Must still match the name, but cannot start a perfume match alone ("intense", "elixir", "black").
  const GENERIC = new Set([
    'intense', 'intensely', 'parfum', 'perfume', 'elixir', 'eau', 'homme', 'femme', 'her', 'him', 'men', 'women',
    'man', 'woman', 'edp', 'edt', 'cologne', 'absolu', 'extrait', 'extreme', 'black', 'noir', 'rouge', 'blanc', 'gold',
    'oud', 'pure', 'sport', 'night', 'nuit', 'fresh', 'original', 'new', 'red', 'white', 'rose', 'vanilla', 'vanilj',
  ]);

  const brandCache = new Map();
  const brandInfo = (brand) => {
    const key = fold(brand);
    if (brandCache.has(key)) return brandCache.get(key);
    const phrases = key ? [key] : [];
    if (key) {
      BRAND_GROUPS.forEach((group) => {
        if (group.includes(key) || group.some((phrase) => ` ${key} `.includes(` ${phrase} `))) {
          group.forEach((phrase) => {
            if (!phrases.includes(phrase)) phrases.push(phrase);
          });
        }
      });
    }
    const words = new Set();
    phrases.forEach((phrase) => phrase.split(' ').forEach((word) => word && words.add(word)));
    const info = { phrases, words, compact: phrases.map((phrase) => phrase.replace(/ /g, '')) };
    brandCache.set(key, info);
    return info;
  };

  // Terms that must be a whole word: one letter, a number, or 2-3 letters that also start a word of one of our own
  // titles ("an" on the way to "Ananas", "van" to "Vanilj") or an ignored word ("her" on the way to "herr").
  // Every other term matches a word start, so "sa" / "sau" already find Sauvage while typing.
  const fillerStarts = [...FILLER];
  const exactTerms = (terms, paddedTitles) => {
    const exact = new Set();
    terms.forEach((term) => {
      if (term.length < 2 || /^\d+$/.test(term)) exact.add(term);
      else if (term.length <= 3 && (paddedTitles.includes(` ${term}`) || fillerStarts.some((word) => word.startsWith(term)))) {
        exact.add(term);
      }
    });
    return exact;
  };
  const wordHit = (padded, term, exact) => (exact.has(term) ? padded.includes(` ${term} `) : padded.includes(` ${term}`));
  // A generic word, or the start of one ("int" on the way to "intense"), cannot start a perfume match alone.
  const genericWords = [...GENERIC];
  const isGeneric = (term, exact) => GENERIC.has(term) || (!exact.has(term) && genericWords.some((word) => word.startsWith(term)));

  const perfumeHit = (name, title, brand, terms, compactQuery, exact) => {
    const rest = terms.filter((term) => !brand.words.has(term) && !FILLER.has(term));
    if (rest.length && rest.some((term) => !isGeneric(term, exact))) {
      // The name without its house words: "Carolina Herrera Very Good Girl" must not match "herr" or "vers" through the house.
      const paddedName = ` ${name.split(' ').filter((word) => word && !brand.words.has(word)).join(' ')} `;
      const paddedTitle = ` ${title} `;
      const hitsName = rest.every((term) => wordHit(paddedName, term, exact));
      // The query is our own scent's title ("ananas rök"), not the designer perfume.
      const hitsTitle = rest.every((term) => wordHit(paddedTitle, term, exact));
      if (hitsName && !hitsTitle) return true;
    }
    // The whole name typed inside the query, also without spaces ("dior sauvage", "lostcherry"); names stored with
    // the house in front ("Tom Ford Lost Cherry") count without it too.
    const core = name
      .split(' ')
      .filter((word) => word && !brand.words.has(word))
      .join('');
    return [name.replace(/ /g, ''), core].some(
      (compactName) => compactName.length >= 6 && /[a-z]/.test(compactName) && compactQuery.includes(compactName)
    );
  };

  const brandHit = (brand, terms, compactQuery, exact) => {
    if (!brand.phrases.length) return false;
    const rest = terms.filter((term) => !FILLER.has(term));
    if (!rest.length) return false;
    const words = [...brand.words];
    const allWords = rest.every((term) =>
      exact.has(term) ? brand.words.has(term) : words.some((word) => word.startsWith(term))
    );
    return allWords || brand.compact.includes(compactQuery);
  };

  // ---------- scent family ----------
  // One-off families that belong to a bigger one (store data 15.11: Vedartad x1 = woody, Akvatisk/Marin x1 = fresh).
  const FAMILY_ALIAS = { vedartad: 'traeig', 'akvatisk marin': 'fraesch', akvatisk: 'fraesch', marin: 'fraesch' };
  const familyKey = (value) => {
    const first = Array.isArray(value) ? value[0] : String(value == null ? '' : value).split(',')[0];
    const key = fold(first);
    return FAMILY_ALIAS[key] || key;
  };
  const scentSet = (list) => {
    const out = new Set();
    (Array.isArray(list) ? list : []).forEach((entry) => {
      const key = fold(String(entry == null ? '' : entry).replace(/^\s*scent\s*:/i, ''));
      if (key) out.add(key);
    });
    return out;
  };
  // Our scents of the anchor's family, most shared scent tags first, then the box's own order.
  const peersOf = (rows, anchor, skip) => {
    const family = familyKey(anchor.data.family);
    if (!family) return [];
    const mine = scentSet(anchor.data.scents);
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !skip.has(row.item) && familyKey(row.data.family) === family)
      .map((entry) => {
        let shared = 0;
        scentSet(entry.row.data.scents).forEach((scent) => {
          if (mine.has(scent)) shared += 1;
        });
        return { ...entry, shared };
      })
      .sort((a, b) => b.shared - a.shared || a.index - b.index)
      .map((entry) => entry.row);
  };

  const RELATED_MAX = 5;
  const PRICE_CANDIDATES = 10;
  const BRAND_PRICE_CANDIDATES = 20;

  const lang = () => {
    let code = '';
    try {
      if (window.Weglot && typeof window.Weglot.getCurrentLang === 'function') code = window.Weglot.getCurrentLang() || '';
    } catch (e) {}
    if (!code) code = document.documentElement.getAttribute('lang') || 'sv';
    return String(code).toLowerCase().startsWith('sv') ? 'sv' : 'en';
  };

  const DEFAULT_TEXTS = {
    cta: 'Se doftprofilen på Fragrantica',
    closeHeading: 'TryScents egna produkter · doftfamiljen {family}',
    familyTag: 'Samma doftfamilj: {family}',
    heroHint: 'Tryck på en storlek för att lägga den i varukorgen.',
    heroAdded: 'Tillagd i varukorgen',
    heroCta: 'Se doften',
    inspired: 'Inspirerad av',
    familyHeading: 'Fler i samma doftfamilj',
    relatedHeading: 'Relaterade dofter',
    priceDivider: 'Butikspriser för din sökning',
    priceTitle: 'Prisinformation från återförsäljare',
    priceIntro:
      'Originalprodukter från andra varumärken, sålda av fristående återförsäljare. TryScent säljer inte produkterna och har ingen koppling till varumärkena.',
    priceSearched: 'Din sökning',
    pricePeers: 'Andra parfymer i samma doftfamilj',
    priceBrand: 'Parfymer som matchar din sökning',
    priceAllSizes: 'Alla storlekar',
    priceSortLabel: 'Sortera',
    priceSortPrice: 'Pris',
    priceSortMl: 'Pris per ml',
    priceSortShop: 'Butik',
    priceRead: 'Avläst {date}',
    priceMore: 'Visa alla butiker ({n})',
    priceLess: 'Visa färre',
    priceNone: 'Inga butikspriser hittades för den här parfymen.',
    priceHowTitle: 'Så tas priserna fram',
  };
  let textCache = null;
  const texts = () => {
    if (textCache) return textCache;
    const found = {};
    document.querySelectorAll('[data-pm-frag-text]').forEach((node) => {
      const value = node.textContent.trim();
      if (value) found[node.getAttribute('data-pm-frag-text')] = value;
    });
    const how = [];
    document.querySelectorAll('[data-pm-frag-how]').forEach((node) => {
      const value = node.textContent.trim();
      if (value) how.push(value);
    });
    const result = { ...DEFAULT_TEXTS, ...found, how };
    // Cache once the page texts exist (Weglot may still be translating them before that).
    if (Object.keys(found).length) textCache = result;
    return result;
  };
  const fill = (template, values) =>
    String(template == null ? '' : template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  // ---------- detect ----------
  const NONE = Object.freeze({ mode: '', hero: null, heroId: '', close: [], related: [], priceIds: [], cards: [] });

  const detect = (items, rawQuery, get) => {
    const folded = fold(rawQuery);
    const terms = folded ? folded.split(' ') : [];
    if (!terms.length || terms.every((term) => /^\d+$/.test(term) || FILLER.has(term))) return NONE;
    const compactQuery = terms.filter((term) => !FILLER.has(term)).join('');
    if (compactQuery.length < 2) return NONE;
    const close = [];
    const related = [];
    const rows = [];
    (items || []).forEach((item) => {
      const data = get(item);
      if (data) rows.push({ item, data, title: fold(data.title), house: brandInfo(data.brand) });
    });
    const exact = exactTerms(terms, ` ${rows.map((row) => row.title).join(' ')} `);
    rows.forEach((row) => {
      const name = fold(row.data.name);
      if (name && perfumeHit(name, row.title, row.house, terms, compactQuery, exact)) {
        close.push({ row, name });
      } else if (brandHit(row.house, terms, compactQuery, exact)) {
        related.push(row.item);
      }
    });
    if (close.length) {
      // "le male": filler words are optional, but names that contain them win ("Le Male" over "Ultra Male").
      const fillers = terms.filter((term) => FILLER.has(term));
      if (fillers.length) {
        const strict = close.filter((entry) => fillers.every((term) => ` ${entry.name} `.includes(` ${term} `)));
        if (strict.length) close.splice(0, close.length, ...strict);
      }
      const wanted = terms.filter((term) => !FILLER.has(term)).join(' ');
      close.sort((a, b) => {
        const exactA = a.name === wanted || wanted.endsWith(` ${a.name}`) ? 0 : 1;
        const exactB = b.name === wanted || wanted.endsWith(` ${b.name}`) ? 0 : 1;
        return exactA - exactB || a.name.length - b.name.length || a.name.localeCompare(b.name);
      });
      const heroRow = close[0].row;
      const closeItems = close.map((entry) => entry.row.item);
      const peers = peersOf(rows, heroRow, new Set(closeItems));
      // Other close matches only when they share the hero's family: everything under "Fler i samma doftfamilj" and
      // in the price list must really be the same family (lawyer's rule: compare against a family).
      const heroFamily = familyKey(heroRow.data.family);
      const sameFamilyClose = close
        .slice(1)
        .map((entry) => entry.row)
        .filter((row) => heroFamily && familyKey(row.data.family) === heroFamily);
      const relatedItems = sameFamilyClose
        .concat(peers)
        .map((row) => row.item)
        .slice(0, RELATED_MAX);
      const priceIds = [];
      const pushId = (row) => {
        const id = row && row.data.id != null ? String(row.data.id) : '';
        if (id && !priceIds.includes(id) && priceIds.length < PRICE_CANDIDATES) priceIds.push(id);
      };
      pushId(heroRow);
      sameFamilyClose.slice(0, 2).forEach(pushId);
      peers.forEach(pushId);
      return {
        mode: 'perfume',
        hero: heroRow.item,
        heroId: heroRow.data.id != null ? String(heroRow.data.id) : '',
        close: closeItems,
        related: relatedItems,
        priceIds,
        cards: [],
      };
    }
    if (related.length) {
      // House search: the price list takes the house's originals in the related order (renderPrices keeps the first 5
      // that have shop prices, one per original).
      const priceIds = [];
      related.forEach((item) => {
        const row = rows.find((entry) => entry.item === item);
        const id = row && row.data.id != null ? String(row.data.id) : '';
        if (id && !priceIds.includes(id) && priceIds.length < BRAND_PRICE_CANDIDATES) priceIds.push(id);
      });
      return { mode: 'brand', hero: null, heroId: '', close: [], related, priceIds, cards: [] };
    }
    return NONE;
  };

  const headingHtml = (mode) => {
    const text = texts();
    const value = mode === 'perfume' ? text.familyHeading : mode === 'brand' ? text.relatedHeading : '';
    return value ? `<p class="pm-frag__heading">${escapeHtml(value)}</p>` : '';
  };

  // ---------- feed ----------
  const FEED_KEY = 'pmPriceFeed:v2';
  const FEED_TTL = 30 * 60 * 1000;
  let feed = null;
  let feedLoading = null;
  const attr = (name) => {
    const node = document.querySelector(`[${name}]`);
    return node ? node.getAttribute(name) : '';
  };
  const feedUrl = () => attr('data-pm-price-feed');
  // Shop prices: the snapshot file assets/pm-retail-offers.json (tools/retail-prices), {"p":{"<product id>":{"offers":[..]}}}.
  // Its asset URL carries a version, so a refreshed snapshot also invalidates the cached feed below.
  const offersUrl = () => attr('data-pm-retail-offers');
  // The feed carries formatted prices: a cached copy is only valid for the same currency, language and market.
  const feedCacheKey = (url) => {
    const shop = window.Shopify || {};
    return [url, offersUrl(), (shop.currency && shop.currency.active) || '', shop.locale || '', shop.country || ''].join('|');
  };
  const getJson = (url) =>
    fetch(url, { credentials: 'same-origin' }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  const loadFeed = () => {
    if (feed) return Promise.resolve(feed);
    if (feedLoading) return feedLoading;
    const url = feedUrl();
    if (!url) return Promise.resolve(null);
    const key = feedCacheKey(url);
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(FEED_KEY) || 'null');
      if (cached && cached.k === key && Date.now() - cached.t < FEED_TTL && cached.d && cached.d.p) {
        feed = cached.d;
        return Promise.resolve(feed);
      }
    } catch (e) {}
    const shopPrices = offersUrl() ? getJson(offersUrl()).catch(() => null) : Promise.resolve(null);
    feedLoading = Promise.all([getJson(url), shopPrices])
      .then(([data, offers]) => {
        if (!data || typeof data.p !== 'object') throw new Error('unexpected feed');
        const byProduct = offers && offers.p && typeof offers.p === 'object' ? offers.p : {};
        Object.keys(data.p).forEach((id) => {
          const entry = data.p[id];
          if (entry && entry.o) entry.o.x = byProduct[id] || null;
        });
        feed = data;
        feedLoading = null;
        try {
          window.sessionStorage.setItem(FEED_KEY, JSON.stringify({ t: Date.now(), k: key, d: data }));
        } catch (e) {}
        return feed;
      })
      .catch((error) => {
        feedLoading = null;
        if (window.console) console.warn('pmFrag: price feed', error);
        return null;
      });
    return feedLoading;
  };

  // ---------- render bookkeeping ----------
  let tokenSeq = 0;
  const stamp = (el) => {
    tokenSeq += 1;
    const token = String(tokenSeq);
    el.setAttribute('data-pm-frag-token', token);
    return token;
  };
  const isCurrent = (el, token) => el.getAttribute('data-pm-frag-token') === token;
  const clear = (el) => {
    if (!el) return;
    stamp(el);
    el.innerHTML = '';
    el.hidden = true;
  };
  const renderInto = (el, build) => {
    if (!el) return Promise.resolve(false);
    const token = stamp(el);
    return loadFeed().then((data) => {
      if (!isCurrent(el, token)) return false;
      const html = data ? build(data) : '';
      el.innerHTML = html;
      el.hidden = !html;
      return !!html;
    });
  };

  // ---------- hero (our scent) ----------
  const productHref = (url, variantId) => `${url}${String(url).includes('?') ? '&' : '?'}variant=${variantId}`;

  const heroHtml = (entry) => {
    const text = texts();
    // Family and note names are Swedish store data that Weglot does not translate when inserted by script, so the
    // Weglot DA / FI / NO pages (which never show the price list either) get the card without them.
    const swedish = lang() === 'sv';
    const family = swedish ? entry.fam || '' : '';
    const label = family ? fill(text.closeHeading, { family }) : '';
    const tag = family ? fill(text.familyTag, { family }) : '';
    const notes = swedish ? (entry.nt || []).slice(0, 6) : [];
    // "Inspirerad av <name>" + designer bottle, as on the product cards. The feed leaves d / di empty for the L'Oréal
    // houses and for a hidden name (Aventus), so those cards never get the line (Adrian 15.11).
    const inspired = entry.d
      ? `<span class="pm-ours__insp">` +
        (/^https:\/\//.test(String(entry.di || '')) ? `<img src="${escapeHtml(entry.di)}" alt="" width="35" height="35" loading="lazy" decoding="async">` : '') +
        `<span>${escapeHtml(text.inspired)} <b>${escapeHtml(entry.d)}</b></span></span>`
      : '';
    const sizes = (entry.v || [])
      .filter((v) => Array.isArray(v) && v[0] && v[1])
      .sort((a, b) => a[1] - b[1])
      .map(([id, ml, price, perMl, available]) => {
        const disabled = available === false ? ' disabled' : '';
        return (
          `<button type="button" class="pm-ours__size" data-pm-frag-add="${escapeHtml(id)}" data-pm-frag-href="${escapeHtml(productHref(entry.u, id))}"${disabled}>` +
          `<span class="pm-ours__ml">${escapeHtml(ml)} ml</span>` +
          `<span class="pm-ours__price">${escapeHtml(price)}</span>` +
          (perMl ? `<span class="pm-ours__pml">${escapeHtml(perMl)}/ml</span>` : '') +
          `</button>`
        );
      })
      .join('');
    return (
      `<div class="pm-ours" data-pm-hero>` +
      (label ? `<p class="pm-ours__label">${escapeHtml(label)}</p>` : '') +
      `<div class="pm-ours__card">` +
      `<a class="pm-ours__media" href="${escapeHtml(entry.u)}" tabindex="-1" aria-hidden="true">` +
      (entry.img ? `<img src="${escapeHtml(entry.img)}" alt="" width="400" height="400" loading="lazy" decoding="async">` : '') +
      `</a>` +
      `<div class="pm-ours__body">` +
      `<div class="pm-ours__head">` +
      `<a class="pm-ours__title" href="${escapeHtml(entry.u)}">${escapeHtml(entry.t)}</a>` +
      inspired +
      (tag ? `<span class="pm-ours__tag">${escapeHtml(tag)}</span>` : '') +
      `</div>` +
      (notes.length ? `<ul class="pm-ours__notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '') +
      (sizes ? `<div class="pm-ours__sizes">${sizes}</div><p class="pm-ours__hint">${escapeHtml(text.heroHint)}</p>` : '') +
      `<p class="pm-ours__status" data-pm-hero-status aria-live="polite"></p>` +
      `<a class="pm-ours__cta" href="${escapeHtml(entry.u)}">${escapeHtml(text.heroCta)}<span aria-hidden="true"> →</span></a>` +
      `</div></div></div>`
    );
  };

  const renderHero = (el, productId) =>
    renderInto(el, (data) => {
      const entry = productId && data.p ? data.p[String(productId)] : null;
      return entry ? heroHtml(entry) : '';
    });

  // ---------- price list ----------
  let sekFormat = null;
  try {
    sekFormat = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' });
  } catch (e) {}
  const sek = (amount) => (sekFormat ? sekFormat.format(amount) : `${Number(amount).toFixed(2).replace('.', ',')} kr`);
  let dateFormat = null;
  try {
    dateFormat = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {}
  const dateText = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return dateFormat ? dateFormat.format(date) : String(iso).slice(0, 10);
  };
  const perMl = (offer) => (offer.ml > 0 ? offer.p / offer.ml : 0);
  const validOffer = (offer) =>
    offer && Number(offer.p) > 0 && Number(offer.ml) > 0 && /^https:\/\//.test(String(offer.u || '')) && String(offer.r || '').trim();
  const offersOf = (entry) => {
    const list = entry && entry.o && entry.o.x && Array.isArray(entry.o.x.offers) ? entry.o.x.offers : [];
    return list.filter(validOffer).map((offer) => ({ ...offer, p: Number(offer.p), ml: Number(offer.ml) }));
  };
  // "Aventus" + Creed -> "Creed Aventus"; names that already carry their house stay as they are ("Versace Eros").
  const originalName = (original) => {
    const name = String((original && original.n) || '').trim();
    const brand = String((original && original.b) || '').trim();
    if (!brand) return name;
    const folded = ` ${fold(name)} `;
    return brandInfo(brand).phrases.some((phrase) => folded.includes(` ${phrase} `)) ? name : `${brand} ${name}`;
  };
  const priceAllowed = (data) => !!data && data.cur === 'SEK' && lang() === 'sv';

  const offerRowHtml = (offer, max, text) => {
    const pml = perMl(offer);
    const width = max > 0 ? Math.max(4, Math.round((pml / max) * 100)) : 0;
    const date = dateText(offer.at);
    return (
      `<li class="pm-price__row" data-ml="${offer.ml}" data-p="${offer.p}" data-pml="${pml.toFixed(4)}" data-shop="${escapeHtml(fold(offer.r))}">` +
      `<a class="pm-price__link" href="${escapeHtml(offer.u)}" target="_blank" rel="noopener nofollow">` +
      `<span class="pm-price__top"><span class="pm-price__shop">${escapeHtml(offer.r)}<span class="pm-price__ext" aria-hidden="true"> ↗</span></span>` +
      `<span class="pm-price__amount">${escapeHtml(sek(offer.p))}</span></span>` +
      `<span class="pm-price__mid"><span class="pm-price__listing">${escapeHtml(offer.l || '')}</span>` +
      `<span class="pm-price__meta">${offer.ml} ml · ${escapeHtml(sek(pml))}/ml</span></span>` +
      `<span class="pm-price__bar" aria-hidden="true"><span style="width:${width}%"></span></span>` +
      (date ? `<span class="pm-price__read">${escapeHtml(fill(text.priceRead, { date }))}</span>` : '') +
      `</a></li>`
    );
  };

  const groupHeadHtml = (entry, text, searched) => {
    const fu = entry.o && /^https:\/\//.test(String(entry.o.fu || '')) ? entry.o.fu : '';
    return (
      `<div class="pm-price__ghead">` +
      (searched ? `<span class="pm-price__searched">${escapeHtml(text.priceSearched)}</span>` : '') +
      `<p class="pm-price__name">${escapeHtml(originalName(entry.o))}</p>` +
      (fu ? `<a class="pm-price__frag" href="${escapeHtml(fu)}" target="_blank" rel="noopener nofollow">${escapeHtml(text.cta)}<span aria-hidden="true"> ↗</span></a>` : '') +
      `</div>`
    );
  };

  // One original as a compact group: its cheapest offer per ml first, the rest behind "Visa alla butiker (n)".
  const peerGroupHtml = (entry, max, text) => {
    const offers = offersOf(entry).sort((a, b) => perMl(a) - perMl(b) || a.p - b.p);
    const more =
      offers.length > 1
        ? `<button type="button" class="pm-price__more" data-pm-price-more data-n="${offers.length}" aria-expanded="false">${escapeHtml(
            fill(text.priceMore, { n: offers.length })
          )}</button>`
        : '';
    return (
      `<div class="pm-price__group is-peer" data-pm-price-group>${groupHeadHtml(entry, text, false)}` +
      `<ul class="pm-price__rows" data-pm-price-rows>${offers.map((offer) => offerRowHtml(offer, max, text)).join('')}</ul>${more}</div>`
    );
  };

  // The panel around the groups: divider, title, intro, groups, "Så tas priserna fram".
  const priceShellHtml = (text, inner) => {
    const how = (text.how || []).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
    return (
      `<section class="pm-price" data-pm-price aria-label="${escapeHtml(text.priceTitle)}">` +
      `<p class="pm-price__divider"><span>${escapeHtml(text.priceDivider)}</span></p>` +
      `<div class="pm-price__box">` +
      `<p class="pm-price__title"><span class="pm-price__icon" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9z"/><path d="M5 13v7h14v-7"/><path d="M10 20v-4h4v4"/></svg>` +
      `</span>${escapeHtml(text.priceTitle)}</p>` +
      `<p class="pm-price__intro">${escapeHtml(text.priceIntro)}</p>` +
      inner +
      (how ? `<details class="pm-price__how"><summary>${escapeHtml(text.priceHowTitle)}</summary><div class="pm-price__how-body">${how}</div></details>` : '') +
      `</div></section>`
    );
  };

  // House search ("creed", "tom ford"): up to 5 of the house's originals that have shop prices, one per original, in
  // the related order. No "Din sökning" group: nobody searched a single perfume.
  const brandPriceHtml = (data, ids) => {
    const text = texts();
    const seen = new Set();
    const groups = [];
    ids.forEach((id) => {
      if (groups.length >= 5) return;
      const entry = data.p[String(id)];
      if (!entry || !entry.o || !entry.o.n) return;
      const key = fold(originalName(entry.o));
      if (seen.has(key) || !offersOf(entry).length) return;
      seen.add(key);
      groups.push(entry);
    });
    if (!groups.length) return '';
    const max = Math.max(0, ...groups.flatMap(offersOf).map(perMl));
    return priceShellHtml(
      text,
      `<p class="pm-price__subhead">${escapeHtml(text.priceBrand)}</p>` + groups.map((entry) => peerGroupHtml(entry, max, text)).join('')
    );
  };

  const priceHtml = (data, ids, mode) => {
    if (!priceAllowed(data) || !Array.isArray(ids) || !ids.length || !data.p) return '';
    if (mode === 'brand') return brandPriceHtml(data, ids);
    const text = texts();
    const first = data.p[String(ids[0])];
    if (!first || !first.o || !first.o.n) return '';
    const seen = new Set([fold(originalName(first.o))]);
    const others = [];
    ids.slice(1).forEach((id) => {
      if (others.length >= 4) return;
      const entry = data.p[String(id)];
      if (!entry || !entry.o || !entry.o.n) return;
      const key = fold(originalName(entry.o));
      if (seen.has(key) || !offersOf(entry).length) return;
      seen.add(key);
      others.push(entry);
    });
    const firstOffers = offersOf(first).sort((a, b) => a.p - b.p || perMl(a) - perMl(b));
    if (!firstOffers.length && !others.length) return '';
    const max = Math.max(0, ...[first, ...others].flatMap(offersOf).map(perMl));

    let searchedHtml = `<div class="pm-price__group is-searched" data-pm-price-group>${groupHeadHtml(first, text, true)}`;
    if (firstOffers.length) {
      const sizes = [...new Set(firstOffers.map((offer) => offer.ml))].sort((a, b) => a - b);
      const chips =
        sizes.length > 1
          ? `<div class="pm-price__sizes" role="group">` +
            `<button type="button" class="pm-price__chip" data-pm-price-size="all" aria-pressed="true">${escapeHtml(text.priceAllSizes)}</button>` +
            sizes.map((ml) => `<button type="button" class="pm-price__chip" data-pm-price-size="${ml}" aria-pressed="false">${ml} ml</button>`).join('') +
            `</div>`
          : '';
      const sort =
        firstOffers.length > 1
          ? `<label class="pm-price__sort"><span>${escapeHtml(text.priceSortLabel)}</span>` +
            `<select data-pm-price-sort>` +
            `<option value="price">${escapeHtml(text.priceSortPrice)}</option>` +
            `<option value="ml">${escapeHtml(text.priceSortMl)}</option>` +
            `<option value="shop">${escapeHtml(text.priceSortShop)}</option>` +
            `</select></label>`
          : '';
      searchedHtml +=
        (chips || sort ? `<div class="pm-price__tools">${chips}${sort}</div>` : '') +
        `<ul class="pm-price__rows" data-pm-price-rows>${firstOffers.map((offer) => offerRowHtml(offer, max, text)).join('')}</ul>`;
    } else {
      searchedHtml += `<p class="pm-price__none">${escapeHtml(text.priceNone)}</p>`;
    }
    searchedHtml += `</div>`;

    const peersHtml = others.map((entry) => peerGroupHtml(entry, max, text)).join('');
    return priceShellHtml(text, searchedHtml + (peersHtml ? `<p class="pm-price__subhead">${escapeHtml(text.pricePeers)}</p>${peersHtml}` : ''));
  };

  const renderPrices = (el, ids, mode) => renderInto(el, (data) => priceHtml(data, ids, mode));

  // Size chips + sort inside a group (the searched perfume's rows).
  const applyGroup = (group) => {
    const list = group.querySelector('[data-pm-price-rows]');
    if (!list) return;
    const pressed = group.querySelector('[data-pm-price-size][aria-pressed="true"]');
    const size = pressed ? pressed.getAttribute('data-pm-price-size') : 'all';
    const select = group.querySelector('[data-pm-price-sort]');
    const sort = select ? select.value : 'price';
    const num = (row, key) => Number(row.getAttribute(key)) || 0;
    const rows = [...list.children];
    rows.sort((a, b) => {
      if (sort === 'ml') return num(a, 'data-pml') - num(b, 'data-pml') || num(a, 'data-p') - num(b, 'data-p');
      if (sort === 'shop') return (a.getAttribute('data-shop') || '').localeCompare(b.getAttribute('data-shop') || '', 'sv') || num(a, 'data-p') - num(b, 'data-p');
      return num(a, 'data-p') - num(b, 'data-p') || num(a, 'data-pml') - num(b, 'data-pml');
    });
    rows.forEach((row) => {
      row.hidden = size !== 'all' && row.getAttribute('data-ml') !== size;
      list.appendChild(row);
    });
  };

  // ---------- add to cart (theme helper assets/gg-core.js: adds, then opens the cart drawer) ----------
  let ggLoading = null;
  const loadGG = () => {
    if (window.GG && typeof window.GG.addItems === 'function') return Promise.resolve(window.GG);
    if (ggLoading) return ggLoading;
    const node = document.querySelector('[data-pm-gg-core]');
    const src = node ? node.getAttribute('data-pm-gg-core') : '';
    if (!src) return Promise.reject(new Error('no gg-core'));
    ggLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => (window.GG && typeof window.GG.addItems === 'function' ? resolve(window.GG) : reject(new Error('GG missing')));
      script.onerror = () => reject(new Error('gg-core failed'));
      document.head.appendChild(script);
    });
    ggLoading.catch(() => {
      ggLoading = null;
    });
    return ggLoading;
  };

  const addToCart = (button) => {
    if (button.disabled || button.classList.contains('is-busy')) return;
    const id = Number(button.getAttribute('data-pm-frag-add'));
    const href = button.getAttribute('data-pm-frag-href') || '';
    if (!id) return;
    const hero = button.closest('[data-pm-hero]');
    const status = hero ? hero.querySelector('[data-pm-hero-status]') : null;
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    loadGG()
      .then((GG) => GG.addItems([{ id, quantity: 1 }]))
      .then(() => {
        button.classList.remove('is-busy');
        button.removeAttribute('aria-busy');
        button.classList.add('is-added');
        if (status) status.textContent = texts().heroAdded;
        document.dispatchEvent(new CustomEvent('pm:frag:added', { detail: { id } }));
        setTimeout(() => button.classList.remove('is-added'), 2500);
      })
      .catch(() => {
        button.classList.remove('is-busy');
        button.removeAttribute('aria-busy');
        // Sold out, an app in the way, or no helper: the product page with this size chosen.
        if (href) window.location.href = href;
      });
  };

  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('[data-pm-frag-add],[data-pm-price-size],[data-pm-price-more]') : null;
    if (!target) return;
    if (target.hasAttribute('data-pm-frag-add')) {
      event.preventDefault();
      event.stopPropagation();
      addToCart(target);
      return;
    }
    const group = target.closest('[data-pm-price-group]');
    if (!group) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.hasAttribute('data-pm-price-size')) {
      group.querySelectorAll('[data-pm-price-size]').forEach((chip) => chip.setAttribute('aria-pressed', chip === target ? 'true' : 'false'));
      applyGroup(group);
      return;
    }
    const open = !group.classList.contains('is-open');
    group.classList.toggle('is-open', open);
    target.setAttribute('aria-expanded', open ? 'true' : 'false');
    target.textContent = open ? texts().priceLess : fill(texts().priceMore, { n: target.getAttribute('data-n') || '' });
  });
  document.addEventListener('change', (event) => {
    const select = event.target && event.target.closest ? event.target.closest('[data-pm-price-sort]') : null;
    if (!select) return;
    const group = select.closest('[data-pm-price-group]');
    if (group) applyGroup(group);
  });

  let weglotHooked = false;
  const hookWeglot = () => {
    if (weglotHooked || !window.Weglot || typeof window.Weglot.on !== 'function') return;
    weglotHooked = true;
    try {
      window.Weglot.on('initialized', () => {
        textCache = null;
      });
      window.Weglot.on('languageChanged', () => {
        textCache = null;
      });
    } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookWeglot);
  else hookWeglot();
  window.addEventListener('load', hookWeglot);

  const noHtml = () => '';
  window.pmFrag = {
    fold,
    lang,
    texts,
    familyKey,
    detect,
    headingHtml,
    loadFeed,
    renderHero,
    renderPrices,
    clear,
    priceAllowed,
    originalName,
    badgeHtml: noHtml,
    cardsHtml: noHtml,
    idFromUrl: noHtml,
    localize: () => {},
  };
  document.dispatchEvent(new CustomEvent('pm:frag:ready'));
})();
