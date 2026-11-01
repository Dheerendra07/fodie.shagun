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
    orders: "foodiehub.orders.v2",
    profile: "foodiehub.profile.v1"
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
      image.src = state.imageFallbacks[item.id] || item.image;
      image.alt = item.name + " — " + item.description;
      image.addEventListener("error", () => {
        if (!state.imageFallbacks[item.id]) state.imageFallbacks[item.id] = makeFoodSvg(item);
        image.src = state.imageFallbacks[item.id];
      }, { once: true });
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


  function makeFoodSvg(item) {
    const category = String(item.category || "").toLowerCase();
    const palettes = {
      burgers: ["#f4c98d", "#c66b39", "#54372d", "#6f9b62"],
      pizza: ["#f5cc8f", "#c65d3f", "#f2a64e", "#6c8b54"],
      pasta: ["#ead0a2", "#b65b3f", "#e2a653", "#63845b"],
      bowls: ["#e8d3ad", "#5e8462", "#d28a45", "#f0bd73"],
      indian: ["#f0c98c", "#b84f32", "#dd9c42", "#6f8152"],
      sides: ["#f1cc8c", "#bd703e", "#e0a74e", "#6d8b5d"],
      desserts: ["#f2d4bc", "#9c4e47", "#d99466", "#f3c36f"],
      drinks: ["#e6d3ab", "#638d78", "#d2a15a", "#b8d9ca"]
    };
    const palette = palettes[category] || palettes.bowls;
    let food = "";
    if (category === "burgers") {
      food = '<path d="M180 207 C190 126 449 126 460 207Z" fill="#d9954d"/><path d="M180 207 Q320 184 460 207 L452 222 Q320 239 188 222Z" fill="#f6d08e"/><path d="M188 228 Q320 247 452 228 L442 245 Q320 261 198 245Z" fill="#5f884e"/><path d="M194 248 Q320 273 446 248 L437 264 Q320 287 203 264Z" fill="#a84430"/><path d="M198 267 Q320 286 442 267 L433 282 Q320 302 207 282Z" fill="#e7ac50"/><path d="M208 288 Q320 307 432 288 Q426 339 320 344 Q214 339 208 288Z" fill="#d88d43"/><g fill="#f7e5b8"><ellipse cx="250" cy="178" rx="4" ry="2"/><ellipse cx="309" cy="164" rx="4" ry="2"/><ellipse cx="374" cy="178" rx="4" ry="2"/></g>';
    } else if (category === "pizza") {
      food = '<circle cx="320" cy="236" r="135" fill="#bf6d3e"/><circle cx="320" cy="236" r="119" fill="#f1c575"/><circle cx="320" cy="236" r="103" fill="#d75e3e"/><path d="M320 133 L320 339 M217 236 H423 M248 164 L392 308 M392 164 L248 308" stroke="#f7dda5" stroke-width="5" opacity=".9"/><g fill="#9d4735" stroke="#f5d69d" stroke-width="4"><circle cx="284" cy="188" r="13"/><circle cx="358" cy="193" r="13"/><circle cx="266" cy="267" r="13"/><circle cx="347" cy="267" r="13"/><circle cx="319" cy="226" r="13"/></g><g fill="#5e8a54"><ellipse cx="309" cy="171" rx="8" ry="4" transform="rotate(-35 309 171)"/><ellipse cx="379" cy="248" rx="8" ry="4" transform="rotate(25 379 248)"/><ellipse cx="291" cy="302" rx="8" ry="4" transform="rotate(35 291 302)"/></g>';
    } else if (category === "pasta") {
      food = '<path d="M152 230 Q320 402 488 230 Q454 385 320 390 Q186 385 152 230Z" fill="#f2e4c9"/><ellipse cx="320" cy="231" rx="169" ry="102" fill="#fff5df"/><ellipse cx="320" cy="230" rx="139" ry="79" fill="#d9784b"/><g fill="none" stroke="#efc27e" stroke-width="12" stroke-linecap="round"><path d="M223 226 C260 143 390 155 380 230 C368 292 254 288 249 218 C248 173 332 158 356 211"/><path d="M238 251 C276 321 402 273 392 205 C384 157 280 151 275 210 C270 255 350 273 365 222"/><path d="M260 195 C297 143 371 176 355 226 C338 281 271 260 286 208"/></g><g fill="#6c8d54"><ellipse cx="288" cy="194" rx="11" ry="5" transform="rotate(-40 288 194)"/><ellipse cx="362" cy="247" rx="11" ry="5" transform="rotate(32 362 247)"/><ellipse cx="326" cy="179" rx="10" ry="5"/></g>';
    } else if (category === "desserts") {
      food = '<path d="M191 302 L403 302 L442 346 L221 346Z" fill="#bf8a62"/><path d="M202 291 L408 291 L408 306 L202 306Z" fill="#f4d6ae"/><path d="M202 190 Q300 165 408 190 L408 292 L202 292Z" fill="#e9b98e"/><path d="M202 190 Q300 168 408 190 L408 222 Q302 202 202 222Z" fill="#fff0d8"/><path d="M202 241 Q301 220 408 241 L408 259 Q302 240 202 259Z" fill="#9d514a"/><path d="M202 273 Q301 256 408 273 L408 292 L202 292Z" fill="#fff0d8"/><path d="M286 183 C260 149 299 136 315 165 C336 133 375 153 347 182Z" fill="#bd5144"/><path d="M317 165 Q332 136 353 143" fill="none" stroke="#62865a" stroke-width="7" stroke-linecap="round"/>';
    } else if (category === "drinks") {
      food = '<path d="M235 145 L405 145 L383 352 Q320 383 257 352Z" fill="#e8f1df" opacity=".83" stroke="#fff" stroke-width="7"/><path d="M249 204 L391 204 L377 340 Q320 365 263 340Z" fill="#d18a4b"/><path d="M269 247 Q319 219 376 249" fill="none" stroke="#f8dca6" stroke-width="11" stroke-linecap="round"/><path d="M352 143 L401 70" stroke="#f6f0df" stroke-width="13" stroke-linecap="round"/><g fill="#fff7dc" opacity=".75"><circle cx="297" cy="281" r="11"/><circle cx="345" cy="310" r="8"/><circle cx="321" cy="241" r="7"/></g><path d="M265 207 Q320 218 389 207" fill="none" stroke="#fff" stroke-width="5"/>';
    } else if (category === "sides") {
      food = '<path d="M205 190 L435 190 L408 358 Q320 383 232 358Z" fill="#c85b3d"/><path d="M205 190 L435 190 L428 221 L212 221Z" fill="#f2b75e"/><g stroke="#f5d08c" stroke-width="27" stroke-linecap="round"><path d="M250 211 L230 119"/><path d="M293 210 L285 102"/><path d="M335 210 L345 103"/><path d="M376 212 L396 125"/></g><g stroke="#fff0c9" stroke-width="4" opacity=".8"><path d="M231 158 L250 151"/><path d="M283 149 L298 148"/><path d="M341 150 L354 153"/></g>';
    } else {
      food = '<path d="M165 230 Q320 405 475 230 Q451 371 320 382 Q189 371 165 230Z" fill="#d7d0bd"/><ellipse cx="320" cy="229" rx="157" ry="94" fill="#f9f1df"/><ellipse cx="320" cy="227" rx="128" ry="70" fill="' + (category === "indian" ? "#bd603d" : "#d2a45e") + '"/><g fill="#f4e5bb"><ellipse cx="266" cy="208" rx="14" ry="5" transform="rotate(18 266 208)"/><ellipse cx="321" cy="190" rx="16" ry="5" transform="rotate(-15 321 190)"/><ellipse cx="365" cy="225" rx="15" ry="5" transform="rotate(20 365 225)"/><ellipse cx="290" cy="251" rx="15" ry="5" transform="rotate(-12 290 251)"/></g><g fill="#65885b"><circle cx="291" cy="190" r="8"/><circle cx="351" cy="255" r="9"/><circle cx="380" cy="200" r="6"/></g>';
    }
    const title = String(item.name || "FoodieHub special").replace(/[<>&]/g, "");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" role="img" aria-label="' + title + ' illustration"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + palette[0] + '"/><stop offset="1" stop-color="' + palette[3] + '"/></linearGradient><radialGradient id="glow"><stop stop-color="#fff" stop-opacity=".65"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="13"/></filter></defs><rect width="640" height="480" rx="34" fill="url(#bg)"/><circle cx="510" cy="82" r="150" fill="url(#glow)" opacity=".8"/><circle cx="100" cy="405" r="120" fill="#fff" opacity=".12"/><circle cx="320" cy="247" r="177" fill="#fff" opacity=".12"/><ellipse cx="320" cy="364" rx="170" ry="23" fill="#403329" opacity=".18" filter="url(#shadow)"/><ellipse cx="320" cy="345" rx="176" ry="43" fill="#fff" opacity=".42"/><ellipse cx="320" cy="336" rx="158" ry="35" fill="#fff" opacity=".72"/>' + food + '<g fill="' + palette[2] + '" opacity=".7"><circle cx="108" cy="112" r="7"/><circle cx="524" cy="336" r="9"/><circle cx="484" cy="135" r="5"/></g><g fill="#fff" opacity=".75"><path d="M130 270 l7 17 17 7 -17 7 -7 17 -7 -17 -17 -7 17 -7Z"/><path d="M504 220 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5Z"/></g><text x="320" y="433" text-anchor="middle" fill="#fff" fill-opacity=".9" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="4">FOODIEHUB  •  ' + String(item.category || "SPECIAL").toUpperCase() + '</text></svg>';
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
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
    $("#customizerImage").src = state.imageFallbacks[id] || item.image;
    $("#customizerImage").alt = item.name + " — " + item.description;
    $("#customizerImage").onerror = () => { $("#customizerImage").src = makeFoodSvg(item); };
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
    const extras = $('input[name="dishAddon"]:checked').reduce((sum,input) => sum + Number(input.dataset.price || 0), 0);
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
    const extras = $('input[name="dishAddon"]:checked').map(input => ({ name: input.value, price: Number(input.dataset.price || 0) }));
    const preferences = $('input[name="dishPreference"]:checked').map(input => input.value);
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
    const card = $('#menuGrid [data-name]') ? $('#menuGrid .dish-card').find(element => $('[data-name]',element)?.textContent === item.name) : null;
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
      $(".cart-line img[data-food-id]", container).forEach(image => image.addEventListener("error", () => {
        const dish = state.menu.find(product => product.id === image.dataset.foodId);
        if (dish) {
          state.imageFallbacks[dish.id] = makeFoodSvg(dish);
          image.src = state.imageFallbacks[dish.id];
        }
      }, { once: true }));
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
    $("#themeToggle").setAttribute("title", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    $("#themeToggle span").textContent = theme === "dark" ? "☀" : "☾";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#171d19" : "#f8f4ec");
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
    const heroImage = $(".hero-image-frame img");
    if (heroImage) heroImage.addEventListener("error", () => { heroImage.src = makeFoodSvg({ name: "FoodieHub chef's table", category: "Bowls" }); }, { once: true });
    const storyImage = $(".story-image img");
    if (storyImage) storyImage.addEventListener("error", () => { storyImage.src = makeFoodSvg({ name: "Fresh from the kitchen", category: "Indian" }); }, { once: true });
    try {
      await Promise.all([checkBackend()]);
      state.menu = await loadMenu();
      renderCart();
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