(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
  const API_BASE = (window.FOODIEHUB_API_URL || "").replace(/\/$/, "");
  const STORAGE = {
    cart: "foodiehub.cart.v2",
    favourites: "foodiehub.favourites.v2",
    theme: "foodiehub.theme.v2",
    orders: "foodiehub.orders.v2"
  };

  const state = {
    menu: [],
    cart: readStore(STORAGE.cart, {}),
    favourites: readStore(STORAGE.favourites, []),
    orders: readStore(STORAGE.orders, []),
    category: "All",
    diet: "all",
    query: "",
    sort: "recommended",
    onlyFavourites: false,
    coupon: null,
    backendOnline: false
  };

  function readStore(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function saveStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  async function request(path, options = {}) {
    const response = await fetch(API_BASE + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || "Something went wrong.");
    return payload;
  }

  async function checkBackend() {
    try {
      await request("/api/health");
      state.backendOnline = true;
      document.documentElement.dataset.backend = "connected";
    } catch (_) {
      state.backendOnline = false;
      document.documentElement.dataset.backend = "demo";
    }
  }

  async function loadMenu() {
    try {
      const result = await request("/api/menu");
      if (Array.isArray(result.items) && result.items.length) return result.items;
    } catch (_) {}
    const response = await fetch("./data/menu.json", { cache: "no-store" });
    if (!response.ok) throw new Error("The menu could not be loaded. Please refresh the page.");
    return response.json();
  }

  function showToast(message, type = "success") {
    const region = $("#toastRegion");
    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.textContent = message;
    region.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    window.setTimeout(() => {
      toast.classList.remove("visible");
      window.setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && dialog.open) dialog.close();
  }

  function renderCategories() {
    const categories = ["All", ...new Set(state.menu.map(item => item.category))];
    $("#categoryTabs").innerHTML = categories.map(category => {
      const active = state.category === category ? " active" : "";
      const label = category === "All" ? "Everything" : escapeHTML(category);
      const mark = category === "All" ? " <span>✦</span>" : "";
      return '<button class="category-tab' + active + '" type="button" data-category="' + escapeHTML(category) + '">' + label + mark + "</button>";
    }).join("");
    $$("#categoryTabs [data-category]").forEach(button => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category;
        renderCategories();
        renderMenu();
      });
    });
  }

  function visibleMenu() {
    let items = state.menu.filter(item => {
      const matchesCategory = state.category === "All" || item.category === state.category;
      const matchesDiet = state.diet === "all" || (state.diet === "veg" ? item.isVeg : !item.isVeg);
      const query = state.query.trim().toLowerCase();
      const matchesSearch = !query || [item.name, item.description, item.category, ...(item.tags || [])].join(" ").toLowerCase().includes(query);
      const matchesFavourite = !state.onlyFavourites || state.favourites.includes(item.id);
      return matchesCategory && matchesDiet && matchesSearch && matchesFavourite;
    });

    if (state.sort === "price-low") items.sort((a, b) => a.price - b.price);
    if (state.sort === "price-high") items.sort((a, b) => b.price - a.price);
    if (state.sort === "discount") items.sort((a, b) => b.discountPercent - a.discountPercent);
    if (state.sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    if (state.sort === "recommended") items.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
    return items;
  }

  function renderMenu() {
    const grid = $("#menuGrid");
    const items = visibleMenu();
    grid.innerHTML = "";
    $("#menuCount").textContent = items.length;
    $("#menuStatus").textContent = state.onlyFavourites ? "Your saved favourites" : (state.query ? "Showing matches for “" + state.query + "”" : "A few good things to get you started");
    $("#emptyMenu").hidden = items.length > 0;

    if (!items.length) return;
    const template = $("#dishCardTemplate");
    items.forEach(item => {
      const card = template.content.firstElementChild.cloneNode(true);
      const image = $("[data-image]", card);
      image.src = item.image;
      image.alt = item.name + " — " + item.description;
      $("[data-discount]", card).textContent = item.discountPercent + "% OFF";
      $("[data-diet-indicator]", card).classList.add(item.isVeg ? "diet-veg" : "diet-nonveg");
      $("[data-diet-indicator]", card).setAttribute("aria-label", item.isVeg ? "Vegetarian" : "Non-vegetarian");
      $("[data-category-label]", card).textContent = item.category;
      $("[data-prep]", card).textContent = item.prepTime + " min";
      $("[data-name]", card).textContent = item.name;
      $("[data-description]", card).textContent = item.description;
      $("[data-price]", card).textContent = money(item.price);
      $("[data-original]", card).textContent = money(item.originalPrice);
      $("[data-badge]", card).textContent = item.badge || "";
      const favourite = $("[data-favourite]", card);
      const saved = state.favourites.includes(item.id);
      favourite.classList.toggle("is-saved", saved);
      favourite.textContent = saved ? "♥" : "♡";
      favourite.setAttribute("aria-label", saved ? "Remove from favourites" : "Add to favourites");
      favourite.addEventListener("click", () => toggleFavourite(item.id));
      $("[data-add]", card).addEventListener("click", () => addToCart(item.id));
      grid.appendChild(card);
    });
  }

  function toggleFavourite(id) {
    state.favourites = state.favourites.includes(id)
      ? state.favourites.filter(itemId => itemId !== id)
      : [...state.favourites, id];
    saveStore(STORAGE.favourites, state.favourites);
    renderMenu();
    showToast(state.favourites.includes(id) ? "Saved to your favourites." : "Removed from your favourites.");
  }

  function addToCart(id) {
    state.cart[id] = (state.cart[id] || 0) + 1;
    saveStore(STORAGE.cart, state.cart);
    renderCart();
    showToast("A delicious choice. Added to your bag!");
  }

  function changeQuantity(id, change) {
    const next = (state.cart[id] || 0) + change;
    if (next <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(20, next);
    saveStore(STORAGE.cart, state.cart);
    renderCart();
  }

  function getCartLines() {
    return Object.entries(state.cart).map(([id, quantity]) => {
      const item = state.menu.find(product => product.id === id);
      return item ? { ...item, quantity } : null;
    }).filter(Boolean);
  }

  function calculateBill() {
    const lines = getCartLines();
    const subtotal = lines.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let couponDiscount = 0;
    if (state.coupon && subtotal >= state.coupon.minimum) {
      couponDiscount = Math.min(Math.round(subtotal * state.coupon.percent / 100), state.coupon.maximum);
    }
    const delivery = subtotal === 0 || subtotal >= 499 ? 0 : 39;
    const taxable = Math.max(0, subtotal - couponDiscount);
    const tax = Math.round(taxable * 0.05);
    return { lines, subtotal, couponDiscount, delivery, tax, total: taxable + delivery + tax };
  }

  function renderCart() {
    const bill = calculateBill();
    const count = bill.lines.reduce((sum, item) => sum + item.quantity, 0);
    $("#cartCount").textContent = count;
    $("#drawerItemCount").textContent = "(" + count + ")";
    $("#checkoutButton").disabled = count === 0;
    $("#billSubtotal").textContent = money(bill.subtotal);
    $("#billDiscount").textContent = "−" + money(bill.couponDiscount);
    $("#billDelivery").textContent = bill.delivery ? money(bill.delivery) : (bill.subtotal ? "FREE" : money(0));
    $("#billTax").textContent = money(bill.tax);
    $("#billTotal").textContent = money(bill.total);
    $("#checkoutTotal").textContent = money(bill.total);

    if (bill.subtotal >= 499) {
      $("#deliveryMessage").textContent = "Lovely. You've unlocked free delivery.";
      $("#deliveryProgress").classList.add("delivery-unlocked");
    } else {
      $("#deliveryMessage").textContent = bill.subtotal ? "Add " + money(499 - bill.subtotal) + " more for free delivery." : "Add ₹499 worth of food for free delivery.";
      $("#deliveryProgress").classList.remove("delivery-unlocked");
    }

    const container = $("#cartItems");
    if (!bill.lines.length) {
      container.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">♡</span><h3>Your bag is taking a breather.</h3><p>Add something delicious and it will show up here.</p><button class="text-link" id="continueShopping" type="button">Explore the menu →</button></div>';
      $("#continueShopping").addEventListener("click", closeCart);
    } else {
      container.innerHTML = bill.lines.map(item => (
        '<article class="cart-line">' +
          '<img src="' + escapeHTML(item.image) + '" alt="" loading="lazy">' +
          '<div class="cart-line-info"><strong>' + escapeHTML(item.name) + '</strong><small>' + money(item.price) + ' each</small>' +
            '<div class="quantity-control"><button type="button" data-quantity="' + item.id + '" data-change="-1" aria-label="Remove one">−</button><span>' + item.quantity + '</span><button type="button" data-quantity="' + item.id + '" data-change="1" aria-label="Add one">+</button></div>' +
          '</div><strong class="cart-line-total">' + money(item.price * item.quantity) + '</strong>' +
        '</article>'
      )).join("");
      $$("[data-quantity]", container).forEach(button => {
        button.addEventListener("click", () => changeQuantity(button.dataset.quantity, Number(button.dataset.change)));
      });
    }
    if (state.coupon && bill.subtotal < state.coupon.minimum) {
      $("#couponMessage").textContent = "Add " + money(state.coupon.minimum - bill.subtotal) + " more to use " + state.coupon.code + ".";
      $("#couponMessage").className = "coupon-message message-warning";
    } else if (state.coupon) {
      $("#couponMessage").textContent = state.coupon.code + " applied. You're saving " + money(bill.couponDiscount) + ".";
      $("#couponMessage").className = "coupon-message message-success";
    }
  }

  function openCart() {
    $("#cartDrawer").classList.add("is-open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    $("#cartBackdrop").classList.add("is-visible");
    document.body.classList.add("drawer-open");
    $("#closeCart").focus();
  }

  function closeCart() {
    $("#cartDrawer").classList.remove("is-open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    $("#cartBackdrop").classList.remove("is-visible");
    document.body.classList.remove("drawer-open");
  }

  function applyCoupon() {
    const code = $("#couponInput").value.trim().toUpperCase();
    const coupons = {
      HUB50: { code: "HUB50", percent: 50, maximum: 200, minimum: 699 },
      FOOD25: { code: "FOOD25", percent: 25, maximum: 100, minimum: 299 }
    };
    if (!coupons[code]) {
      state.coupon = null;
      $("#couponMessage").textContent = "That code doesn't look right. Try HUB50 or FOOD25.";
      $("#couponMessage").className = "coupon-message message-warning";
    } else if (calculateBill().subtotal < coupons[code].minimum) {
      state.coupon = coupons[code];
      $("#couponMessage").textContent = "Add " + money(coupons[code].minimum - calculateBill().subtotal) + " more to unlock " + code + ".";
      $("#couponMessage").className = "coupon-message message-warning";
    } else {
      state.coupon = coupons[code];
      $("#couponMessage").textContent = code + " applied. Your discount is ready.";
      $("#couponMessage").className = "coupon-message message-success";
      showToast("Offer applied. Enjoy the extra savings!");
    }
    renderCart();
  }

  function openCheckout() {
    if (!getCartLines().length) return;
    closeCart();
    $("#checkoutError").textContent = "";
    $("#checkoutForm").reset();
    renderCart();
    openDialog("checkoutDialog");
  }

  function saveLocalOrder(order) {
    state.orders.unshift(order);
    saveStore(STORAGE.orders, state.orders.slice(0, 20));
  }

  async function placeOrder(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customer = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").replace(/\D/g, "").slice(-10),
      email: String(form.get("email") || "").trim(),
      address: String(form.get("address") || "").trim()
    };
    if (customer.phone.length !== 10 || !/^[6-9]/.test(customer.phone)) {
      $("#checkoutError").textContent = "Please enter a valid 10-digit Indian mobile number.";
      return;
    }
    const payload = {
      customer,
      items: Object.entries(state.cart).map(([productId, quantity]) => ({ productId, quantity })),
      couponCode: state.coupon ? state.coupon.code : "",
      paymentMethod: String(form.get("paymentMethod") || "cod")
    };
    const submit = $(".place-order-button");
    submit.disabled = true;
    submit.textContent = "Placing your order…";
    try {
      let order;
      if (state.backendOnline) {
        order = await request("/api/orders", { method: "POST", body: JSON.stringify(payload) });
      } else {
        const bill = calculateBill();
        order = {
          orderNumber: "FH-" + Date.now().toString(36).toUpperCase(),
          status: "demo_saved",
          total: bill.total,
          createdAt: new Date().toISOString(),
          message: "Demo order saved on this device only."
        };
        saveLocalOrder({ ...order, phone: customer.phone, items: payload.items, customer });
      }
      state.cart = {};
      state.coupon = null;
      saveStore(STORAGE.cart, state.cart);
      renderCart();
      closeDialog("checkoutDialog");
      $("#successOrderNumber").textContent = order.orderNumber;
      $("#successMessage").textContent = state.backendOnline
        ? "Your order has been saved. Keep this number handy for updates."
        : "This demo order is saved in this browser only. Connect the backend to save orders centrally.";
      openDialog("successDialog");
    } catch (error) {
      $("#checkoutError").textContent = error.message || "We couldn't place that order. Please try again.";
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Place my order <span aria-hidden="true">↗</span>';
    }
  }

  function openTracking() {
    closeCart();
    $("#trackingForm").reset();
    $("#trackingError").textContent = "";
    $("#trackingResult").hidden = true;
    openDialog("trackingDialog");
  }

  async function trackOrder(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const orderNumber = String(form.get("orderNumber") || "").trim().toUpperCase();
    const phone = String(form.get("phone") || "").replace(/\D/g, "").slice(-10);
    $("#trackingError").textContent = "";
    $("#trackingResult").hidden = true;
    try {
      let order;
      if (state.backendOnline) {
        order = await request("/api/orders/track?order=" + encodeURIComponent(orderNumber) + "&phone=" + encodeURIComponent(phone));
      } else {
        order = state.orders.find(item => item.orderNumber.toUpperCase() === orderNumber && item.phone === phone);
        if (!order) throw new Error("No matching demo order was found on this device.");
      }
      const result = $("#trackingResult");
      const status = String(order.status || "confirmed").replace(/_/g, " ");
      result.innerHTML = '<span class="tracking-status-dot"></span><span class="drawer-kicker">ORDER ' + escapeHTML(order.orderNumber) + '</span><h3>' + escapeHTML(status.replace(/\b\w/g, letter => letter.toUpperCase())) + '</h3><p>' + escapeHTML(order.message || "Your order details are up to date.") + '</p><div class="tracking-total"><span>Order total</span><strong>' + money(order.total) + '</strong></div>';
      result.hidden = false;
    } catch (error) {
      $("#trackingError").textContent = error.message || "We couldn't find that order.";
    }
  }

  async function subscribe(event) {
    event.preventDefault();
    const email = $("#newsletterEmail").value.trim();
    const message = $("#newsletterMessage");
    try {
      if (state.backendOnline) {
        await request("/api/newsletter", { method: "POST", body: JSON.stringify({ email }) });
        message.textContent = "You're on the list. Watch your inbox!";
      } else {
        message.textContent = "Thanks! This demo doesn't store newsletter sign-ups yet.";
      }
      event.currentTarget.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    saveStore(STORAGE.theme, theme);
    $("#themeToggle").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }

  function bindEvents() {
    $("#openCart").addEventListener("click", openCart);
    $("#closeCart").addEventListener("click", closeCart);
    $("#cartBackdrop").addEventListener("click", closeCart);
    $("#checkoutButton").addEventListener("click", openCheckout);
    $("#applyCoupon").addEventListener("click", applyCoupon);
    $("#couponInput").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); applyCoupon(); } });
    $("#checkoutForm").addEventListener("submit", placeOrder);
    $("#trackingForm").addEventListener("submit", trackOrder);
    $("#trackOrderLink").addEventListener("click", openTracking);
    $("#successDone").addEventListener("click", () => closeDialog("successDialog"));
    $("#newsletterForm").addEventListener("submit", subscribe);
    $("#themeToggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    $("#favouritesToggle").addEventListener("click", () => {
      state.onlyFavourites = !state.onlyFavourites;
      $("#favouritesToggle").classList.toggle("is-active", state.onlyFavourites);
      $("#favouritesToggle").setAttribute("aria-label", state.onlyFavourites ? "Show all dishes" : "Show favourites");
      state.category = "All";
      state.diet = "all";
      $$(".diet-button").forEach(button => button.classList.toggle("active", button.dataset.diet === "all"));
      renderCategories();
      renderMenu();
      document.getElementById("menu").scrollIntoView({ behavior: "smooth" });
    });
    $("#menuSearch").addEventListener("input", event => { state.query = event.target.value; renderMenu(); });
    $("#sortMenu").addEventListener("change", event => { state.sort = event.target.value; renderMenu(); });
    $$(".diet-button").forEach(button => button.addEventListener("click", () => {
      state.diet = button.dataset.diet;
      $$(".diet-button").forEach(item => item.classList.toggle("active", item === button));
      renderMenu();
    }));
    $("#clearFilters").addEventListener("click", () => {
      state.category = "All";
      state.diet = "all";
      state.query = "";
      state.onlyFavourites = false;
      $("#menuSearch").value = "";
      $("#favouritesToggle").classList.remove("is-active");
      $$(".diet-button").forEach(button => button.classList.toggle("active", button.dataset.diet === "all"));
      renderCategories();
      renderMenu();
    });
    $$("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
    $$(".site-dialog").forEach(dialog => dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    }));
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#menuSearch").focus();
      }
      if (event.key === "Escape") closeCart();
    });
  }

  async function init() {
    setTheme(readStore(STORAGE.theme, "light"));
    $("#currentYear").textContent = new Date().getFullYear();
    bindEvents();
    renderCart();
    try {
      await Promise.all([checkBackend()]);
      state.menu = await loadMenu();
      renderCategories();
      renderMenu();
      if (state.backendOnline) {
        showToast("FoodieHub API connected. Orders can be saved.");
      }
    } catch (error) {
      $("#menuStatus").textContent = error.message;
      showToast(error.message, "error");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();