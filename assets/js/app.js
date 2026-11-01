(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
  const API_BASE = (window.FOODIEHUB_API_URL || "").replace(/\/$/, "");

  const PHOTO_FALLBACKS = {
    Burgers:"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1100&q=88",
    Pizza:"https://images.unsplash.com/photo-1658478006307-525ab032ab26?auto=format&fit=crop&w=1100&q=88",
    Pasta:"https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?auto=format&fit=crop&w=1100&q=88",
    Bowls:"https://images.unsplash.com/photo-1680405531955-8b4981bb1b0c?auto=format&fit=crop&w=1100&q=88",
    Indian:"https://images.unsplash.com/photo-1641893728260-19493532d6b9?auto=format&fit=crop&w=1100&q=88",
    Sides:"https://images.unsplash.com/photo-1688978181542-87a886a16fbe?auto=format&fit=crop&w=1100&q=88",
    Desserts:"https://images.unsplash.com/photo-1617305855058-336d24456869?auto=format&fit=crop&w=1100&q=88",
    Drinks:"https://images.pexels.com/photos/8211179/pexels-photo-8211179.jpeg?auto=compress&cs=tinysrgb&w=1200",
    Featured:"https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=88",
    General:"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1100&q=88"
  };
  function protectFoodPhoto(image,item){
    const list=[PHOTO_FALLBACKS[item.category]||PHOTO_FALLBACKS.Featured,PHOTO_FALLBACKS.General];
    let next=0;
    image.onerror=()=>{
      while(next<list.length){
        const candidate=list[next++];
        if(candidate===image.src)continue;
        if(item.id)state.imageFallbacks[item.id]=candidate;
        image.src=candidate;return;
      }
      image.onerror=null;image.removeAttribute("src");
      image.alt=(item.name||"Food")+" photo is temporarily unavailable";
      image.classList.add("photo-unavailable");
    };
  }
  const STORAGE = {
    cart: "foodiehub.cart.v2",
    favourites: "foodiehub.favourites.v2",
    theme: "foodiehub.theme.v2",
    orders: "foodiehub.orders.v2",
    profile: "foodiehub.profile.v1",
    rewards: "foodiehub.rewards.v1"
  };

  const state = {
    menu: [],
    cart: readStore(STORAGE.cart, {}),
    favourites: readStore(STORAGE.favourites, []),
    orders: readStore(STORAGE.orders, []),
    profile: readStore(STORAGE.profile, { name: "", phone: "", email: "", address: "" }),
    customizations: readStore("foodiehub.customizations.v1", {}),
    imageFallbacks: {},
    currentCustomizer: null,
    customizerQuantity: 1,
    category: "All",
    diet: "all",
    query: "",
    sort: "recommended",
    onlyFavourites: false,
    coupon: null,
    backendOnline: false,
    rewards: readStore(STORAGE.rewards, { points: 0, lifetime: 0 }),
    pendingRewardRedemption: false,
    adminKey: "",
    adminOrders: [],
    adminSource: "none"
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

  function renderProfile() {
    const name = String(state.profile.name || "").trim();
    $("#profileTriggerLabel").textContent = name ? name.split(/\s+/)[0] : "Profile";
    $("#openProfile").setAttribute("aria-label", name ? "Open profile for " + name : "Open your profile");
  }

  function openProfile() {
    const form = $("#profileForm");
    ["name", "phone", "email", "address"].forEach(field => {
      form.elements.namedItem(field).value = state.profile[field] || "";
    });
    $("#profileError").textContent = "";
    $("#profileMessage").textContent = state.profile.name || state.profile.address
      ? "Your saved details are ready to edit."
      : "Add your details and delivery address here.";
    openDialog("profileDialog");
  }

  function saveProfile(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = String(form.get("phone") || "").replace(/\D/g, "").slice(-10);
    if (phone && (phone.length !== 10 || !/^[6-9]/.test(phone))) {
      $("#profileError").textContent = "Enter a valid 10-digit Indian mobile number, or leave it blank.";
      return;
    }
    state.profile = {
      name: String(form.get("name") || "").trim(),
      phone,
      email: String(form.get("email") || "").trim(),
      address: String(form.get("address") || "").trim()
    };
    saveStore(STORAGE.profile, state.profile);
    renderProfile();
    $("#profileError").textContent = "";
    $("#profileMessage").textContent = "Saved on this browser. Your next checkout can use these details.";
    showToast("Your profile and delivery address have been saved.");
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
      image.alt = item.name + " — " + item.description;
      protectFoodPhoto(image,item);
      image.src = state.imageFallbacks[item.id] || item.image;
      image.addEventListener("click", () => openDishDetails(item.id));
      $("[data-name]", card).addEventListener("click", () => openDishDetails(item.id));
      $("[data-customize]", card).addEventListener("click", () => openDishDetails(item.id));
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
      $("[data-add]", card).addEventListener("click", event => addToCart(item.id, event.currentTarget));
      grid.appendChild(card);
    });
  }


  function customizerAddons(item) {
    const category = String(item.category || "").toLowerCase();
    if (category === "pizza") return [
      { name: "Extra cheese", price: 35 },
      { name: item.isVeg ? "Extra paneer" : "Extra chicken", price: item.isVeg ? 49 : 59 },
      { name: "Jalapeños", price: 20 },
      { name: "Black olives", price: 25 },
      { name: "Chilli flakes", price: 0 }
    ];
    if (category === "burgers") return [
      { name: "Extra cheese", price: 29 },
      { name: item.isVeg ? "Extra paneer patty" : "Extra chicken patty", price: item.isVeg ? 49 : 69 },
      { name: "Fries combo", price: 69 },
      { name: "Signature dip", price: 20 }
    ];
    if (["pasta", "bowls", "indian"].includes(category)) return [
      { name: "Extra cheese", price: 29 },
      { name: item.isVeg ? "Extra paneer" : "Extra chicken", price: item.isVeg ? 49 : 59 },
      { name: "Extra sauce / gravy", price: 25 },
      { name: "Garlic bread", price: 49 }
    ];
    if (category === "desserts") return [
      { name: "Ice cream scoop", price: 39 },
      { name: "Whipped cream", price: 19 },
      { name: "Chocolate drizzle", price: 20 }
    ];
    if (category === "drinks") return [
      { name: "Extra espresso shot", price: 35 },
      { name: "Whipped cream", price: 19 },
      { name: "Vanilla scoop", price: 29 }
    ];
    return [
      { name: "Signature dip", price: 20 },
      { name: "Extra cheese", price: 25 },
      { name: "Make it loaded", price: 35 }
    ];
  }

  function customizerPreferences(item) {
    const category = String(item.category || "").toLowerCase();
    if (category === "drinks") return ["Less ice", "No added sugar", "Extra chilled"];
    if (category === "desserts") return ["Warm it slightly", "No extra drizzle"];
    if (category === "burgers" || category === "pizza" || category === "sides") return ["Less spicy", "Extra spicy", "Extra crispy", "No onion"];
    return ["Less spicy", "Medium spicy", "Extra spicy", "No onion", "Sauce on the side"];
  }

  function customizerSizes(item) {
    const category = String(item.category || "").toLowerCase();
    const largePrice = category === "drinks" ? 30 : category === "desserts" ? 35 : category === "sides" ? 29 : 49;
    return [{ name: "Regular", price: 0, note: "Classic portion" }, { name: category === "drinks" ? "Large" : category === "desserts" ? "Double treat" : "Large", price: largePrice, note: "A little more to love" }];
  }

  function openDishDetails(id) {
    const item = state.menu.find(product => product.id === id);
    if (!item) return;
    state.currentCustomizer = id;
    state.customizerQuantity = 1;
    const customizerImage=$("#customizerImage");
    customizerImage.alt=item.name+" — "+item.description;
    protectFoodPhoto(customizerImage,item);
    customizerImage.src=state.imageFallbacks[id]||item.image;
    $("#customizerTitle").textContent = item.name;
    $("#customizerDescription").textContent = item.description;
    $("#customizerBasePrice").textContent = money(item.price);
    const saved = state.customizations[id] || {};
    const sizes = customizerSizes(item);
    $("#customizerSizeOptions").innerHTML = sizes.map((size,index) =>
      '<label class="customizer-choice"><input type="radio" name="dishSize" value="' + escapeHTML(size.name) + '" data-extra="' + size.price + '"' + ((saved.size || "Regular") === size.name ? " checked" : (!saved.size && index === 0 ? " checked" : "")) + '><span>' + escapeHTML(size.name) + '<small>' + escapeHTML(size.note) + '</small></span><strong>' + (size.price ? "+" + money(size.price) : "Included") + '</strong></label>'
    ).join("");
    const addons = customizerAddons(item);
    const savedExtras = Array.isArray(saved.extras) ? saved.extras.map(extra => extra.name) : [];
    $("#customizerAddonOptions").innerHTML = addons.map(addon =>
      '<label class="customizer-addon"><input type="checkbox" name="dishAddon" value="' + escapeHTML(addon.name) + '" data-price="' + addon.price + '"' + (savedExtras.includes(addon.name) ? " checked" : "") + '><span>' + escapeHTML(addon.name) + '</span><strong>' + (addon.price ? "+" + money(addon.price) : "Free") + '</strong></label>'
    ).join("");
    const preferences = customizerPreferences(item);
    const savedPreferences = Array.isArray(saved.preferences) ? saved.preferences : [];
    $("#customizerPreferenceOptions").innerHTML = preferences.map(preference =>
      '<label class="customizer-preference"><input type="checkbox" name="dishPreference" value="' + escapeHTML(preference) + '"' + (savedPreferences.includes(preference) ? " checked" : "") + '>' + escapeHTML(preference) + '</label>'
    ).join("");
    $("#customizerNote").value = saved.note || "";
    $("#customizerQty").textContent = "1";
    updateCustomizerTotal();
    openDialog("dishDetailDialog");
  }

  function updateCustomizerTotal() {
    if (!state.currentCustomizer) return;
    const item = state.menu.find(product => product.id === state.currentCustomizer);
    if (!item) return;
    const size = $('input[name="dishSize"]:checked');
    const sizeExtra = Number(size ? size.dataset.extra : 0);
    const extras = $$('input[name="dishAddon"]:checked').reduce((sum,input) => sum + Number(input.dataset.price || 0), 0);
    const unit = item.price + sizeExtra + extras;
    $("#customizerUnitPrice").textContent = money(unit);
    $("#customizerTotal").textContent = money(unit * state.customizerQuantity);
    $("#customizerQty").textContent = state.customizerQuantity;
  }

  function addCustomizedDish(event) {
    event.preventDefault();
    const id = state.currentCustomizer;
    const item = state.menu.find(product => product.id === id);
    if (!item) return;
    const size = $('input[name="dishSize"]:checked');
    const extras = $$('input[name="dishAddon"]:checked').map(input => ({ name: input.value, price: Number(input.dataset.price || 0) }));
    const preferences = $$('input[name="dishPreference"]:checked').map(input => input.value);
    state.customizations[id] = {
      size: size ? size.value : "Regular",
      sizeExtra: Number(size ? size.dataset.extra : 0),
      extras,
      preferences,
      note: $("#customizerNote").value.trim()
    };
    state.cart[id] = Math.min(20, (state.cart[id] || 0) + state.customizerQuantity);
    saveStore(STORAGE.cart, state.cart);
    saveStore("foodiehub.customizations.v1", state.customizations);
    renderCart();
    const card = $$("#menuGrid .dish-card").find(element => $("[data-name]",element)?.textContent === item.name) || null;
    const addButton = card ? $('[data-add]', card) : null;
    animateAddToCart(addButton);
    closeDialog("dishDetailDialog");
    showToast(item.name + " customised and added to your bag.");
  }

  function toggleFavourite(id) {
    state.favourites = state.favourites.includes(id)
      ? state.favourites.filter(itemId => itemId !== id)
      : [...state.favourites, id];
    saveStore(STORAGE.favourites, state.favourites);
    renderMenu();
    showToast(state.favourites.includes(id) ? "Saved to your favourites." : "Removed from your favourites.");
  }

  function addToCart(id, button) {
    state.cart[id] = (state.cart[id] || 0) + 1;
    saveStore(STORAGE.cart, state.cart);
    renderCart();
    animateAddToCart(button);
    showToast("A delicious choice. Added to your bag!");
  }

  function animateAddToCart(button) {
    const cartButton = $("#openCart");
    const card = button ? button.closest(".dish-card") : null;
    const sourceImage = card ? $(".dish-image", card) : null;
    if (button) {
      button.classList.add("is-added");
      button.innerHTML = '<span aria-hidden="true">✓</span> Added';
      window.setTimeout(() => {
        if (button.isConnected) {
          button.classList.remove("is-added");
          button.innerHTML = '<span aria-hidden="true">＋</span> Add';
        }
      }, 900);
    }
    if (!cartButton || !sourceImage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = sourceImage.getBoundingClientRect();
    const to = cartButton.getBoundingClientRect();
    const flyer = document.createElement("img");
    flyer.className = "cart-flight";
    flyer.src = sourceImage.currentSrc || sourceImage.src;
    flyer.alt = "";
    flyer.setAttribute("aria-hidden", "true");
    flyer.style.left = (from.left + from.width / 2 - 28) + "px";
    flyer.style.top = (from.top + from.height / 2 - 28) + "px";
    document.body.appendChild(flyer);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const flight = flyer.animate([
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
      { transform: "translate3d(" + dx + "px," + dy + "px,0) scale(.18)", opacity: .15 }
    ], { duration: 640, easing: "cubic-bezier(.22,.72,.28,1)" });
    flight.onfinish = () => flyer.remove();
    cartButton.classList.remove("cart-bump");
    $("#cartCount").classList.remove("count-pop");
    void cartButton.offsetWidth;
    cartButton.classList.add("cart-bump");
    $("#cartCount").classList.add("count-pop");
    window.setTimeout(() => cartButton.classList.remove("cart-bump"), 520);
    window.setTimeout(() => $("#cartCount").classList.remove("count-pop"), 460);
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
      if (!item) return null;
      const customization = state.customizations[id] || {};
      const extras = Array.isArray(customization.extras) ? customization.extras : [];
      const unitPrice = item.price + Number(customization.sizeExtra || 0) + extras.reduce((sum, extra) => sum + Number(extra.price || 0), 0);
      return { ...item, quantity, customization, price: unitPrice, basePrice: item.price };
    }).filter(Boolean);
  }

  function calculateBill() {
    const lines = getCartLines();
    const subtotal = lines.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let couponDiscount = 0;
    if (state.coupon && subtotal >= state.coupon.minimum) {
      couponDiscount = Math.min(Math.round(subtotal * state.coupon.percent / 100), state.coupon.maximum);
    }
    if (state.coupon && state.coupon.fixed && subtotal >= (state.coupon.minimum || 0)) couponDiscount = Math.min(Number(state.coupon.fixed), subtotal);
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
          '<img data-food-id="' + escapeHTML(item.id) + '" src="' + escapeHTML(state.imageFallbacks[item.id] || item.image) + '" alt="" loading="lazy">' +
          '<div class="cart-line-info"><strong>' + escapeHTML(item.name) + '</strong><small>' + money(item.price) + ' each</small>' +
            (item.customization && (item.customization.size || (item.customization.extras || []).length || (item.customization.preferences || []).length || item.customization.note) ? '<small class="cart-line-customization">' + escapeHTML([item.customization.size || "Regular", ...(item.customization.extras || []).map(extra => extra.name), ...(item.customization.preferences || []), item.customization.note].filter(Boolean).join(" · ")) + '</small>' : '') +
            '<div class="quantity-control"><button type="button" data-quantity="' + item.id + '" data-change="-1" aria-label="Remove one">−</button><span>' + item.quantity + '</span><button type="button" data-quantity="' + item.id + '" data-change="1" aria-label="Add one">+</button></div>' +
          '</div><strong class="cart-line-total">' + money(item.price * item.quantity) + '</strong>' +
        '</article>'
      )).join("");
      $("[data-quantity]", container).forEach(button => {
        button.addEventListener("click", () => changeQuantity(button.dataset.quantity, Number(button.dataset.change)));
      });
      $(".cart-line img[data-food-id]",container).forEach(image=>{
        const dish=state.menu.find(product=>product.id===image.dataset.foodId);
        if(dish)protectFoodPhoto(image,dish);
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
      FOOD25: { code: "FOOD25", percent: 25, maximum: 100, minimum: 299 },
      COMBO10: { code: "COMBO10", percent: 10, maximum: 150, minimum: 199 },
      REWARD25: { code: "REWARD25", fixed: 25, percent: 0, maximum: 25, minimum: 249 }
    };
    if (!coupons[code]) {
      state.pendingRewardRedemption = false;
      state.coupon = null;
      $("#couponMessage").textContent = "That code doesn't look right. Try HUB50 or FOOD25.";
      $("#couponMessage").className = "coupon-message message-warning";
    } else if (calculateBill().subtotal < coupons[code].minimum) {
      state.pendingRewardRedemption = code === "REWARD25";
      state.coupon = coupons[code];
      $("#couponMessage").textContent = "Add " + money(coupons[code].minimum - calculateBill().subtotal) + " more to unlock " + code + ".";
      $("#couponMessage").className = "coupon-message message-warning";
    } else {
      state.pendingRewardRedemption = code === "REWARD25";
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
    const checkoutForm = $("#checkoutForm");
    ["name", "phone", "email", "address"].forEach(field => {
      checkoutForm.elements.namedItem(field).value = state.profile[field] || "";
    });
    $("#saveCheckoutProfile").checked = true;
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
      items: getCartLines().map(item => ({ productId: item.id, quantity: item.quantity, customizations: item.customization || {} })),
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
      const appliedCouponCode = state.coupon ? state.coupon.code : "";
      if (appliedCouponCode === "REWARD25" && state.pendingRewardRedemption) state.rewards.points = Math.max(0, Number(state.rewards.points || 0) - 50);
      const pointsEarned = Math.max(0, Math.floor(Number(order.total || calculateBill().total) / 10));
      state.rewards.points = Number(state.rewards.points || 0) + pointsEarned;
      state.rewards.lifetime = Number(state.rewards.lifetime || 0) + pointsEarned;
      saveStore(STORAGE.rewards, state.rewards);
      state.pendingRewardRedemption = false;
      renderRewards();
      if ($("#saveCheckoutProfile").checked) {
        state.profile = customer;
        saveStore(STORAGE.profile, state.profile);
        renderProfile();
      }
      state.cart = {};
      state.coupon = null;
      saveStore(STORAGE.cart, state.cart);
      renderCart();
      closeDialog("checkoutDialog");
      $("#successOrderNumber").textContent = order.orderNumber;
      $("#successMessage").textContent = (state.backendOnline
        ? "Your order has been saved. Keep this number handy for updates."
        : "This demo order is saved in this browser only. Connect the backend to save orders centrally.") + (pointsEarned ? " You earned " + pointsEarned + " Foodie Points!" : "");
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
      const rawStatus = String(order.status || "confirmed").toLowerCase();
      const stages = [
        { key: "confirmed", label: "Order placed", detail: "We've received your order." },
        { key: "preparing", label: "Preparing", detail: "The kitchen is working on it." },
        { key: "out_for_delivery", label: "On the way", detail: "Your order is heading your way." },
        { key: "delivered", label: "Delivered", detail: "Enjoy every bite!" }
      ];
      const currentStage = rawStatus === "demo_saved" ? 0 : stages.findIndex(stage => stage.key === rawStatus);
      const isCancelled = rawStatus === "cancelled";
      const stageMarkup = stages.map((stage, index) => {
        const complete = !isCancelled && currentStage >= index;
        const active = !isCancelled && currentStage === index;
        return '<li class="tracking-step ' + (complete ? "is-complete " : "") + (active ? "is-current" : "") + '"><span class="tracking-step-mark">' + (complete ? "✓" : String(index + 1)) + '</span><span><strong>' + stage.label + '</strong><small>' + stage.detail + '</small></span></li>';
      }).join("");
      const statusLabel = isCancelled ? "Order cancelled" : (rawStatus === "demo_saved" ? "Demo order received" : (stages[Math.max(0, currentStage)] || stages[0]).label);
      result.innerHTML = '<span class="tracking-status-dot' + (isCancelled ? ' is-cancelled' : '') + '"></span><span class="drawer-kicker">ORDER ' + escapeHTML(order.orderNumber) + '</span><h3>' + escapeHTML(statusLabel) + '</h3><p>' + escapeHTML(order.message || "Your order details are up to date.") + '</p>' + (isCancelled ? '<p class="tracking-cancelled">This order was cancelled. Please contact the team if you need help.</p>' : '<ol class="tracking-steps">' + stageMarkup + '</ol>') + '<div class="tracking-total"><span>Order total</span><strong>' + money(order.total) + '</strong></div>';
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


  const SMART_COMBOS = [
    { id:"house",title:"The House Favourite",subtitle:"A classic burger-night trio",ids:["truffle-mushroom-burger","classic-masala-fries","mint-lime-cooler"],tag:"BEST LOVED" },
    { id:"fire",title:"The Fire & Crunch",subtitle:"A spicy, crispy little lineup",ids:["peri-peri-paneer-burger","loaded-peri-peri-fries","mango-milkshake"],tag:"SPICE PICK" },
    { id:"slow",title:"The Slow Evening",subtitle:"Comfort food with a sweet finish",ids:["creamy-pink-sauce-pasta","dark-chocolate-lava-cake","iced-mocha"],tag:"COMFORT SET" }
  ];
  function findMenuItem(id){return state.menu.find(item=>item.id===id);}
  function mealOptions(categories,veg){return state.menu.filter(item=>categories.includes(item.category)&&(!veg||item.isVeg));}
  function fillMealSelect(id,categories,veg){
    const select=$("#"+id),previous=select.value,items=mealOptions(categories,veg);
    select.innerHTML=items.map(item=>'<option value="'+escapeHTML(item.id)+'">'+escapeHTML(item.name)+' · '+money(item.price)+'</option>').join("");
    if(items.some(item=>item.id===previous))select.value=previous;
  }
  function populateMealBuilder(){
    const veg=$("#mealVegOnly").checked;
    fillMealSelect("mealMain",["Burgers","Pizza","Pasta","Bowls","Indian"],veg);
    fillMealSelect("mealSide",["Sides"],veg);
    fillMealSelect("mealDrink",["Drinks"],veg);
    updateMealSummary();
  }
  function getMealSelection(){return ["mealMain","mealSide","mealDrink"].map(id=>findMenuItem($("#"+id).value)).filter(Boolean);}
  function updateMealSummary(){
    const picks=getMealSelection(),total=picks.reduce((sum,item)=>sum+Number(item.price||0),0),complete=picks.length===3;
    $("#mealSummaryCount").textContent=picks.length+" / 3 picks";
    $("#mealBuilderTotal").textContent=money(total);
    $("#addMealBundle").disabled=!complete;
    $("#mealBuilderSaving").textContent=!complete?"Choose a main, side and drink to see your total.":total>=199?"COMBO10 can save "+money(Math.min(Math.round(total*.1),150))+" on this eligible combo.":"Add a little more to reach the ₹199 COMBO10 minimum.";
  }
  function addMealBundle(){
    const picks=getMealSelection();if(picks.length!==3)return;
    picks.forEach(item=>{state.cart[item.id]=Math.min(20,(state.cart[item.id]||0)+1);});
    if(calculateBill().subtotal>=199){
      state.coupon={code:"COMBO10",percent:10,maximum:150,minimum:199};state.pendingRewardRedemption=false;
      $("#couponInput").value="COMBO10";$("#couponMessage").textContent="COMBO10 added for 10% off eligible orders.";$("#couponMessage").className="coupon-message message-success";
    }
    saveStore(STORAGE.cart,state.cart);renderCart();showToast("Your custom meal has been added to the bag.");
  }
  function renderSmartCombos(){
    const container=$("#comboGrid");if(!container||!state.menu.length)return;
    container.innerHTML=SMART_COMBOS.map(combo=>{
      const items=combo.ids.map(findMenuItem).filter(Boolean);if(items.length!==3)return "";
      const subtotal=items.reduce((sum,item)=>sum+item.price,0),saving=Math.min(Math.round(subtotal*.1),150),hero=items[0];
      return '<article class="combo-card"><div class="combo-image"><img src="'+escapeHTML(hero.image)+'" alt="'+escapeHTML(hero.name)+'" loading="lazy"><span>'+escapeHTML(combo.tag)+'</span><strong>'+money(subtotal)+'</strong></div><div class="combo-card-body"><h3>'+escapeHTML(combo.title)+'</h3><p>'+escapeHTML(combo.subtitle)+'</p><ul>'+items.map(item=>'<li><span>'+escapeHTML(item.name)+'</span><strong>'+money(item.price)+'</strong></li>').join("")+'</ul><div class="combo-card-footer"><span>Save up to '+money(saving)+' with COMBO10</span><button type="button" class="button button-outline" data-combo="'+combo.id+'">Add combo <span aria-hidden="true">＋</span></button></div></div></article>';
    }).join("");
    $$("#comboGrid img").forEach(img=>{const item=state.menu.find(entry=>entry.name===img.alt);if(item)protectFoodPhoto(img,item);});
  }
  function addSmartCombo(comboId){
    const combo=SMART_COMBOS.find(entry=>entry.id===comboId);if(!combo)return;
    const items=combo.ids.map(findMenuItem).filter(Boolean);if(items.length!==3)return;
    items.forEach(item=>{state.cart[item.id]=Math.min(20,(state.cart[item.id]||0)+1);});
    state.coupon={code:"COMBO10",percent:10,maximum:150,minimum:199};state.pendingRewardRedemption=false;
    $("#couponInput").value="COMBO10";$("#couponMessage").textContent="COMBO10 added. Your eligible bag gets 10% off.";"";
    $("#couponMessage").className="coupon-message message-success";saveStore(STORAGE.cart,state.cart);renderCart();showToast(combo.title+" added. COMBO10 is ready in your bag.");
  }
  function getRecommendedItems(mood){
    let items=[...state.menu];
    if(mood==="budget")items=items.filter(item=>item.price<=200).sort((a,b)=>a.price-b.price);
    else if(mood==="quick")items=items.filter(item=>Number(item.prepTime)<=12).sort((a,b)=>a.prepTime-b.prepTime);
    else if(mood==="veg")items=items.filter(item=>item.isVeg).sort((a,b)=>Number(b.featured)-Number(a.featured));
    else if(mood==="sweet")items=items.filter(item=>item.category==="Desserts");
    else items=items.filter(item=>item.featured).sort((a,b)=>Number(b.featured)-Number(a.featured));
    return items.slice(0,3);
  }
  function renderRecommendations(){
    const container=$("#recommendationGrid");if(!container||!state.menu.length)return;
    const items=getRecommendedItems($("#recommendationMood").value||"popular");
    if(!items.length){container.innerHTML='<p class="recommendation-empty">No matches in that mood yet. Try another pick.</p>';return;}
    container.innerHTML=items.map(item=>'<article class="recommendation-card"><img src="'+escapeHTML(item.image)+'" alt="'+escapeHTML(item.name)+'" loading="lazy"><div class="recommendation-card-copy"><span>'+escapeHTML(item.category)+' · '+escapeHTML(String(item.prepTime||"—"))+' min</span><h3>'+escapeHTML(item.name)+'</h3><p>'+escapeHTML(item.description)+'</p><div><strong>'+money(item.price)+'</strong><button type="button" class="button button-outline" data-recommend-add="'+escapeHTML(item.id)+'">Add <span aria-hidden="true">＋</span></button></div></div></article>').join("");
    $$("#recommendationGrid img").forEach(img=>{const item=state.menu.find(entry=>entry.name===img.alt);if(item)protectFoodPhoto(img,item);});
  }
  function renderRewards(){
    const points=Math.max(0,Number(state.rewards.points||0)),lifetime=Math.max(0,Number(state.rewards.lifetime||0)),progress=points%50;
    $("#rewardPoints").textContent=points.toLocaleString("en-IN");$("#rewardLifetime").textContent=lifetime.toLocaleString("en-IN")+" lifetime points";
    $("#rewardProgressFill").style.width=(progress/50*100)+"%";$("#rewardProgressText").textContent=progress+" / 50 points to your next reward";
    $("#redeemRewards").disabled=points<50;
    $("#rewardMessage").textContent=points>=50?"You have a reward ready. Orders above ₹249 can use it.":"Earn 1 point for every ₹10 spent. Points stay in this browser in this demo.";
  }
  function redeemRewards(){
    const points=Math.max(0,Number(state.rewards.points||0));
    if(points<50){showToast("You need 50 Foodie Points to redeem this reward.","error");return;}
    if(calculateBill().subtotal<249){showToast("Add at least ₹249 to your bag before redeeming.","error");return;}
    state.coupon={code:"REWARD25",fixed:25,percent:0,maximum:25,minimum:249};state.pendingRewardRedemption=true;
    $("#couponInput").value="REWARD25";$("#couponMessage").textContent="50 points will be redeemed for ₹25 off when you place this order.";
    $("#couponMessage").className="coupon-message message-success";renderCart();showToast("Reward unlocked. Complete checkout to use it!");
  }
  function normalizeAdminStatus(status){return status==="demo_saved"?"confirmed":(status||"confirmed");}
  function renderAdminDashboard(){
    const orders=state.adminOrders||[],revenue=orders.reduce((sum,order)=>sum+Number(order.total||0),0);
    $("#adminOrderCount").textContent=orders.length.toLocaleString("en-IN");$("#adminRevenue").textContent=money(revenue);
    $("#adminAverage").textContent=orders.length?money(revenue/orders.length):money(0);
    $("#adminSourceLabel").textContent=state.adminSource==="live"?"LIVE BACKEND":"LOCAL DEMO";
    if(!orders.length){$("#adminOrdersBody").innerHTML='<tr><td colspan="5">No orders yet.</td></tr>';return;}
    $("#adminOrdersBody").innerHTML=orders.map(order=>{
      const number=order.order_number||order.orderNumber||"FH-UNKNOWN",name=order.customer_name||(order.customer&&order.customer.name)||"Demo customer",status=normalizeAdminStatus(order.status);
      const choices=["confirmed","preparing","out_for_delivery","delivered","cancelled"],itemCount=Array.isArray(order.items)?order.items.reduce((sum,item)=>sum+Number(item.quantity||1),0):0;
      return '<tr data-admin-row="'+escapeHTML(number)+'"><td><strong>'+escapeHTML(number)+'</strong><small>'+itemCount+' items</small></td><td>'+escapeHTML(name)+'</td><td>'+money(order.total)+'</td><td><select data-admin-status aria-label="Status for '+escapeHTML(number)+'">'+choices.map(choice=>'<option value="'+choice+'"'+(choice===status?" selected":"")+'>'+choice.replace(/_/g," ")+'</option>').join("")+'</select></td><td><button type="button" class="button button-outline admin-update-button" data-admin-update="'+escapeHTML(number)+'">Save</button></td></tr>';
    }).join("");
  }
  async function connectAdmin(event){
    event.preventDefault();const key=$("#adminKey").value.trim();$("#adminError").textContent="";
    if(state.backendOnline){
      if(!key){$("#adminError").textContent="Enter the server admin key to continue.";return;}
      try{
        const result=await request("/api/admin/orders",{headers:{Authorization:"Bearer "+key}});
        state.adminKey=key;state.adminSource="live";state.adminOrders=Array.isArray(result.orders)?result.orders:[];
        $("#adminConnection").textContent="Connected to the hosted FoodieHub API. Changes update the shared orders database.";renderAdminDashboard();
      }catch(error){state.adminKey="";$("#adminError").textContent=error.message||"Admin connection failed.";}
      return;
    }
    state.adminKey="";state.adminSource="demo";
    state.adminOrders=state.orders.map(order=>({...order,customer_name:(order.customer&&order.customer.name)||"This browser",order_number:order.orderNumber,total:order.total}));
    $("#adminConnection").textContent="Backend is not connected on this GitHub Pages site. Showing local demo orders from this browser only. Configure FOODIEHUB_API_URL and ADMIN_API_KEY for live management.";
    renderAdminDashboard();
  }
  async function updateAdminOrder(button){
    const row=button.closest("[data-admin-row]");if(!row)return;
    const number=row.dataset.adminRow,status=$("[data-admin-status]",row).value;button.disabled=true;
    try{
      if(state.adminSource==="live"){
        await request("/api/admin/orders/"+encodeURIComponent(number),{method:"PATCH",headers:{Authorization:"Bearer "+state.adminKey},body:JSON.stringify({status})});
        const found=state.adminOrders.find(order=>(order.order_number||order.orderNumber)===number);if(found)found.status=status;
        $("#adminConnection").textContent="Order "+number+" updated in the live database.";
      }else{
        const found=state.orders.find(order=>order.orderNumber===number);if(found)found.status=status;
        saveStore(STORAGE.orders,state.orders);state.adminOrders=state.orders.map(order=>({...order,customer_name:(order.customer&&order.customer.name)||"This browser",order_number:order.orderNumber,total:order.total}));
        $("#adminConnection").textContent="Demo status saved on this browser only. It is not a live delivery update.";
      }
      renderAdminDashboard();showToast("Order status updated.");
    }catch(error){$("#adminError").textContent=error.message||"The order status could not be updated.";}
    finally{button.disabled=false;}
  }
  function bindFeatureEvents(){
    ["mealMain","mealSide","mealDrink"].forEach(id=>$("#"+id).addEventListener("change",updateMealSummary));
    $("#mealVegOnly").addEventListener("change",populateMealBuilder);$("#addMealBundle").addEventListener("click",addMealBundle);
    $("#comboGrid").addEventListener("click",event=>{const button=event.target.closest("[data-combo]");if(button)addSmartCombo(button.dataset.combo);});
    $("#recommendationMood").addEventListener("change",renderRecommendations);
    $("#recommendationGrid").addEventListener("click",event=>{const button=event.target.closest("[data-recommend-add]");if(button)addToCart(button.dataset.recommendAdd,button);});
    $("#redeemRewards").addEventListener("click",redeemRewards);
    $("#openAdmin").addEventListener("click",()=>{$("#adminError").textContent="";openDialog("adminDialog");});
    $("#adminLoginForm").addEventListener("submit",connectAdmin);
    $("#adminOrdersBody").addEventListener("click",event=>{const button=event.target.closest("[data-admin-update]");if(button)updateAdminOrder(button);});
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    saveStore(STORAGE.theme, theme);
    $("#themeToggle").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    $("#themeToggle").setAttribute("title", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    $("#themeToggle span").textContent = theme === "dark" ? "☀" : "☾";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#111914" : "#f3f5ef");
  }

  function bindEvents() {
    $("#openCart").addEventListener("click", openCart);
    $("#openProfile").addEventListener("click", openProfile);
    $("#profileForm").addEventListener("submit", saveProfile);
    $("#closeCart").addEventListener("click", closeCart);
    $("#cartBackdrop").addEventListener("click", closeCart);
    $("#checkoutButton").addEventListener("click", openCheckout);
    $("#applyCoupon").addEventListener("click", applyCoupon);
    $("#couponInput").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); applyCoupon(); } });
    $("#checkoutForm").addEventListener("submit", placeOrder);
    $("#trackingForm").addEventListener("submit", trackOrder);
    $("#trackOrderLink").addEventListener("click", openTracking);
    bindFeatureEvents();
    $("#successDone").addEventListener("click", () => closeDialog("successDialog"));
    $("#newsletterForm").addEventListener("submit", subscribe);
    $("#themeToggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    $("#dishCustomizerForm").addEventListener("submit", addCustomizedDish);
    $("#dishCustomizerForm").addEventListener("change", updateCustomizerTotal);
    $("#customizerQtyMinus").addEventListener("click", () => { state.customizerQuantity = Math.max(1, state.customizerQuantity - 1); updateCustomizerTotal(); });
    $("#customizerQtyPlus").addEventListener("click", () => { state.customizerQuantity = Math.min(20, state.customizerQuantity + 1); updateCustomizerTotal(); });
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
    const savedTheme = readStore(STORAGE.theme, null);
    const systemTheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(savedTheme || systemTheme);
    $("#currentYear").textContent = new Date().getFullYear();
    bindEvents();
    renderProfile();
    renderCart();
    const heroImage=$(".hero-image-frame img");
    if(heroImage)protectFoodPhoto(heroImage,{name:"FoodieHub chef's table",category:"Featured"});
    const storyImage=$(".story-image img");
    if(storyImage)protectFoodPhoto(storyImage,{name:"Fresh from the kitchen",category:"Indian"});
    try {
      await Promise.all([checkBackend()]);
      state.menu = await loadMenu();
      renderCart();
      renderCategories();
      renderMenu();
      populateMealBuilder();
      renderSmartCombos();
      renderRecommendations();
      renderRewards();
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