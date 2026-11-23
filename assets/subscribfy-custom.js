// Subscribfy theme customisations. Moved out of snippets/subscribfy-custom.liquid so browsers cache it;
// the Liquid values it needs are set inline right before it in that snippet.
// Subscribfy

window.exmDev = 1;
window.SUBSCRIBFY_GUESTCHECKOUT = 1;
window.SUBSCRIBFY_cartsummary_discount_label = "Savings";

if (!window.SUBSCRIBFY_BADGE_LOGGED) {
  window.SUBSCRIBFY_BADGE_LOGGED = 1;
  console.log(
    '%c SUBSCRIBFY %c Membership program powered by Subscribfy %c https://subscribfy.ai ',
    'background:rgb(0, 255, 123);color:#000000;padding:4px 8px;border-radius:4px 0 0 4px;font-weight:700;letter-spacing:1px;font-size:11px',
    'background:#111827;color:#ffffff;padding:4px 8px;font-size:11px',
    'background:transparent;padding:4px 6px;font-size:11px'
  );
}

function exm_cart_drawer_el() {
  return document.querySelector('cart-drawer');
}

function exm_cart_is_open() {
  const drawer = exm_cart_drawer_el();

  return !!drawer && drawer.classList.contains('active');
}

function exm_cart_open() {
  const drawer = exm_cart_drawer_el();

  if (!drawer || typeof drawer.open !== 'function') {
    window.location.href = routes.cart_url;

    return;
  }

  drawer.open();
}

function exm_cart_rebuild(shouldOpen) {
  const drawer = exm_cart_drawer_el();

  if (!drawer || typeof drawer.getSectionsToRender !== 'function') {
    return Promise.resolve();
  }

  const sectionsToRender = [
    { id: 'cart-drawer', selector: '.drawer__inner' },
    { id: 'cart-icon-bubble' },
  ];
  const ids = sectionsToRender.map(function(section){ return section.id; }).join(',');

  return fetch(routes.cart_url + '?sections=' + ids)
    .then(function(response){ return response.json(); })
    .then(function(sections){
      sectionsToRender.forEach(function(section){
        const target = section.selector
          ? document.querySelector(section.selector)
          : document.getElementById(section.id);

        if (!target || !sections[section.id]) {
          return;
        }

        const source = new DOMParser()
          .parseFromString(sections[section.id], 'text/html')
          .querySelector(section.selector || '.shopify-section');

        if (!source) {
          return;
        }

        target.innerHTML = source.innerHTML;
      });

      const inner = drawer.querySelector('.drawer__inner');

      if (inner) {
        drawer.classList.toggle('is-empty', !!inner.querySelector('.drawer__inner-empty'));
      }

      if (shouldOpen) {
        exm_cart_open();
      }
    })
    .catch(function(error){
      console.error('Subscribfy: cart rebuild failed', error);
    });
}

if (EXM_PAYG_IN_CART) {
  exm_setCookie('exmcart','PAYG',1);
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.exison-widget__Containe_Wrapper').forEach(function(el){
      el.classList.add("hide_sp");
    });
    const setNoExisonBtn = document.getElementById("setNoExison");
    if (setNoExisonBtn) {
      setNoExisonBtn.click();
    }
  });
}

document.querySelectorAll('.shopify-block .exison-widget_st__Container').forEach(function(element) {
  element.remove();
});

document.addEventListener('DOMContentLoaded', function() {
  function exm_remove_unmanaged(selector) {
    document.querySelectorAll(selector).forEach(function(el){
      if (el.closest('[data-exm-managed]')) {
        return;
      }

      el.remove();
    });
  }

  //remove store credit container
  exm_remove_unmanaged('.shopify-block .exison-widget_st__Container');

  //remove default widget from app embed
  exm_remove_unmanaged('.shopify-block .exison-widget');
  exm_remove_unmanaged('.shopify-block .exison-widget__Container');
  exm_remove_unmanaged('.shopify-block .exison-widget__Containe_Wrapper');

  //remove default widget from app embed
  exm_remove_unmanaged('.shopify-block #data-exison-type1-cart');
  exm_remove_unmanaged('.shopify-block #data-exison-type2-cart');

  // =========================== Script for cart page ========================
  if (window.location.href.indexOf("/cart") > -1) {
    const setExisonEl = document.getElementById('setExison');
    if (exm_getCookie('exmcart') != 'PAYG' && setExisonEl && !setExisonEl.classList.contains('exm_active') && window.exmData.widget_cart_page.cart_default_PAYG != true) {
      setTimeout(function(){
        const dataEl = document.getElementById('data-exison-type1-cart');
        if (dataEl) {
          dataEl.setAttribute('forceVip', 'forceVip');
        }
        setExisonEl.click();
      }, 500);
    }

    document.body.addEventListener('click', function(e){
      if (e.target.closest('#cart-icon-bubble')) {
        e.preventDefault();
        // e.stopPropagation();
        // location.reload();
      }
    });

  }

  document.addEventListener('subscribfy:VIPAddedToCart', function(evt) {
    exm_payg_selected = false;
    switch_to_VIP();
    setTimeout(function(){
      exm_cart_rebuild();
    }, 250);
  });

  document.addEventListener('subscribfy:VIPRemovedFromCart', function(evt) {
    switch_to_nonVIP();
    setTimeout(function(){
      exm_cart_rebuild();

      if (EXM_IS_CART_PAGE) {
        location.reload();
      }
    }, 250);
  });
});

function switch_to_VIP() {
  const colMembers = document.querySelectorAll(".col-member");
  const colNoMembers = document.querySelectorAll(".col-non_member");
  const sub_text = document.getElementById("sub-widget-text");

  if (!sub_text) {
    return;
  }

  sub_text.classList.remove("not_displayed");
  colMembers.forEach(function(element){ element.classList.add("exm_active"); });
  colNoMembers.forEach(function(element){ element.classList.remove("exm_active"); });
  colMembers.forEach(function(element){
    element.classList.add("selected");
  });

  colNoMembers.forEach(function(element){
    element.classList.remove("selected_NM");
  });
}

function switch_to_nonVIP() {
  const colMembers = document.querySelectorAll(".col-member");
  const colNoMembers = document.querySelectorAll(".col-non_member");
  const sub_text = document.getElementById("sub-widget-text");

  if (!sub_text) {
    return;
  }

  sub_text.classList.add("not_displayed");
  colMembers.forEach(function(element){ element.classList.remove("exm_active"); });
  colNoMembers.forEach(function(element){ element.classList.add("exm_active"); });
  colMembers.forEach(function(element){
    element.classList.remove("selected");
  });

  colNoMembers.forEach(function(element){
    element.classList.add("selected_NM");
  });
}

let exm_payg_selected = false;

document.addEventListener('click', function(e){
  if (!e.target.closest('#setExison')) {
    return;
  }

  exm_payg_selected = false;
  switch_to_VIP();
  const nonMembers = document.querySelectorAll('.exison-widget__Containe_Wrapper .col-non_member');
  nonMembers.forEach(function(el){ el.classList.add('exmnoclick'); });
  setTimeout(function(){
    nonMembers.forEach(function(el){ el.classList.remove('exmnoclick'); });
  }, 2000);
});

document.addEventListener('click', function(e){
  if (!e.target.closest('#setNoExison')) {
    return;
  }

  exm_payg_selected = true;
  switch_to_nonVIP();
  const members = document.querySelectorAll('.exison-widget__Containe_Wrapper .col-member');
  members.forEach(function(el){ el.classList.add('exmnoclick'); });
  setTimeout(function(){
    members.forEach(function(el){ el.classList.remove('exmnoclick'); });
  }, 2000);
});

document.addEventListener('click', function(e){
  const colMember = e.target.closest('.exison-widget__Containe_Wrapper .col-member');
  if (!colMember) {
    return;
  }

  if (colMember.classList.contains('exm_active')) {
    return;
  }

  const setExisonBtn = document.getElementById('setExison');
  if (setExisonBtn) {
    setExisonBtn.click();
  }
});

document.addEventListener('click', function(e){
  const colNonMember = e.target.closest('.exison-widget__Containe_Wrapper .col-non_member');
  if (!colNonMember) {
    return;
  }

  if (colNonMember.classList.contains('exm_active')) {
    return;
  }

  const setNoExisonBtn = document.getElementById('setNoExison');
  if (setNoExisonBtn) {
    setNoExisonBtn.click();
  }
});

// =========================== Script for product page ========================

var EXM_VIP_INFO_HTML = '<svg class="exm-info-button" width="15" height="15" viewBox="0 -1 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" role="button" aria-label="' + EXM_VIP_INFO_LABEL + '">'
  + '<path d="M5.2002 0.0200195C2.44438 0.0200195 0.200195 2.26421 0.200195 5.02002C0.200195 7.77583 2.44438 10.02 5.2002 10.02C7.95601 10.02 10.2002 7.77583 10.2002 5.02002C10.2002 2.26421 7.95601 0.0200195 5.2002 0.0200195ZM5.2002 9.32235C2.8281 9.32235 0.89787 7.39211 0.89787 5.02002C0.89787 2.64793 2.8281 0.717694 5.2002 0.717694C7.57229 0.717694 9.50252 2.64793 9.50252 5.02002C9.50252 7.39211 7.57229 9.32235 5.2002 9.32235Z" fill="currentColor"/>'
  + '<path d="M5.20047 3.97096C5.00279 3.97096 4.85163 4.12213 4.85163 4.3198V6.99422C4.85163 7.19189 5.00279 7.34306 5.20047 7.34306C5.39814 7.34306 5.54931 7.19189 5.54931 6.99422V4.3198C5.54931 4.12213 5.39814 3.97096 5.20047 3.97096ZM5.20047 2.69189C4.94465 2.69189 4.73535 2.9012 4.73535 3.15701C4.73535 3.41282 4.94465 3.62213 5.20047 3.62213C5.45628 3.62213 5.66558 3.41282 5.66558 3.15701C5.66558 2.9012 5.45628 2.69189 5.20047 2.69189Z" fill="currentColor"/>'
  + '</svg>';

function exm_inject_vip_info_icon() {
  document.querySelectorAll('.exm-pp-purchase-vip-item, .exm-pp-active-member-item').forEach(function(item){
    if (item.querySelector('.exm-info-button')) {
      return;
    }

    const title = item.querySelector('.atc_btn_main_label')
      || item.querySelector('.exm-pp-offer-topline')
      || item.querySelector('.exm-pp--label');

    if (!title) {
      return;
    }

    title.insertAdjacentHTML('beforeend', EXM_VIP_INFO_HTML);
  });
}

document.addEventListener('DOMContentLoaded', exm_inject_vip_info_icon);
document.addEventListener('subscribfy:VariantChanged', exm_inject_vip_info_icon);
exm_inject_vip_info_icon();

var EXM_PP_TITLE_PREFIX = 'Upp till 30 %';

function exm_update_pp_title() {
  document.querySelectorAll('.exm-pp-purchase-vip-item, .exm-pp-active-member-item').forEach(function(item){
    const title = item.querySelector('.atc_btn_main_label');

    if (!title) {
      return;
    }

    title.childNodes.forEach(function(node){
      if (node.nodeType !== 3) {
        return;
      }

      const next = node.nodeValue.replace(/^(\s*)\d+\s*%/, '$1' + EXM_PP_TITLE_PREFIX);

      if (next !== node.nodeValue) {
        node.nodeValue = next;
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', exm_update_pp_title);
document.addEventListener('subscribfy:VariantChanged', exm_update_pp_title);
exm_update_pp_title();

document.addEventListener('click', function(e){
  if (!e.target.closest('.exm-info-button')) {
    return;
  }

  const dialog = document.querySelector('.exm_dialog-collection');
  if (!dialog) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  document.querySelectorAll('.transition-body').forEach(function(el){ el.classList.remove('transition-body'); });

  dialog.style.display = 'block';
  setTimeout(function(){
    dialog.classList.add('exm_clr-is-open');
  }, 10);
}, true);

document.addEventListener('click', function(e){
  if (!e.target.closest('.exm_badge, .exm-open-popup, .bundle-addon-thumbnail, .bundle-addon-heading')) {
    return;
  }

  if (e.target.closest('[data-exm-no-popup]')) {
    return;
  }

  document.querySelectorAll('.transition-body').forEach(function(el){ el.classList.remove('transition-body'); });
  document.querySelectorAll('.exm_dialog-collection').forEach(function(el){ el.style.display = ''; });
  setTimeout(function(){
    document.querySelectorAll('.exm_dialog-collection').forEach(function(el){ el.classList.add('exm_clr-is-open'); });
  }, 10);
});
document.addEventListener('click', function(e){
  const dialogInner = e.target.closest('.exm_dialog-inner');
  if (!dialogInner) {
    return;
  }

  if (e.target !== dialogInner) {
    //return;
  } else {
    setTimeout(function(){
      document.querySelectorAll('.exm_dialog-collection').forEach(function(el){
        el.style.display = 'none';
        el.classList.remove('exm_clr-is-open');
      });
    }, 100);
  }
});
document.addEventListener('click', function(e){
  if (!e.target.closest('.exm_continue_shopping')) {
    return;
  }

  setTimeout(function(){
    document.querySelectorAll('.exm_dialog-collection').forEach(function(el){
      el.style.display = 'none';
      el.classList.remove('exm_clr-is-open');
    });
  }, 100);
});
document.addEventListener('click', function(e){
  if (!e.target.closest('.exm_dialog-close')) {
    return;
  }

  setTimeout(function(){
    document.querySelectorAll('.exm_dialog-collection').forEach(function(el){
      el.style.display = 'none';
      el.classList.remove('exm_clr-is-open');
    });
  }, 100);
});

// Hide subscribfy widget and prices some on countries
function checkCountryRestrictions() {
  if (!window.exmData || !window.exmData.plan_settings) {
    return;
  }
  const allowedCountries = window.exmData.plan_settings.allowed_countries;
  if (!allowedCountries || allowedCountries.trim() === '') {
    return;
  }
  const allowedCountriesArray = allowedCountries.split(",").map(c => c.trim());
  if (!allowedCountriesArray.includes(Shopify.country)) {
    exm_setCookie('exmcart','PAYG',1);
    document.querySelectorAll('.exm_price_all.exison_new_price').forEach(function(element) {
      element.classList.add("hide_sp2");
    });
    document.querySelectorAll('.exison-widget__Containe_Wrapper').forEach(function(element) {
      element.classList.add("hide_sp2");
    });
    const noExisonBtn = document.getElementById("setNoExison");
    if (noExisonBtn) {
      noExisonBtn.click();
    }
  }
}
document.addEventListener('DOMContentLoaded', checkCountryRestrictions);

function exm_highlight_membership_discount() {
  document.querySelectorAll('.discounts__discount').forEach(function(el){
    el.classList.toggle('exm-membership-discount', el.textContent.includes('Tryscent+'));
  });
}

const EXM_DISCOUNT_TIERS = [
  { min: 6, value: 30 },
  { min: 3, value: 25 },
  { min: 1, value: 10 },
];

function exm_cart_product_count() {
  const scope = EXM_IS_CART_PAGE
    ? document.getElementById('main-cart-items')
    : document.getElementById('CartDrawer');

  if (!scope) {
    return 0;
  }

  let count = 0;

  scope.querySelectorAll('.quantity__input[data-quantity-variant-id]').forEach(function(input){
    if (String(input.getAttribute('data-quantity-variant-id')) === String(EXM_VIP_VARIANT_ID)) {
      return;
    }

    const qty = parseInt(input.value, 10);

    if (!isNaN(qty) && qty > 0) {
      count += qty;
    }
  });

  return count;
}

function exm_update_tier_discount() {
  const count = exm_cart_product_count();
  let value = EXM_DISCOUNT_TIERS[EXM_DISCOUNT_TIERS.length - 1].value;

  for (let i = 0; i < EXM_DISCOUNT_TIERS.length; i++) {
    if (count >= EXM_DISCOUNT_TIERS[i].min) {
      value = EXM_DISCOUNT_TIERS[i].value;
      break;
    }
  }

  const text = value + '%';

  document.querySelectorAll('.col-member .rectangle-white.one--').forEach(function(el){
    if (el.textContent.trim() !== text) {
      el.textContent = text;
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  exm_highlight_membership_discount();
  exm_update_tier_discount();

  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
    subscribe(PUB_SUB_EVENTS.cartUpdate, exm_highlight_membership_discount);
    subscribe(PUB_SUB_EVENTS.cartUpdate, exm_update_tier_discount);
  }
});

if (EXM_IS_CART_PAGE) {
  const cartPageForm = document.getElementById('main-cart-items');
  if (cartPageForm) {
    const cartPageObserver = new MutationObserver(function(){
      exm_highlight_membership_discount();
      exm_update_tier_discount();
    });
    cartPageObserver.observe(cartPageForm, {
      childList: true,
      subtree: true
    });
  }
}

// Observe cart drawer for DOM changes
const cartDrawer = document.getElementById("CartDrawer");
if (cartDrawer) {
  const observer = new MutationObserver(() => {
    checkCountryRestrictions();
    exm_highlight_membership_discount();
    exm_update_tier_discount();
  });
  observer.observe(cartDrawer, {
    childList: true,
    subtree: true
  });
}

function exm_remove_foreign_widgets() {
  document.querySelectorAll('.exison-widget__Containe_Wrapper').forEach(function(w){
    if (w.closest('[data-exm-managed]')) {
      return;
    }

    w.remove();
  });
}


let exm_drawer_autoselect_checked = false;

function exm_drawer_autoselect() {
  if (exm_drawer_autoselect_checked) return;

  const colMember = document.querySelector('[data-exm-managed] .col-member');
  if (!colMember) return;

  exm_drawer_autoselect_checked = true;

  if (exm_getCookie('exmcart') === 'PAYG') return;

  if (!window.exmData || !window.exmData.widget_cart_page) return;
  if (window.exmData.widget_cart_page.cart_default_PAYG === true) return;

  const setExisonEl = document.getElementById('setExison');
  if (!setExisonEl) return;
  if (setExisonEl.classList.contains('exm_active')) return;

  exm_drawer_autoselect_click(0);
}

function exm_drawer_autoselect_click(attempt) {
  setTimeout(function() {
    const colMember = document.querySelector('[data-exm-managed] .col-member');

    if (exm_getCookie('exmcart') === 'PAYG') {
      return;
    }

    if (!colMember) {
      if (attempt >= 10) {
        return;
      }

      exm_drawer_autoselect_click(attempt + 1);

      return;
    }

    if (colMember.classList.contains('exm_active')) {
      return;
    }

    colMember.click();
  }, attempt === 0 ? 500 : 300);
}

document.addEventListener('DOMContentLoaded', function() {
  exm_remove_foreign_widgets();
  exm_inject_vip_info_icon();
});

const exmCartDrawerEl = exm_cart_drawer_el();

if (exmCartDrawerEl) {
  const exmDrawerOpenObserver = new MutationObserver(function() {
    if (!exmCartDrawerEl.classList.contains('active')) {
      return;
    }

    exm_drawer_autoselect();

    if (exm_drawer_autoselect_checked) {
      exmDrawerOpenObserver.disconnect();
    }
  });

  exmDrawerOpenObserver.observe(exmCartDrawerEl, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

if (window.location.href.includes('apps/subscribfy-api')) {
  let exm_portal_show_timer = null;

  const exm_is_cart_add_url = function(url) {
    return String(url || '').indexOf('/cart/add') > -1;
  };

  const exm_portal_show_cart = function() {
    clearTimeout(exm_portal_show_timer);

    exm_portal_show_timer = setTimeout(function(){
      if (!exm_cart_drawer_el()) {
        window.location.href = EXM_CART_URL;

        return;
      }

      exm_cart_rebuild(true);
    }, 300);
  };

  document.addEventListener('subscribfy:updatedExmCartItems', function(){
    if (exm_cart_is_open()) {
      exm_cart_rebuild();
    }
  });

  const exm_native_fetch = window.fetch;
  if (typeof exm_native_fetch === 'function') {
    window.fetch = function(input) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';

      return exm_native_fetch.apply(this, arguments).then(function(response){
        if (exm_is_cart_add_url(url) && response.ok) {
          exm_portal_show_cart();
        }

        return response;
      });
    };
  }

  const exm_native_xhr_open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.addEventListener('load', function(){
      if (this.status < 200 || this.status >= 300) {
        return;
      }

      if (exm_is_cart_add_url(url)) {
        exm_portal_show_cart();
      }
    });

    return exm_native_xhr_open.apply(this, arguments);
  };
}

(function () {
  const HF_WIDGET_MOUNT_DELAY = 1000;

  function hf_open_cart() {
    exm_cart_open();
  }

  function hf_click_widget_member() {
    setTimeout(function () {
      const colMember = document.querySelector('.exison-widget__Containe_Wrapper .col-member');

      if (colMember && !colMember.classList.contains('exm_active')) {
        colMember.click();
      }
    }, HF_WIDGET_MOUNT_DELAY);
  }

  async function hf_handle_trigger() {
    const variantId = Number(EXM_VIP_VARIANT_ID || 0);
    const sellingPlanId = Number(EXM_VIP_PLAN_ID || 0);
    let cart;

    try {
      cart = await fetch('/cart.js').then(function (r) { return r.json(); });
    } catch (err) {
      console.warn('Membership trigger: could not fetch cart', err);
      hf_open_cart();

      return;
    }

    const inCart = variantId && cart && cart.items && cart.items.some(function (item) {
      return Number(item.variant_id) === variantId;
    });

    if (inCart) {
      hf_open_cart();

      return;
    }

    const cartIsEmpty = !cart || cart.item_count === 0;

    if (cartIsEmpty && variantId && sellingPlanId) {
      try {
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{
              id: variantId,
              quantity: 1,
              selling_plan: sellingPlanId
            }]
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(function () { return {}; });

          throw new Error(errorData.description || 'Cart add failed');
        }

        hf_open_cart();
        exm_cart_rebuild();

        setTimeout(function () {
          if (typeof switch_to_VIP === 'function') {
            switch_to_VIP();
          }
        }, HF_WIDGET_MOUNT_DELAY);
      } catch (err) {
        console.error('Membership trigger: could not add membership', err);
        hf_open_cart();
      }

      return;
    }

    hf_open_cart();
    hf_click_widget_member();
  }

  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('[data-membership-trigger]');

    if (!trigger) {
      return;
    }

    e.preventDefault();
    hf_handle_trigger();
  });
})();

const EXM_CTA_ERROR_TEXT = 'Något gick fel. Försök igen.';

function exm_cta_checkout_url() {
  const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

  return root.replace(/\/$/, '') + '/checkout';
}

function exm_cta_target(block) {
  const drawer = block.closest('cart-drawer');

  if (drawer) {
    return drawer.querySelector('.cart__ctas');
  }

  const candidates = document.querySelectorAll('.cart__ctas');

  for (let i = 0; i < candidates.length; i++) {
    if (!candidates[i].closest('cart-drawer')) {
      return candidates[i];
    }
  }

  return null;
}

let exm_cta_busy = false;
let exm_cta_busy_timer = null;

function exm_cta_set_busy(busy) {
  exm_cta_busy = busy;

  clearTimeout(exm_cta_busy_timer);

  document.querySelectorAll('[data-exm-cta-block]').forEach(function(block){
    block.classList.toggle('exm-cta--busy', busy);
  });

  if (busy) {
    exm_cta_busy_timer = setTimeout(function(){
      exm_cta_set_busy(false);
    }, 10000);
  }
}

function exm_cta_mount() {
  document.querySelectorAll('[data-exm-cta-block]').forEach(function(block){
    const target = exm_cta_target(block);

    if (!target) {
      return;
    }

    target.querySelectorAll('[data-exm-cta-block]').forEach(function(stale){
      if (stale !== block) {
        stale.remove();
      }
    });

    if (block.parentElement !== target) {
      target.appendChild(block);
    }

    target.querySelectorAll('[name="checkout"]').forEach(function(native){
      if (!native.closest('[data-exm-cta-block]')) {
        native.classList.add('exm-cta-replaced');
      }
    });

    block.classList.add('is-mounted');
    block.classList.toggle('exm-cta--busy', exm_cta_busy);
  });
}

let exm_cta_mount_timer = null;

function exm_cta_mount_soon() {
  clearTimeout(exm_cta_mount_timer);
  exm_cta_mount_timer = setTimeout(exm_cta_mount, 50);
}

function exm_cta_watch(selector) {
  const node = document.querySelector(selector);

  if (!node) {
    return;
  }

  new MutationObserver(exm_cta_mount_soon).observe(node, { childList: true, subtree: true });
}

exm_cta_mount();

document.addEventListener('DOMContentLoaded', function(){
  exm_cta_mount();

  exm_cta_watch('cart-drawer');
  exm_cta_watch('#main-cart-items');
  exm_cta_watch('#main-cart-footer');

  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
    subscribe(PUB_SUB_EVENTS.cartUpdate, exm_cta_mount_soon);
  }
});

function exm_cta_fail(error) {
  console.error('Subscribfy: checkout buttons', error);

  exm_cta_set_busy(false);

  document.querySelectorAll('[data-exm-cta-error]').forEach(function(message){
    message.textContent = EXM_CTA_ERROR_TEXT;
  });
}

let exm_cta_fallback_timer = null;

function exm_cta_proxy() {
  const proxies = document.querySelectorAll('[data-exm-cta-block] [data-exm-cta-proxy]');

  for (let i = 0; i < proxies.length; i++) {
    if (proxies[i].isConnected) {
      return proxies[i];
    }
  }

  return null;
}

function exm_cta_proceed() {
  const proxy = exm_cta_proxy();

  if (proxy && window.jQuery && window.exmData) {
    proxy.click();

    exm_cta_fallback_timer = setTimeout(function(){
      window.location = exm_cta_checkout_url();
    }, 8000);

    return;
  }

  window.location = exm_cta_checkout_url();
}

// Checkout apps (Selleasy pre-checkout popup, Insureful shipping protection) hook the
// theme's native [name="checkout"] button, which the CTA block hides. Click it so their
// handlers run, then take over at the form submit it ends in and go through the proxy.
let exm_cta_pending = false;
let exm_cta_guard_timer = null;

function exm_cta_checkout(block) {
  const target = exm_cta_target(block);
  const native = target && target.querySelector('[name="checkout"].exm-cta-replaced');

  if (!native || native.disabled || !native.form) {
    exm_cta_proceed();

    return;
  }

  exm_cta_pending = true;
  exm_cta_guard();
  native.click();
}

// Safety net: if no submit follows (an app swallowed the click or failed), go to
// checkout anyway. Waits while the Selleasy popup is open, since the shopper is on it.
function exm_cta_guard() {
  clearTimeout(exm_cta_guard_timer);

  exm_cta_guard_timer = setTimeout(function(){
    if (!exm_cta_pending) {
      return;
    }

    if (document.querySelector('#lb-upsell-dialog[open]')) {
      exm_cta_guard();

      return;
    }

    exm_cta_pending = false;
    exm_cta_proceed();
  }, 8000);
}

document.addEventListener('submit', function(e){
  if (!exm_cta_pending || !e.submitter || e.submitter.name !== 'checkout') {
    return;
  }

  e.preventDefault();

  exm_cta_pending = false;
  clearTimeout(exm_cta_guard_timer);
  exm_cta_proceed();
}, true);

function exm_cta_cancel_fallback() {
  clearTimeout(exm_cta_fallback_timer);
  clearTimeout(exm_cta_guard_timer);

  exm_cta_fallback_timer = null;
  exm_cta_pending = false;
}

function exm_cta_reset() {
  exm_cta_cancel_fallback();
  exm_cta_set_busy(false);

  document.querySelectorAll('[data-exm-cta-error]').forEach(function(message){
    message.textContent = '';
  });

  document.querySelectorAll('.exm_cart__checkout-button').forEach(function(button){
    button.disabled = false;
  });
}

window.addEventListener('pagehide', exm_cta_cancel_fallback);

window.addEventListener('pageshow', function(e){
  const navigation = window.performance && window.performance.navigation;
  const restored = e.persisted || (navigation && navigation.type === 2);

  if (!restored) {
    return;
  }

  exm_cta_reset();
  exm_cta_mount();
});

function exm_cta_post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function(response){
    if (!response.ok) {
      throw new Error(url + ' responded ' + response.status);
    }

    return response.json();
  });
}

function exm_cta_handle(block, mode) {
  const variantId = Number(block.getAttribute('data-exm-vip-variant') || 0);
  const planId = Number(block.getAttribute('data-exm-vip-plan') || 0);

  if (!variantId) {
    exm_cta_checkout(block);

    return;
  }

  const cartUrl = (window.routes && window.routes.cart_url) || '/cart';

  fetch(cartUrl + '.js')
    .then(function(response){ return response.json(); })
    .then(function(cart){
      const line = (cart.items || []).find(function(item){
        return Number(item.variant_id) === variantId;
      });

      if (mode === 'vip') {
        if (line) {
          return null;
        }

        const item = { id: variantId, quantity: 1 };

        if (planId) {
          item.selling_plan = planId;
        }

        exm_eraseCookie('exmcart');

        return exm_cta_post(window.routes.cart_add_url + '.js', { items: [item] });
      }

      if (!line) {
        return null;
      }

      exm_setCookie('exmcart', 'PAYG', 720);

      return exm_cta_post(window.routes.cart_change_url + '.js', { id: line.key, quantity: 0 });
    })
    .then(function(){
      exm_cta_checkout(block);
    })
    .catch(function(error){
      exm_cta_fail(error);
    });
}

document.addEventListener('click', function(e){
  const trigger = e.target.closest('[data-exm-cta]');

  if (!trigger) {
    return;
  }

  const block = trigger.closest('[data-exm-cta-block]');

  if (!block) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  if (exm_cta_busy) {
    return;
  }

  const mode = trigger.getAttribute('data-exm-cta');

  exm_cta_set_busy(true);

  if (mode !== 'guest' && mode !== 'vip') {
    exm_cta_checkout(block);

    return;
  }

  exm_cta_handle(block, mode);
}, true);

function exm_setCookie(name, value, hours) {
  var expires = "";
  if (hours) {
    var date = new Date();
    date.setTime(date.getTime() + (hours * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "") + expires + "; path=/";
}
function exm_getCookie(name) {
  var nameEQ = name + "=";
  var ca = document.cookie.split(';');
  for (var i = 0; i < ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0) == ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}
function exm_eraseCookie(name) {
  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

