"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimitPackage = require("express-rate-limit");
const rateLimit = rateLimitPackage.rateLimit || rateLimitPackage;
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "foodiehub.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec([
  "CREATE TABLE IF NOT EXISTS orders (",
  "order_number TEXT PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, address TEXT NOT NULL,",
  "items_json TEXT NOT NULL, subtotal REAL NOT NULL, coupon_code TEXT, coupon_discount REAL NOT NULL, delivery_fee REAL NOT NULL,",
  "tax REAL NOT NULL, total REAL NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL",
  ");",
  "CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);"
].join(" "));
const existingOrderColumns = new Set(db.pragma("table_info(orders)").map(column => column.name));
if (!existingOrderColumns.has("gateway_order_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN gateway_order_id TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_gateway_order_id ON orders(gateway_order_id) WHERE gateway_order_id IS NOT NULL");

const MENU_PATH = path.join(ROOT, "data", "menu.json");
const menu = JSON.parse(fs.readFileSync(MENU_PATH, "utf8"));
const productById = new Map(menu.map(item => [item.id, item]));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://checkout.razorpay.com"],
      frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      connectSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("This website origin is not allowed by the API."));
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 160,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a little while." }
}));

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}
function calculateCoupon(code, subtotal) {
  const normalized = String(code || "").trim().toUpperCase();
  const offers = {
    HUB50: { percent: 50, max: 200, minimum: 699 },
    FOOD25: { percent: 25, max: 100, minimum: 299 },
    COMBO10: { percent: 10, max: 150, minimum: 199 },
    REWARD25: { fixed: 25, minimum: 249 }
  };
  const offer = offers[normalized];
  if (!offer) return { code: "", discount: 0 };
  if (subtotal < offer.minimum) {
    const error = new Error(normalized + " needs a minimum subtotal of ₹" + offer.minimum + ".");
    error.status = 400;
    throw error;
  }
  const discount = offer.fixed ? Math.min(offer.fixed, subtotal) : Math.min(round(subtotal * offer.percent / 100), offer.max);
  return { code: normalized, discount };
}
function calculateCustomization(product, input) {
  const data = input && typeof input === "object" ? input : {};
  const category = String(product.category || "").toLowerCase();
  const largePrice = category === "drinks" ? 30 : category === "desserts" ? 35 : category === "sides" ? 29 : 49;
  const largeName = category === "desserts" ? "Double treat" : "Large";
  const sizeOptions = { Regular: 0, [largeName]: largePrice };
  const requestedSize = String(data.size || "Regular");
  if (!Object.prototype.hasOwnProperty.call(sizeOptions, requestedSize)) {
    const error = new Error("One of the selected serving sizes is not available.");
    error.status = 400;
    throw error;
  }

  let allowedExtras;
  if (["burgers", "pizza", "sides"].includes(category)) {
    allowedExtras = [
      { name: "Extra cheese", price: 29 },
      { name: product.isVeg ? "Extra paneer patty" : "Extra chicken patty", price: product.isVeg ? 49 : 69 },
      { name: "Fries combo", price: 69 },
      { name: "Signature dip", price: 20 }
    ];
  } else if (["pasta", "bowls", "indian"].includes(category)) {
    allowedExtras = [
      { name: "Extra cheese", price: 29 },
      { name: product.isVeg ? "Extra paneer" : "Extra chicken", price: product.isVeg ? 49 : 59 },
      { name: "Extra sauce / gravy", price: 25 },
      { name: "Garlic bread", price: 49 }
    ];
  } else if (category === "desserts") {
    allowedExtras = [{ name: "Ice cream scoop", price: 39 }, { name: "Whipped cream", price: 19 }, { name: "Chocolate drizzle", price: 20 }];
  } else if (category === "drinks") {
    allowedExtras = [{ name: "Extra espresso shot", price: 35 }, { name: "Whipped cream", price: 19 }, { name: "Vanilla scoop", price: 29 }];
  } else {
    allowedExtras = [{ name: "Signature dip", price: 20 }, { name: "Extra cheese", price: 25 }, { name: "Make it loaded", price: 35 }];
  }

  const requestedExtras = Array.isArray(data.extras) ? data.extras : [];
  if (requestedExtras.length > 8) {
    const error = new Error("Too many add-ons were selected.");
    error.status = 400;
    throw error;
  }
  const extras = requestedExtras.map(extra => {
    const allowed = allowedExtras.find(option => option.name === String(extra && extra.name || ""));
    if (!allowed) {
      const error = new Error("One of the selected add-ons is not available for this dish.");
      error.status = 400;
      throw error;
    }
    return { name: allowed.name, price: allowed.price };
  });
  const preferences = Array.isArray(data.preferences) ? data.preferences.map(String).slice(0, 8) : [];
  const note = String(data.note || "").trim().slice(0, 180);
  const sizeExtra = sizeOptions[requestedSize];
  return {
    size: requestedSize,
    sizeExtra,
    extras,
    preferences,
    note,
    unitPrice: round(product.price + sizeExtra + extras.reduce((sum, extra) => sum + extra.price, 0))
  };
}

function calculateOrder(items, couponCode) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    const error = new Error("Add at least one menu item before placing an order.");
    error.status = 400;
    throw error;
  }
  let subtotal = 0;
  const verifiedItems = [];
  for (const requested of items) {
    const productId = String(requested.productId || "");
    const quantity = Number(requested.quantity);
    const product = productById.get(productId);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      const error = new Error("One of the selected items is unavailable or has an invalid quantity.");
      error.status = 400;
      throw error;
    }
    const customizations = calculateCustomization(product, requested.customizations);
    subtotal += customizations.unitPrice * quantity;
    verifiedItems.push({
      productId: product.id,
      name: product.name,
      price: customizations.unitPrice,
      basePrice: product.price,
      quantity,
      lineTotal: round(customizations.unitPrice * quantity),
      customizations: {
        size: customizations.size,
        extras: customizations.extras,
        preferences: customizations.preferences,
        note: customizations.note
      }
    });
  }
  subtotal = round(subtotal);
  const coupon = calculateCoupon(couponCode, subtotal);
  const deliveryFee = subtotal === 0 || subtotal >= 499 ? 0 : 39;
  const tax = round(Math.max(0, subtotal - coupon.discount) * 0.05);
  return {
    items: verifiedItems,
    subtotal,
    couponCode: coupon.code,
    couponDiscount: coupon.discount,
    deliveryFee,
    tax,
    total: round(subtotal - coupon.discount + deliveryFee + tax)
  };
}
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return res.status(503).json({ error: "Admin access is disabled. Set ADMIN_API_KEY on the server." });
  const provided = String(req.get("authorization") || req.get("x-admin-key") || "").replace(/^Bearer\s+/i, "");
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }
  return next();
}
function createOrderNumber() {
  return "FH-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}
function publicOrder(row) {
  return {
    orderNumber: row.order_number,
    status: row.status,
    total: row.total,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    message: "Your order is saved. Keep checking for its latest status."
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "FoodieHub API", menuItems: menu.length, database: "connected", time: new Date().toISOString() });
});

app.get("/api/categories", (req, res) => {
  const categories = [...new Set(menu.map(item => item.category))];
  res.json({ categories });
});

app.get("/api/menu", (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const category = String(req.query.category || "All");
  const diet = String(req.query.diet || "all");
  let items = menu.filter(item => {
    const matchesCategory = category === "All" || item.category === category;
    const matchesDiet = diet === "all" || (diet === "veg" ? item.isVeg : !item.isVeg);
    const searchable = [item.name, item.description, item.category, ...(item.tags || [])].join(" ").toLowerCase();
    return matchesCategory && matchesDiet && (!query || searchable.includes(query));
  });
  res.json({ count: items.length, items });
});


function validateCustomer(customer) {
  const source = customer || {};
  const name = String(source.name || "").trim();
  const phone = cleanPhone(source.phone);
  const email = String(source.email || "").trim().toLowerCase();
  const address = String(source.address || "").trim();
  if (name.length < 2 || name.length > 80) { const error = new Error("Please enter a valid name."); error.status = 400; throw error; }
  if (!/^[6-9]\d{9}$/.test(phone)) { const error = new Error("Please enter a valid 10-digit mobile number."); error.status = 400; throw error; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { const error = new Error("Please enter a valid email address."); error.status = 400; throw error; }
  if (address.length < 12 || address.length > 500) { const error = new Error("Please enter a complete delivery address."); error.status = 400; throw error; }
  return { name, phone, email, address };
}
function razorpayEnabled() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
async function razorpayRequest(endpoint, options = {}) {
  if (!razorpayEnabled()) { const error = new Error("Online payments are not configured on the FoodieHub backend."); error.status = 503; throw error; }
  const authorization = Buffer.from(process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1" + endpoint, {
    method: options.method || "GET",
    headers: { Authorization: "Basic " + authorization, "Content-Type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error && payload.error.description || "The payment provider could not complete the request.");
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return payload;
}

app.get("/api/payments/config", (req, res) => {
  res.json({ enabled: razorpayEnabled(), keyId: razorpayEnabled() ? process.env.RAZORPAY_KEY_ID : "" });
});

app.post("/api/payments/create-order", async (req, res, next) => {
  try {
    if (!razorpayEnabled()) return res.status(503).json({ error: "Online payment is not enabled yet. Choose a delivery payment option." });
    const body = req.body || {};
    const customer = validateCustomer(body.customer);
    const bill = calculateOrder(body.items, body.couponCode);
    const orderNumber = createOrderNumber();
    const createdAt = new Date().toISOString();
    const gatewayOrder = await razorpayRequest("/orders", {
      method: "POST",
      body: { amount: Math.round(bill.total * 100), currency: "INR", receipt: orderNumber, notes: { foodiehub_order_number: orderNumber } }
    });
    if (!gatewayOrder.id || Number(gatewayOrder.amount) !== Math.round(bill.total * 100)) {
      const error = new Error("The payment provider returned an invalid order. Please try again.");
      error.status = 502;
      throw error;
    }
    db.prepare([
      "INSERT INTO orders (order_number, customer_name, phone, email, address, items_json, subtotal, coupon_code, coupon_discount, delivery_fee, tax, total, payment_method, payment_status, status, created_at, gateway_order_id)",
      "VALUES (@orderNumber, @name, @phone, @email, @address, @itemsJson, @subtotal, @couponCode, @couponDiscount, @deliveryFee, @tax, @total, 'razorpay', 'created', 'payment_pending', @createdAt, @gatewayOrderId)"
    ].join(" ")).run({
      orderNumber, ...customer, itemsJson: JSON.stringify(bill.items), subtotal: bill.subtotal,
      couponCode: bill.couponCode, couponDiscount: bill.couponDiscount, deliveryFee: bill.deliveryFee,
      tax: bill.tax, total: bill.total, createdAt, gatewayOrderId: gatewayOrder.id
    });
    return res.status(201).json({
      keyId: process.env.RAZORPAY_KEY_ID, razorpayOrderId: gatewayOrder.id,
      orderNumber, amount: gatewayOrder.amount, currency: gatewayOrder.currency || "INR", total: bill.total
    });
  } catch (error) { return next(error); }
});

app.post("/api/payments/verify", async (req, res, next) => {
  try {
    if (!razorpayEnabled()) return res.status(503).json({ error: "Online payment verification is not configured." });
    const body = req.body || {};
    const orderId = String(body.razorpay_order_id || "").trim();
    const paymentId = String(body.razorpay_payment_id || "").trim();
    const signature = String(body.razorpay_signature || "").trim();
    if (!orderId || !paymentId || !/^[a-f0-9]{64}$/i.test(signature)) return res.status(400).json({ error: "The payment confirmation details are incomplete." });
    const row = db.prepare("SELECT order_number, gateway_order_id, total, payment_status FROM orders WHERE gateway_order_id = ?").get(orderId);
    if (!row) return res.status(404).json({ error: "The FoodieHub order for this payment could not be found." });
    if (row.payment_status === "paid") return res.json({
      orderNumber: row.order_number, status: "confirmed", total: row.total, paymentStatus: "paid",
      paymentMethod: "razorpay", message: "This payment was already verified."
    });
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(row.gateway_order_id + "|" + paymentId).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(signature, "hex");
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return res.status(400).json({ error: "Payment signature verification failed. The order has not been confirmed." });
    }
    let payment = await razorpayRequest("/payments/" + encodeURIComponent(paymentId));
    if (payment.order_id !== row.gateway_order_id || Number(payment.amount) !== Math.round(Number(row.total) * 100)) {
      return res.status(400).json({ error: "The payment amount or order does not match this FoodieHub order." });
    }
    if (payment.status === "authorized" && !payment.captured) {
      payment = await razorpayRequest("/payments/" + encodeURIComponent(paymentId) + "/capture", {
        method: "POST", body: { amount: Math.round(Number(row.total) * 100), currency: "INR" }
      });
    }
    if (payment.status !== "captured" && payment.captured !== true) {
      return res.status(409).json({ error: "Payment is authorised but not captured yet. The order is still pending; contact support before retrying." });
    }
    db.prepare("UPDATE orders SET payment_status = 'paid', status = 'confirmed' WHERE order_number = ?").run(row.order_number);
    return res.json({
      orderNumber: row.order_number, status: "confirmed", total: row.total, paymentStatus: "paid",
      paymentMethod: "razorpay", message: "Payment captured and verified securely. Your order is confirmed."
    });
  } catch (error) { return next(error); }
});

app.post("/api/orders", (req, res, next) => {
  try {
    const body = req.body || {};
    const customer = validateCustomer(body.customer);
    const { name, phone, email, address } = customer;
    const paymentMethod = String(body.paymentMethod || "cod");
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Please enter a valid name." });
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Please enter a valid 10-digit mobile number." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (address.length < 12 || address.length > 500) return res.status(400).json({ error: "Please enter a complete delivery address." });
    if (!["cod", "upi_at_door"].includes(paymentMethod)) return res.status(400).json({ error: "Choose a supported demo payment method." });

    const bill = calculateOrder(body.items, body.couponCode);
    const orderNumber = createOrderNumber();
    const createdAt = new Date().toISOString();
    db.prepare([
      "INSERT INTO orders (order_number, customer_name, phone, email, address, items_json, subtotal, coupon_code, coupon_discount, delivery_fee, tax, total, payment_method, payment_status, status, created_at)",
      "VALUES (@orderNumber, @name, @phone, @email, @address, @itemsJson, @subtotal, @couponCode, @couponDiscount, @deliveryFee, @tax, @total, @paymentMethod, 'pending', 'confirmed', @createdAt)"
    ].join(" ")).run({
      orderNumber, name, phone, email, address,
      itemsJson: JSON.stringify(bill.items),
      subtotal: bill.subtotal,
      couponCode: bill.couponCode,
      couponDiscount: bill.couponDiscount,
      deliveryFee: bill.deliveryFee,
      tax: bill.tax,
      total: bill.total,
      paymentMethod,
      createdAt
    });
    res.status(201).json({
      ...publicOrder({ order_number: orderNumber, status: "confirmed", total: bill.total, payment_method: paymentMethod, payment_status: "pending", created_at: createdAt }),
      items: bill.items,
      subtotal: bill.subtotal,
      couponDiscount: bill.couponDiscount,
      deliveryFee: bill.deliveryFee,
      tax: bill.tax,
      message: "Your order has been saved by FoodieHub."
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/track", (req, res) => {
  const orderNumber = String(req.query.order || "").trim().toUpperCase();
  const phone = cleanPhone(req.query.phone);
  if (!orderNumber || !/^[6-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Enter the order number and the mobile number used at checkout." });
  }
  const row = db.prepare("SELECT order_number, phone, status, total, payment_method, payment_status, created_at FROM orders WHERE order_number = ?").get(orderNumber);
  if (!row || row.phone !== phone) return res.status(404).json({ error: "No order matched those details." });
  return res.json(publicOrder(row));
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT order_number, customer_name, phone, email, address, items_json, subtotal, coupon_code, coupon_discount, delivery_fee, tax, total, payment_method, payment_status, status, created_at FROM orders ORDER BY created_at DESC LIMIT 100").all();
  res.json({
    count: rows.length,
    orders: rows.map(row => ({ ...row, items: JSON.parse(row.items_json) }))
  });
});

app.patch("/api/admin/orders/:orderNumber", requireAdmin, (req, res) => {
  const allowedStatuses = ["confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"];
  const status = String((req.body || {}).status || "");
  if (!allowedStatuses.includes(status)) return res.status(400).json({ error: "That order status is not supported." });
  const result = db.prepare("UPDATE orders SET status = ? WHERE order_number = ?").run(status, String(req.params.orderNumber).toUpperCase());
  if (!result.changes) return res.status(404).json({ error: "Order not found." });
  return res.json({ ok: true, orderNumber: String(req.params.orderNumber).toUpperCase(), status });
});

app.post("/api/newsletter", (req, res) => {
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  try {
    db.prepare("INSERT INTO subscribers (email, created_at) VALUES (?, ?)").run(email, new Date().toISOString());
    return res.status(201).json({ ok: true, message: "Thanks for subscribing." });
  } catch (error) {
    if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) return res.json({ ok: true, message: "You're already on the list." });
    return res.status(500).json({ error: "The sign-up could not be saved." });
  }
});

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));

// Only publish the intentional frontend folders and brand assets.
// Never expose the project root: the SQLite database lives under server/data.
const staticOptions = {
  dotfiles: "deny",
  index: false,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
};
app.use("/assets", express.static(path.join(ROOT, "assets"), staticOptions));
app.use("/data", express.static(path.join(ROOT, "data"), staticOptions));

const publicLogoFiles = new Set([
  "FoodieHub_Logo_Dark.svg",
  "FoodieHub_Logo_Light.svg",
  "FoodieHub_Logo_Icon.svg"
]);
app.get("/:filename", (req, res, next) => {
  if (!publicLogoFiles.has(req.params.filename)) return next();
  return res.sendFile(path.join(ROOT, req.params.filename));
});
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.use((req, res) => res.status(404).send("Not found."));

app.use((error, req, res, next) => {
  const status = Number(error.status) || (error.message && error.message.includes("origin is not allowed") ? 403 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "The server had a problem. Please try again." : error.message });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log("FoodieHub API and website listening on port " + port);
  console.log("Database: " + path.join(DATA_DIR, "foodiehub.sqlite"));
});