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

const MENU_PATH = path.join(ROOT, "data", "menu.json");
const menu = JSON.parse(fs.readFileSync(MENU_PATH, "utf8"));
const productById = new Map(menu.map(item => [item.id, item]));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
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
    FOOD25: { percent: 25, max: 100, minimum: 299 }
  };
  const offer = offers[normalized];
  if (!offer) return { code: "", discount: 0 };
  if (subtotal < offer.minimum) {
    const error = new Error(normalized + " needs a minimum subtotal of ₹" + offer.minimum + ".");
    error.status = 400;
    throw error;
  }
  return { code: normalized, discount: Math.min(round(subtotal * offer.percent / 100), offer.max) };
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
    subtotal += product.price * quantity;
    verifiedItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity,
      lineTotal: round(product.price * quantity)
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

app.post("/api/orders", (req, res, next) => {
  try {
    const body = req.body || {};
    const customer = body.customer || {};
    const name = String(customer.name || "").trim();
    const phone = cleanPhone(customer.phone);
    const email = String(customer.email || "").trim().toLowerCase();
    const address = String(customer.address || "").trim();
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
app.use(express.static(ROOT, { dotfiles: "deny", index: "index.html", maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("*", (req, res) => res.sendFile(path.join(ROOT, "index.html")));

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