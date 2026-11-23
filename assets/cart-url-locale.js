// Cart URL locale fix for every market (was inside subscribfy-custom.js, which is not loaded for DK).
// Tryscent-specific fix: the app hardcodes /cart/*.js without the locale root; Shopify 301s those and the browser drops the POST body.
function exm_localise_cart_url(url) {
  const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

  if (root === '/') {
    return url;
  }

  const value = String(url == null ? '' : url);

  if (value.indexOf('/cart/') !== 0) {
    return url;
  }

  const prefix = root.replace(/\/$/, '');

  if (value.indexOf(prefix + '/') === 0) {
    return url;
  }

  return prefix + value;
}

const exm_locale_fetch = window.fetch;

if (typeof exm_locale_fetch === 'function') {
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      const fixed = exm_localise_cart_url(input);

      if (fixed !== input) {
        if (window.exmDev) {
          console.log('Subscribfy theme - localised cart URL:', input, '->', fixed);
        }

        return exm_locale_fetch.call(this, fixed, init);
      }
    }

    return exm_locale_fetch.apply(this, arguments);
  };
}

const exm_locale_xhr_open = XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.open = function(method, url) {
  const fixed = exm_localise_cart_url(url);

  if (fixed !== url) {
    if (window.exmDev) {
      console.log('Subscribfy theme - localised cart URL (xhr):', url, '->', fixed);
    }

    const args = Array.prototype.slice.call(arguments);
    args[1] = fixed;

    return exm_locale_xhr_open.apply(this, args);
  }

  return exm_locale_xhr_open.apply(this, arguments);
};


