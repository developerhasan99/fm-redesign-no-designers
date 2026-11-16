/**
 * Shared search matcher (window.pmSearchCore), used by the search overlay (assets/pm-search.js) and the
 * search results page (assets/pm-search-results.js), so both find the same scents for the same words.
 * Ported from magicperfume.co (mgx-search-core.js) with Swedish words.
 *
 * Covers: accent folding (å ä ö, é), brand synonyms (ysl, mfk), scent family words (träig = woody =
 * vedartad), tag values (säsong:Höst -> "höst"), scent numbers with and without leading zeros,
 * word-start matching for short terms and a fallback for words typed together ("tomford").
 * Family words come from custom.fragrance_family only (the 9 essnce.se groups, scripts/set_fragrance_family.py):
 * the old scent:* tags give a scent two or three families and are left out.
 *
 * API:
 *   fold(str)                      folded text ("Träig Höst" -> "traeig hoest")
 *   parseQuery(raw)                { terms, compact }
 *   buildHay(title, extra, tags, family)   { hay, compact }; tags: array or "a|b" string
 *   matches(entry, query)          entry from buildHay
 *   score(item, query)             item from snippets/pm-search-index.liquid, 0 = no match
 * query may be a parseQuery() result or the raw text. Safe to load twice: the second run does nothing.
 */
(() => {
  if (window.pmSearchCore) return;

  // "prefix:value" tags contribute their value (säsong:Höst -> "Höst"), except these prefixes.
  const SKIP_PREFIXES = ['gender', 'scent'];
  // Plain tags that say nothing a shopper would type, folded. Internal tags are already left out of the
  // index (snippets/pm-search-index.liquid); these are the ones that would only add noise.
  const SKIP_TAGS = new Set(['en', 'new', 'onsale', 'bestseller', 'shoptok', 'bundle banner', 'red noise']);
  // Names shoppers use for the same house or gender. When one phrase is in a product's text, the others
  // are added too. Folded (ä -> ae, ö -> oe), whole phrases; the plain spelling (ä -> a) is listed as well
  // where it differs, because a query is folded both ways.
  const SYNONYMS = [
    ['jean paul gaultier', 'jpgaultier', 'jp gaultier', 'jpg', 'gaultier'],
    ['yves saint laurent', 'ysl', 'saint laurent'],
    ['maison francis kurkdjian', 'maison francis', 'mfk', 'kurkdjian'],
    ['dolce gabbana', 'dolce and gabbana', 'dg', 'd g'],
    ['louis vuitton', 'lv'],
    ['thierry mugler', 'mugler'],
    ['paco rabanne', 'rabanne'],
    ['giorgio armani', 'emporio armani', 'armani'],
    ['hugo boss', 'boss'],
    ['christian dior', 'dior'],
    ['carolina herrera', 'herrera'],
    ['tom ford', 'tomford'],
    ['escentric molecules', 'molecules'],
    ['by kilian', 'kilian'],
    ['tiziana terenzi', 'terenzi'],
    ['le labo', 'lelabo'],
    ['laeder', 'lader', 'leather'],
    ['man', 'herr', 'herrdoft', 'herrparfym', 'herrar', 'honom'],
    ['woman', 'dam', 'damdoft', 'damparfym', 'damer', 'henne'],
  ];
  // The 9 scent families, same folding. Added only when the scent's family field holds the first word,
  // so "blommig" finds the floral scents and nothing that merely mentions a flower.
  const FAMILY_SYNONYMS = [
    ['gourmand', 'gourmanddoft'],
    ['vanilj', 'vanilla', 'vanille', 'vaniljdoft'],
    ['blommig', 'blommiga', 'floral', 'blomdoft'],
    ['fruktig', 'fruktiga', 'fruity'],
    ['fraesch', 'frasch', 'fraescha', 'frascha', 'fresh', 'frisk', 'faersk', 'farsk'],
    ['traeig', 'traig', 'traeiga', 'traiga', 'vedartad', 'vedartade', 'woody'],
    ['soet', 'sot', 'soeta', 'sota', 'sweet'],
    ['kryddig', 'kryddiga', 'kryddad', 'spicy'],
    ['orientalisk', 'orientaliska', 'oriental'],
  ];

  // To a German keyboard "ä" and "ae" are the same letter, and Swedes on a foreign keyboard type "a" for
  // "ä", so text is folded both ways: "ae / oe" (fold) and plain (foldPlain). buildHay adds the plain
  // words to the haystack too, so "hoest", "host" and "höst" all find "Höst".
  const UMLAUTS = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };
  const foldText = (value, umlauts) => {
    let text = String(value == null ? '' : value).toLowerCase();
    if (umlauts) {
      // A decomposed "a" + U+0308 (pasted text, macOS input) becomes "ä" first.
      try {
        text = text.normalize('NFC');
      } catch (e) {}
      text = text.replace(/[äöüß]/g, (letter) => UMLAUTS[letter]);
    }
    try {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (e) {}
    return text
      .replace(/ß/g, 'ss')
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe')
      .replace(/ø/g, 'o')
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  };
  const fold = (value) => foldText(value, true);
  const foldPlain = (value) => foldText(value, false);

  const tagWords = (raw) =>
    String(raw || '')
      .split('|')
      .map((tag) => {
        const colon = tag.indexOf(':');
        if (colon > -1) {
          const prefix = fold(tag.slice(0, colon));
          if (SKIP_PREFIXES.includes(prefix)) return '';
          return tag.slice(colon + 1);
        }
        return SKIP_TAGS.has(fold(tag)) ? '' : tag;
      })
      .join(' ');

  // Every number in the title, without and with leading zeros: "004" -> 4, 004; "270M" -> 270.
  const numberWords = (folded) => {
    const words = [];
    (folded.match(/\d+/g) || []).forEach((digits) => {
      const bare = digits.replace(/^0+(?=\d)/, '');
      words.push(bare, bare.padStart(3, '0'));
    });
    return words;
  };

  // title: the product title; extra: more searchable text (inspiration, brand); tags: an array or a
  // "tag|tag" string; family: the custom.fragrance_family value.
  const buildHay = (title, extra, tags, family) => {
    const titleText = title == null ? '' : String(title);
    const tagText = Array.isArray(tags) ? tags.join('|') : tags;
    const text = [titleText, extra == null ? '' : String(extra), tagWords(tagText)].join(' ');
    let hay = ` ${fold(text)} ${numberWords(fold(titleText)).join(' ')} `;
    // The same words in their plain spelling ("host" next to "hoest"), only where they differ.
    foldPlain(text)
      .split(' ')
      .forEach((word) => {
        if (word && !hay.includes(` ${word} `)) hay += `${word} `;
      });
    SYNONYMS.forEach((group) => {
      if (group.some((phrase) => hay.includes(` ${phrase} `))) hay += `${group.join(' ')} `;
    });
    const familyText = ` ${fold(family)} ${foldPlain(family)} `;
    FAMILY_SYNONYMS.forEach((group) => {
      if (group.some((phrase) => familyText.includes(` ${phrase} `))) hay += `${group.join(' ')} `;
    });
    return { hay, compact: hay.replace(/ /g, '') };
  };

  const parseQuery = (raw) => {
    const folded = fold(raw);
    const terms = folded ? folded.split(' ').map((term) => (/^\d+$/.test(term) ? term.replace(/^0+(?=\d)/, '') : term)) : [];
    return { terms, compact: folded.replace(/ /g, '') };
  };
  const toQuery = (query) => (query && Array.isArray(query.terms) ? query : parseQuery(query));

  // Numbers match a whole word ("24" is not "248"); words up to 3 letters match the start of a word, so
  // "di" already finds "dior" while typing and "dam" skips "adam"; longer terms match anywhere.
  const termHit = (hay, term) => {
    if (/^\d+$/.test(term)) return hay.includes(` ${term} `);
    if (term.length <= 3) return hay.includes(` ${term}`);
    return hay.includes(term);
  };

  const matches = (entry, rawQuery) => {
    const query = toQuery(rawQuery);
    const { hay, compact } = entry;
    // Fallback for words typed together ("tomford", "no248"); from 4 characters, so "man" stays a word
    // start.
    return query.terms.every((term) => termHit(hay, term)) || (query.compact.length >= 4 && compact.includes(query.compact));
  };

  // Ranking: exact scent number, then every term at a word start of the inspiration or title, then of the
  // brand, then any other match (family, season, occasion, tags). Bestsellers up, sold-out scents down.
  // A match never scores below 1, so 0 always means "no match"; sort by score, then by inspiration name.
  const wordStarts = (text, terms) => {
    const padded = ` ${fold(text)}`;
    return terms.every((term) => padded.includes(` ${term}`));
  };
  const score = (item, rawQuery) => {
    if (!item) return 0;
    const query = toQuery(rawQuery);
    const { terms } = query;
    if (!terms.length) return 0;
    let points = 0;
    const number = String(item.number == null ? '' : item.number).replace(/^0+(?=\d)/, '');
    if (terms.length === 1 && /^\d+$/.test(terms[0]) && number && terms[0] === number) {
      points = 1000;
    } else {
      // k / kb: inspiration and brand of a scent whose designer is not named in search (match only, never shown).
      if (!item._hay) {
        item._hay = buildHay(item.title, [item.inspiration, item.brand, item.k, item.kb].filter(Boolean).join(' '), item.tags, item.family);
      }
      if (!matches(item._hay, query)) return 0;
      const brand = item.brand || item.kb;
      if (wordStarts(`${item.inspiration || item.k || ''} ${item.title || ''}`, terms)) points = 500;
      else if (brand && wordStarts(brand, terms)) points = 300;
      else points = 100;
    }
    if (item.bestseller) points += 20;
    if (item.available === false) points -= 50;
    return Math.max(points, 1);
  };

  // True when the query reached this scent through its hidden designer words (k / kb) rather than its own title:
  // the overlay then says "these are the most accurate for your search" instead of naming anything.
  const designerHit = (item, rawQuery) => {
    if (!item || !item.m) return false;
    const { terms } = toQuery(rawQuery);
    if (!terms.length) return false;
    const designer = ` ${fold(`${item.k || ''} ${item.kb || ''}`)}`;
    const title = ` ${fold(item.title || '')}`;
    return terms.some((term) => term.length >= 2 && designer.includes(` ${term}`) && !title.includes(` ${term}`));
  };

  window.pmSearchCore = { fold, parseQuery, buildHay, matches, score, designerHit };
  document.dispatchEvent(new CustomEvent('pm:search-core:ready'));
})();
