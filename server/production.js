"use strict";

const crypto = require("crypto");
const { promisify } = require("util");
const scryptAsync = promisify(crypto.scrypt);
const rateLimitPackage = require("express-rate-limit");
const rateLimit = rateLimitPackage.rateLimit || rateLimitPackage;
const validation = require("./validation");
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_COST = 16384;
const PASSWORD_MAXMEM = 64 * 1024 * 1024;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status || 400;
  return error;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 10 || value.length > 200) throw httpError("Password must contain 10 to 200 characters.", 400);
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(value, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_COST, r: 8, p: 1, maxmem: PASSWORD_MAXMEM
  });
  return "scrypt$" + salt.toString("hex") + "$" + Buffer.from(derived).toString("hex");
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]{128}$/i.test(parts[2])) return false;
  const expected = Buffer.from(parts[2], "hex");
  const actual = Buffer.from(await scryptAsync(String(password || ""), Buffer.from(parts[1], "hex"), PASSWORD_KEY_LENGTH, {
    N: PASSWORD_COST, r: 8, p: 1, maxmem: PASSWORD_MAXMEM
  }));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function signToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = header + "." + body;
  const signature = crypto.createHmac("sha256", secret).update(input).digest("base64url");
  return input + "." + signature;
}

function verifyToken(token, secret) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const input = parts[0] + "." + parts[1];
    const expected = crypto.createHmac("sha256", secret).update(input).digest();
    const received = Buffer.from(parts[2], "base64url");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (header.alg !== "HS256" || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function normalizeEmail(value) {
  try { return validation.normalizeEmail(value, "Email address", false); }
  catch (_) { return ""; }
}

function normalizePhone(value) {
  try { return validation.normalizePhone(value); }
  catch (_) { return ""; }
}

function validEmail(value) {
  return validation.validateEmail(value);
}

function makeSlug(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
}

function createProductionBackend(options) {
  const app = options.app;
  const db = options.db;
  const menu = options.menu;
  const productById = options.productById;
  const requireAdmin = options.requireAdmin;
  const razorpayRequest = options.razorpayRequest;
  const secret = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");
  const sessionSeconds = Math.max(3600, Math.min(2592000, Number(process.env.AUTH_TOKEN_TTL_SECONDS || 604800)));

  if (process.env.NODE_ENV === "production") {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error("Production requires JWT_SECRET with at least 32 random characters.");
    }
    if (!process.env.ALLOWED_ORIGINS || !process.env.ALLOWED_ORIGINS.trim()) {
      throw new Error("Production requires ALLOWED_ORIGINS to contain the exact website origin.");
    }
  }

  db.exec([
    "CREATE TABLE IF NOT EXISTS users (",
    "id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,",
    "phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,",
    "created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS auth_sessions (",
    "jti TEXT PRIMARY KEY, subject_id TEXT NOT NULL, role TEXT NOT NULL,",
    "expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);",
    "CREATE INDEX IF NOT EXISTS idx_auth_sessions_subject ON auth_sessions(subject_id, role);",
    "CREATE TABLE IF NOT EXISTS user_addresses (",
    "id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
    "label TEXT NOT NULL DEFAULT 'Home', address_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses(user_id);",
    "CREATE TABLE IF NOT EXISTS menu_catalog (",
    "product_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS inventory (",
    "product_id TEXT PRIMARY KEY, quantity INTEGER, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS coupons (",
    "code TEXT PRIMARY KEY, discount_type TEXT NOT NULL, discount_value REAL NOT NULL,",
    "max_discount REAL, min_order REAL NOT NULL DEFAULT 0, max_uses INTEGER,",
    "used_count INTEGER NOT NULL DEFAULT 0, starts_at TEXT, expires_at TEXT,",
    "active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS order_inventory (",
    "order_number TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL,",
    "status TEXT NOT NULL DEFAULT 'held', expires_at TEXT,",
    "PRIMARY KEY(order_number, product_id));",
    "CREATE INDEX IF NOT EXISTS idx_order_inventory_expiry ON order_inventory(status, expires_at);",
    "CREATE TABLE IF NOT EXISTS order_coupons (",
    "order_number TEXT PRIMARY KEY, coupon_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'claimed');",
    "CREATE TABLE IF NOT EXISTS audit_logs (",
    "id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL,",
    "entity_id TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL);",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);",
    "CREATE TABLE IF NOT EXISTS webhook_events (",
    "event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL);"
  ].join(" "));

  const orderColumns = new Set(db.pragma("table_info(orders)").map(column => column.name));
  if (!orderColumns.has("user_id")) db.exec("ALTER TABLE orders ADD COLUMN user_id TEXT");
  if (!orderColumns.has("razorpay_payment_id")) db.exec("ALTER TABLE orders ADD COLUMN razorpay_payment_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC)");

  const now = () => new Date().toISOString();
  const seedMenu = db.prepare("INSERT OR IGNORE INTO menu_catalog (product_id, data_json, is_active, updated_at) VALUES (?, ?, 1, ?)");
  const seedStock = db.prepare("INSERT OR IGNORE INTO inventory (product_id, quantity, updated_at) VALUES (?, NULL, ?)");
  for (const item of menu) {
    seedMenu.run(item.id, JSON.stringify(item), now());
    seedStock.run(item.id, now());
  }
  const savedMenu = db.prepare("SELECT product_id, data_json, is_active FROM menu_catalog").all();
  for (const row of savedMenu) {
    try {
      const item = JSON.parse(row.data_json);
      const index = menu.findIndex(entry => entry.id === row.product_id);
      if (index >= 0) menu[index] = item;
      else menu.push(item);
      productById.set(row.product_id, item);
    } catch (_) {
      console.error("Skipped invalid saved menu record:", row.product_id);
    }
  }

  const seedCoupon = db.prepare([
    "INSERT OR IGNORE INTO coupons",
    "(code, discount_type, discount_value, max_discount, min_order, max_uses, used_count, active, created_at, updated_at)",
    "VALUES (?, ?, ?, ?, ?, NULL, 0, 1, ?, ?)"
  ].join(" "));
  const seededAt = now();
  [
    ["HUB50", "percent", 50, 200, 699],
    ["FOOD25", "percent", 25, 100, 299],
    ["COMBO10", "percent", 10, 150, 199],
    ["REWARD25", "fixed", 25, 25, 249]
  ].forEach(item => seedCoupon.run(item[0], item[1], item[2], item[3], item[4], seededAt, seededAt));

  function createSession(subjectId, role) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + sessionSeconds;
    const jti = crypto.randomUUID();
    const token = signToken({ sub: subjectId, role, jti, iat: issuedAt, exp: expiresAt }, secret);
    db.prepare("INSERT INTO auth_sessions (jti, subject_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(jti, subjectId, role, new Date(expiresAt * 1000).toISOString(), now());
    return { token, expiresIn: sessionSeconds };
  }

  function lookupSession(token) {
    const claims = verifyToken(token, secret);
    if (!claims || !claims.jti || !claims.sub || !claims.role) return null;
    const session = db.prepare("SELECT jti, subject_id, role, expires_at, revoked_at FROM auth_sessions WHERE jti = ?").get(claims.jti);
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) return null;
    if (session.subject_id !== claims.sub || session.role !== claims.role) return null;
    return claims;
  }

  function bearerToken(req) {
    const header = String(req.get("authorization") || "");
    return header.replace(/^Bearer\s+/i, "").trim();
  }

  function attachOptionalUser(req, res, next) {
    const token = bearerToken(req);
    const claims = token ? lookupSession(token) : null;
    if (claims) {
      req.auth = claims;
      if (claims.role === "customer") {
        const user = db.prepare("SELECT id, name, email, phone, created_at FROM users WHERE id = ? AND is_active = 1").get(claims.sub);
        if (user) req.user = user;
      }
    }
    next();
  }

  function verifyAdminToken(token) {
    const claims = lookupSession(token);
    return Boolean(claims && claims.role === "admin");
  }

  function requireCustomer(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Please sign in to access this account." });
    next();
  }

  function audit(actor, action, entityType, entityId, details) {
    db.prepare("INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), String(actor || "system"), action, entityType, String(entityId), details ? JSON.stringify(details) : null, now());
  }

  async function registerCustomer(req, res) {
    const body = validation.requireObject(req.body, "Registration request");
    let name = "";
    let email = "";
    let phone = "";
    try {
      name = validation.validateName(body.name, "Full name");
      email = validation.normalizeEmail(body.email, "Email address", true);
      phone = validation.normalizePhone(body.phone);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 200) {
      return res.status(400).json({ error: "Password must contain 10 to 200 characters." });
    }
    const password = body.password;
    const createdAt = now();
    const id = crypto.randomUUID();
    try {
      const passwordHash = await hashPassword(password);
      db.prepare("INSERT INTO users (id, name, email, phone, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, name, email, phone, passwordHash, createdAt, createdAt);
      const session = createSession(id, "customer");
      audit(id, "customer.registered", "user", id);
      return res.status(201).json({
        ...session,
        user: { id, name, email, phone, createdAt }
      });
    } catch (error) {
      if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "An account already exists with that email address or mobile number." });
      return res.status(500).json({ error: "Account registration could not be completed." });
    }
  }

  async function loginCustomer(req, res) {
    const body = validation.requireObject(req.body, "Sign-in request");
    const email = normalizeEmail(body.email);
    if (!email || !validEmail(email) || typeof body.password !== "string" || !body.password || body.password.length > 200) {
      return res.status(400).json({ error: "Enter a valid registered email and password." });
    }
    const password = body.password;
    const user = db.prepare("SELECT id, name, email, phone, password_hash, is_active, created_at FROM users WHERE email = ?").get(email);
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    const session = createSession(user.id, "customer");
    return res.json({
      ...session,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, createdAt: user.created_at }
    });
  }

  app.use("/api", attachOptionalUser);
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please try again in 15 minutes." }
  });
  app.use("/api/auth/register", credentialLimiter);
  app.use("/api/auth/login", credentialLimiter);
  app.use("/api/admin/auth/login", credentialLimiter);

  app.post("/api/auth/register", (req, res) => registerCustomer(req, res).catch(() => res.status(500).json({ error: "Account registration could not be completed." })));
  app.post("/api/auth/login", (req, res) => loginCustomer(req, res).catch(() => res.status(500).json({ error: "Sign in could not be completed." })));
  app.get("/api/auth/me", requireCustomer, (req, res) => res.json({ user: req.user }));
  app.post("/api/auth/logout", requireCustomer, (req, res) => {
    db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL").run(now(), req.auth.jti);
    return res.json({ ok: true });
  });
  app.patch("/api/auth/me", requireCustomer, (req, res) => {
    const body = validation.requireObject(req.body, "Profile update");
    let name = "";
    let phone = "";
    try {
      name = validation.validateName(body.name, "Full name");
      phone = validation.normalizePhone(body.phone);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      db.prepare("UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?").run(name, phone, now(), req.user.id);
      return res.json({ user: db.prepare("SELECT id, name, email, phone, created_at FROM users WHERE id = ?").get(req.user.id) });
    } catch (error) {
      if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "That mobile number is already linked to another account." });
      return res.status(500).json({ error: "Profile could not be updated." });
    }
  });

  app.get("/api/auth/orders", requireCustomer, (req, res) => {
    const rows = db.prepare("SELECT order_number, items_json, subtotal, coupon_code, coupon_discount, delivery_fee, tax, total, payment_method, payment_status, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(req.user.id);
    return res.json({
      count: rows.length,
      orders: rows.map(row => ({
        orderNumber: row.order_number,
        items: JSON.parse(row.items_json || "[]"),
        subtotal: row.subtotal,
        couponCode: row.coupon_code,
        couponDiscount: row.coupon_discount,
        deliveryFee: row.delivery_fee,
        tax: row.tax,
        total: row.total,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        status: row.status,
        createdAt: row.created_at
      }))
    });
  });

  app.get("/api/auth/addresses", requireCustomer, (req, res) => {
    const rows = db.prepare("SELECT id, label, address_json, created_at FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
    return res.json({ addresses: rows.map(row => ({ id: row.id, label: row.label, address: JSON.parse(row.address_json), createdAt: row.created_at })) });
  });

  app.post("/api/auth/addresses", requireCustomer, (req, res) => {
    let label;
    let address;
    try {
      const body = validation.requireObject(req.body, "Saved address");
      label = body.label === undefined ? "Home" : validation.validateLabel(body.label);
      address = validation.validateAddress(body.address, { required: true });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO user_addresses (id, user_id, label, address_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, req.user.id, label, JSON.stringify(address), now());
    return res.status(201).json({ id, label, address });
  });

  app.delete("/api/auth/addresses/:id", requireCustomer, (req, res) => {
    const result = db.prepare("DELETE FROM user_addresses WHERE id = ? AND user_id = ?").run(String(req.params.id), req.user.id);
    if (!result.changes) return res.status(404).json({ error: "Saved address not found." });
    return res.json({ ok: true });
  });

  app.post("/api/admin/auth/login", async (req, res) => {
    try {
      const body = validation.requireObject(req.body, "Admin sign-in request");
      const email = normalizeEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      const expectedEmail = normalizeEmail(process.env.ADMIN_EMAIL);
      const passwordHash = process.env.ADMIN_PASSWORD_HASH || "";
      if (!expectedEmail || !passwordHash) return res.status(503).json({ error: "Admin email login is not configured on this server." });
      if (email !== expectedEmail || !(await verifyPassword(password, passwordHash))) {
        return res.status(401).json({ error: "Admin email or password is incorrect." });
      }
      const session = createSession("foodiehub-admin", "admin");
      audit("foodiehub-admin", "admin.login", "session", "foodiehub-admin");
      return res.json({ ...session, role: "admin" });
    } catch (_) {
      return res.status(500).json({ error: "Admin sign in could not be completed." });
    }
  });

  app.post("/api/coupons/validate", (req, res) => {
    try {
      const body = validation.requireObject(req.body, "Coupon validation request");
      const subtotal = body.subtotal;
      if (typeof subtotal !== "number" || !Number.isFinite(subtotal) || subtotal < 0 || subtotal > 1000000) {
        return res.status(400).json({ error: "Enter a valid order subtotal." });
      }
      if (typeof body.code !== "string" || body.code.length > 24) return res.status(400).json({ error: "Enter a valid coupon code." });
      const result = calculateCoupon(body.code, subtotal);
      if (!result.code) return res.status(404).json({ error: "That coupon code is not available." });
      return res.json({ ...result, subtotal, discountedSubtotal: Math.max(0, subtotal - result.discount) });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
  });

  function getCoupon(code) {
    return db.prepare("SELECT * FROM coupons WHERE code = ?").get(String(code || "").trim().toUpperCase());
  }

  function calculateCoupon(code, subtotal) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return { code: "", discount: 0 };
    const coupon = getCoupon(normalized);
    if (!coupon || !coupon.active) throw httpError("That coupon code is not available.", 400);
    const current = Date.now();
    if (coupon.starts_at && Date.parse(coupon.starts_at) > current) throw httpError("That coupon is not active yet.", 400);
    if (coupon.expires_at && Date.parse(coupon.expires_at) < current) throw httpError("That coupon has expired.", 400);
    if (coupon.max_uses !== null && Number(coupon.used_count) >= Number(coupon.max_uses)) throw httpError("That coupon has reached its usage limit.", 400);
    if (Number(subtotal) < Number(coupon.min_order)) throw httpError(normalized + " needs a minimum subtotal of ₹" + Number(coupon.min_order) + ".", 400);
    const raw = coupon.discount_type === "fixed"
      ? Number(coupon.discount_value)
      : Number(subtotal) * Number(coupon.discount_value) / 100;
    const capped = coupon.max_discount === null ? raw : Math.min(raw, Number(coupon.max_discount));
    return { code: normalized, discount: Math.min(Number(subtotal), Math.round((capped + Number.EPSILON) * 100) / 100) };
  }

  function claimCoupon(code, orderNumber) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return;
    const current = now();
    const result = db.prepare([
      "UPDATE coupons SET used_count = used_count + 1, updated_at = ?",
      "WHERE code = ? AND active = 1 AND (max_uses IS NULL OR used_count < max_uses)",
      "AND (starts_at IS NULL OR starts_at <= ?) AND (expires_at IS NULL OR expires_at >= ?)"
    ].join(" ")).run(current, normalized, current, current);
    if (!result.changes) throw httpError("That coupon is no longer available. Please review your bag.", 409);
    db.prepare("INSERT INTO order_coupons (order_number, coupon_code, status) VALUES (?, ?, 'claimed')").run(orderNumber, normalized);
  }

  function releaseCoupon(orderNumber) {
    const row = db.prepare("SELECT coupon_code, status FROM order_coupons WHERE order_number = ?").get(orderNumber);
    if (!row || row.status !== "claimed") return;
    db.prepare("UPDATE coupons SET used_count = MAX(0, used_count - 1), updated_at = ? WHERE code = ?").run(now(), row.coupon_code);
    db.prepare("UPDATE order_coupons SET status = 'released' WHERE order_number = ?").run(orderNumber);
  }

  function isProductActive(productId) {
    const row = db.prepare("SELECT is_active FROM menu_catalog WHERE product_id = ?").get(productId);
    return Boolean(row && row.is_active === 1);
  }

  function reserveInventory(orderNumber, items, expiryMinutes) {
    const totals = new Map();
    for (const item of items || []) {
      totals.set(item.productId, (totals.get(item.productId) || 0) + Number(item.quantity || 0));
    }
    const expiry = expiryMinutes ? new Date(Date.now() + expiryMinutes * 60000).toISOString() : null;
    for (const [productId, quantity] of totals.entries()) {
      const inventoryRow = db.prepare("SELECT quantity FROM inventory WHERE product_id = ?").get(productId);
      if (!inventoryRow) throw httpError("A menu item is no longer available.", 409);
      if (!isProductActive(productId)) throw httpError("A menu item is currently unavailable.", 409);
      if (inventoryRow.quantity !== null) {
        const updated = db.prepare("UPDATE inventory SET quantity = quantity - ?, updated_at = ? WHERE product_id = ? AND quantity >= ?")
          .run(quantity, now(), productId, quantity);
        if (!updated.changes) throw httpError("One of your selected dishes has just sold out. Please update your bag.", 409);
      }
      db.prepare("INSERT INTO order_inventory (order_number, product_id, quantity, status, expires_at) VALUES (?, ?, ?, 'held', ?)")
        .run(orderNumber, productId, quantity, expiry);
    }
  }

  function consumeInventory(orderNumber) {
    db.prepare("UPDATE order_inventory SET status = 'consumed', expires_at = NULL WHERE order_number = ? AND status = 'held'").run(orderNumber);
  }

  function releaseInventory(orderNumber) {
    const rows = db.prepare("SELECT product_id, quantity FROM order_inventory WHERE order_number = ? AND status IN ('held', 'consumed')").all(orderNumber);
    for (const row of rows) {
      db.prepare("UPDATE inventory SET quantity = quantity + ?, updated_at = ? WHERE product_id = ? AND quantity IS NOT NULL")
        .run(row.quantity, now(), row.product_id);
    }
    db.prepare("UPDATE order_inventory SET status = 'released', expires_at = NULL WHERE order_number = ? AND status IN ('held', 'consumed')").run(orderNumber);
  }

  function expirePaymentReservations() {
    const expired = db.prepare("SELECT DISTINCT order_number FROM order_inventory WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at <= ?").all(now());
    if (!expired.length) return;
    const expire = db.transaction(() => {
      for (const item of expired) {
        releaseInventory(item.order_number);
        releaseCoupon(item.order_number);
        db.prepare("UPDATE orders SET status = 'failed', payment_status = 'expired' WHERE order_number = ? AND status = 'payment_pending'").run(item.order_number);
      }
    });
    expire();
  }

  function updateMenuItem(productId, updated, active) {
    const existing = productById.get(productId);
    if (!existing && !updated) throw httpError("Menu item not found.", 404);
    const item = updated || existing;
    db.prepare([
      "INSERT INTO menu_catalog (product_id, data_json, is_active, updated_at) VALUES (?, ?, ?, ?)",
      "ON CONFLICT(product_id) DO UPDATE SET data_json = excluded.data_json, is_active = excluded.is_active, updated_at = excluded.updated_at"
    ].join(" ")).run(productId, JSON.stringify(item), active ? 1 : 0, now());
    if (existing) {
      const index = menu.findIndex(entry => entry.id === productId);
      if (index >= 0) menu[index] = item;
    } else {
      menu.push(item);
    }
    productById.set(productId, item);
    db.prepare("INSERT OR IGNORE INTO inventory (product_id, quantity, updated_at) VALUES (?, NULL, ?)").run(productId, now());
    return item;
  }


  function validateMenuItem(input, existing = null) {
    const body = validation.requireObject(input, "Menu item");
    const allowedFields = new Set(["id", "name", "category", "price", "description", "originalPrice", "prepTime", "isVeg", "featured", "badge", "tags", "image"]);
    const unknown = Object.keys(body).filter(key => !allowedFields.has(key));
    if (unknown.length) throw httpError("Unsupported menu item fields: " + unknown.join(", ") + ".");
    const name = validation.cleanString(body.name === undefined ? existing && existing.name : body.name, "Dish name", {
      min: 2, max: 100, pattern: /^[\p{L}\p{M}\p{N} .,'&()/-]+$/u
    });
    const category = validation.cleanString(body.category === undefined ? existing && existing.category : body.category, "Dish category", {
      min: 2, max: 40, pattern: /^[\p{L}\p{M}\p{N} &-]+$/u
    });
    const rawId = body.id === undefined ? (existing ? existing.id : name) : body.id;
    if (typeof rawId !== "string") throw httpError("Dish ID must be text.");
    const id = makeSlug(rawId);
    if (!id || id.length > 70 || (body.id !== undefined && id !== rawId.trim().toLowerCase())) {
      throw httpError("Dish ID may contain only lowercase letters, numbers and single hyphens.");
    }
    const price = body.price === undefined ? existing && existing.price : body.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 1 || price > 100000 || Math.round(price * 100) !== price * 100) {
      throw httpError("Dish price must be a number between ₹1 and ₹100,000 with at most two decimal places.");
    }
    const originalPrice = body.originalPrice === undefined
      ? (existing && typeof existing.originalPrice === "number" ? existing.originalPrice : price)
      : body.originalPrice;
    if (typeof originalPrice !== "number" || !Number.isFinite(originalPrice) || originalPrice < price || originalPrice > 100000 || Math.round(originalPrice * 100) !== originalPrice * 100) {
      throw httpError("Original price must be a valid amount equal to or greater than the selling price.");
    }
    const prepTime = body.prepTime === undefined ? (existing ? existing.prepTime : 15) : body.prepTime;
    if (!Number.isInteger(prepTime) || prepTime < 1 || prepTime > 240) throw httpError("Preparation time must be a whole number between 1 and 240 minutes.");
    for (const field of ["isVeg", "featured"]) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") throw httpError(field + " must be true or false.");
    }
    const description = validation.cleanString(body.description === undefined ? (existing && existing.description || "") : body.description,
      "Dish description", { min: 0, max: 300, required: false });
    const badge = validation.cleanString(body.badge === undefined ? (existing && existing.badge || "") : body.badge,
      "Dish badge", { min: 0, max: 60, required: false });
    const tagsInput = body.tags === undefined ? (existing && existing.tags || []) : body.tags;
    if (!Array.isArray(tagsInput) || tagsInput.length > 12) throw httpError("Dish tags must be a list containing at most 12 entries.");
    const tags = tagsInput.map(tag => validation.cleanString(tag, "Dish tag", {
      min: 1, max: 24, pattern: /^[\p{L}\p{M}\p{N} &-]+$/u
    }));
    if (new Set(tags.map(tag => tag.toLowerCase())).size !== tags.length) throw httpError("Dish tags cannot contain duplicates.");
    const image = validation.cleanString(body.image === undefined ? (existing && existing.image || "") : body.image,
      "Food image URL", { min: 0, max: 2048, required: false });
    if (image) {
      let parsed;
      try { parsed = new URL(image); } catch (_) { throw httpError("Food image must be a valid HTTPS URL."); }
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        throw httpError("Food image must be a valid public HTTPS URL.");
      }
    }
    return {
      id, name, category, price, description, originalPrice,
      discountPercent: Math.max(0, Math.round((originalPrice - price) / originalPrice * 100)),
      prepTime,
      isVeg: body.isVeg === undefined ? (existing ? existing.isVeg : true) : body.isVeg,
      featured: body.featured === undefined ? Boolean(existing && existing.featured) : body.featured,
      badge, tags, image
    };
  }

  app.get("/api/admin/menu", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT product_id, data_json, is_active, updated_at FROM menu_catalog ORDER BY product_id").all();
    return res.json({
      items: rows.map(row => {
        const item = JSON.parse(row.data_json);
        const stock = db.prepare("SELECT quantity FROM inventory WHERE product_id = ?").get(row.product_id);
        return { ...item, isActive: Boolean(row.is_active), stockQuantity: stock ? stock.quantity : null, updatedAt: row.updated_at };
      })
    });
  });

  app.post("/api/admin/menu", requireAdmin, (req, res) => {
    let item;
    try {
      item = validateMenuItem(req.body);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || "Menu item details are invalid." });
    }
    if (productById.has(item.id)) return res.status(409).json({ error: "That menu item ID already exists." });
    updateMenuItem(item.id, item, true);
    audit("admin", "menu.created", "menu_item", item.id, { name: item.name, price: item.price });
    return res.status(201).json({ item });
  });

  app.patch("/api/admin/menu/:productId", requireAdmin, (req, res) => {
    const id = String(req.params.productId || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return res.status(400).json({ error: "Menu item ID is invalid." });
    const existing = productById.get(id);
    if (!existing) return res.status(404).json({ error: "Menu item not found." });
    let updated;
    try {
      updated = validateMenuItem(req.body, existing);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message || "Menu item details are invalid." });
    }
    const row = db.prepare("SELECT is_active FROM menu_catalog WHERE product_id = ?").get(id);
    updateMenuItem(id, updated, row ? Boolean(row.is_active) : true);
    audit("admin", "menu.updated", "menu_item", id, { price: updated.price });
    return res.json({ item: updated });
  });

  app.patch("/api/admin/menu/:productId/availability", requireAdmin, (req, res) => {
    const id = String(req.params.productId || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return res.status(400).json({ error: "Menu item ID is invalid." });
    let body;
    try { body = validation.requireObject(req.body, "Availability update"); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if (typeof body.available !== "boolean") return res.status(400).json({ error: "Availability must be true or false." });
    const row = db.prepare("SELECT data_json FROM menu_catalog WHERE product_id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Menu item not found." });
    const active = body.available;
    db.prepare("UPDATE menu_catalog SET is_active = ?, updated_at = ? WHERE product_id = ?").run(active ? 1 : 0, now(), id);
    audit("admin", "menu.availability_changed", "menu_item", id, { active });
    return res.json({ productId: id, available: active });
  });

  app.delete("/api/admin/menu/:productId", requireAdmin, (req, res) => {
    const id = String(req.params.productId || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return res.status(400).json({ error: "Menu item ID is invalid." });
    const result = db.prepare("UPDATE menu_catalog SET is_active = 0, updated_at = ? WHERE product_id = ?").run(now(), id);
    if (!result.changes) return res.status(404).json({ error: "Menu item not found." });
    audit("admin", "menu.archived", "menu_item", id);
    return res.json({ ok: true, productId: id, active: false });
  });

  app.get("/api/admin/inventory", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT i.product_id, i.quantity, i.updated_at, m.data_json, m.is_active FROM inventory i JOIN menu_catalog m ON m.product_id = i.product_id ORDER BY i.product_id").all();
    return res.json({
      inventory: rows.map(row => {
        const item = JSON.parse(row.data_json);
        return { productId: row.product_id, name: item.name, category: item.category, quantity: row.quantity, tracked: row.quantity !== null, available: Boolean(row.is_active) && (row.quantity === null || row.quantity > 0), updatedAt: row.updated_at };
      })
    });
  });

  app.patch("/api/admin/inventory/:productId", requireAdmin, (req, res) => {
    const id = String(req.params.productId || "");
    const quantity = (req.body || {}).quantity;
    if (!(quantity === null || (Number.isInteger(quantity) && quantity >= 0 && quantity <= 50000))) {
      return res.status(400).json({ error: "Stock quantity must be a non-negative whole number or null for untracked stock." });
    }
    const result = db.prepare("UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?").run(quantity, now(), id);
    if (!result.changes) return res.status(404).json({ error: "Inventory item not found." });
    audit("admin", "inventory.updated", "menu_item", id, { quantity });
    return res.json({ productId: id, quantity, tracked: quantity !== null });
  });

  app.get("/api/admin/coupons", requireAdmin, (req, res) => {
    const coupons = db.prepare("SELECT code, discount_type AS discountType, discount_value AS discountValue, max_discount AS maxDiscount, min_order AS minimumOrder, max_uses AS maxUses, used_count AS usedCount, starts_at AS startsAt, expires_at AS expiresAt, active FROM coupons ORDER BY code").all();
    return res.json({ coupons });
  });

  app.post("/api/admin/coupons", requireAdmin, (req, res) => {
    const body = req.body || {};
    const code = String(body.code || "").trim().toUpperCase();
    const type = String(body.discountType || "percent");
    const value = Number(body.discountValue);
    const min = Number(body.minimumOrder || 0);
    const maximum = body.maxDiscount == null ? null : Number(body.maxDiscount);
    const maxUses = body.maxUses == null || body.maxUses === "" ? null : Number(body.maxUses);
    if (!/^[A-Z0-9_-]{3,24}$/.test(code) || !["percent", "fixed"].includes(type) || !Number.isFinite(value) || value <= 0 || value > (type === "percent" ? 100 : 100000) || !Number.isFinite(min) || min < 0 || (maximum !== null && (!Number.isFinite(maximum) || maximum < 0)) || (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1))) {
      return res.status(400).json({ error: "Coupon details are invalid. Check code, discount, minimum and usage limit." });
    }
    const createdAt = now();
    try {
      db.prepare("INSERT INTO coupons (code, discount_type, discount_value, max_discount, min_order, max_uses, used_count, starts_at, expires_at, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)")
        .run(code, type, value, maximum, min, maxUses, body.startsAt || null, body.expiresAt || null, createdAt, createdAt);
      audit("admin", "coupon.created", "coupon", code);
      return res.status(201).json({ ok: true, code });
    } catch (error) {
      if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "That coupon code already exists." });
      return res.status(500).json({ error: "Coupon could not be created." });
    }
  });

  app.patch("/api/admin/coupons/:code", requireAdmin, (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const existing = getCoupon(code);
    if (!existing) return res.status(404).json({ error: "Coupon not found." });
    const body = req.body || {};
    const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
    const startsAt = body.startsAt === undefined ? existing.starts_at : (body.startsAt || null);
    const expiresAt = body.expiresAt === undefined ? existing.expires_at : (body.expiresAt || null);
    const type = body.discountType === undefined ? existing.discount_type : String(body.discountType);
    const value = body.discountValue === undefined ? Number(existing.discount_value) : Number(body.discountValue);
    const minimum = body.minimumOrder === undefined ? Number(existing.min_order) : Number(body.minimumOrder);
    const maximum = body.maxDiscount === undefined ? existing.max_discount : (body.maxDiscount === null ? null : Number(body.maxDiscount));
    const maxUses = body.maxUses === undefined ? existing.max_uses : (body.maxUses === null ? null : Number(body.maxUses));
    if (!["percent", "fixed"].includes(type) || !Number.isFinite(value) || value <= 0 || value > (type === "percent" ? 100 : 100000) ||
        !Number.isFinite(minimum) || minimum < 0 || (maximum !== null && (!Number.isFinite(Number(maximum)) || Number(maximum) < 0)) ||
        (maxUses !== null && (!Number.isInteger(Number(maxUses)) || Number(maxUses) < 1))) {
      return res.status(400).json({ error: "Coupon discount, minimum, maximum or usage limit is invalid." });
    }
    if (startsAt && Number.isNaN(Date.parse(startsAt))) return res.status(400).json({ error: "Coupon start date is invalid." });
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return res.status(400).json({ error: "Coupon expiry date is invalid." });
    db.prepare("UPDATE coupons SET active = ?, starts_at = ?, expires_at = ?, discount_type = ?, discount_value = ?, min_order = ?, max_discount = ?, max_uses = ?, updated_at = ? WHERE code = ?")
      .run(active, startsAt, expiresAt, type, value, minimum, maximum, maxUses, now(), code);
    audit("admin", "coupon.updated", "coupon", code, { active: Boolean(active), discountType: type, discountValue: value });
    return res.json({ ok: true, code, active: Boolean(active) });
  });

  app.delete("/api/admin/coupons/:code", requireAdmin, (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const result = db.prepare("UPDATE coupons SET active = 0, updated_at = ? WHERE code = ?").run(now(), code);
    if (!result.changes) return res.status(404).json({ error: "Coupon not found." });
    audit("admin", "coupon.disabled", "coupon", code);
    return res.json({ ok: true, code, active: false });
  });

  app.get("/api/admin/customers", requireAdmin, (req, res) => {
    const rows = db.prepare([
      "SELECT u.id, u.name, u.email, u.phone, u.created_at, COUNT(o.order_number) AS total_orders,",
      "COALESCE(SUM(CASE WHEN o.payment_status = 'paid' OR o.payment_method IN ('cod','upi_at_door') THEN o.total ELSE 0 END), 0) AS order_value",
      "FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200"
    ].join(" ")).all();
    return res.json({ customers: rows });
  });

  app.get("/api/admin/newsletter", requireAdmin, (req, res) => {
    const subscribers = db.prepare("SELECT email, created_at AS createdAt FROM subscribers ORDER BY created_at DESC LIMIT 500").all();
    return res.json({ subscribers });
  });

  app.get("/api/admin/audit-logs", requireAdmin, (req, res) => {
    const logs = db.prepare("SELECT actor, action, entity_type AS entityType, entity_id AS entityId, details_json AS details, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT 200").all();
    return res.json({ logs: logs.map(row => ({ ...row, details: row.details ? JSON.parse(row.details) : null })) });
  });

  app.get("/api/admin/orders/:orderNumber", requireAdmin, (req, res) => {
    const row = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(String(req.params.orderNumber || "").toUpperCase());
    if (!row) return res.status(404).json({ error: "Order not found." });
    return res.json({
      orderNumber: row.order_number, customer: { name: row.customer_name, phone: row.phone, email: row.email },
      address: row.address, addressDetails: row.address_json ? JSON.parse(row.address_json) : null,
      items: JSON.parse(row.items_json || "[]"), subtotal: row.subtotal, couponCode: row.coupon_code,
      couponDiscount: row.coupon_discount, deliveryFee: row.delivery_fee, tax: row.tax, total: row.total,
      paymentMethod: row.payment_method, paymentStatus: row.payment_status, status: row.status,
      createdAt: row.created_at, paymentId: row.razorpay_payment_id || null
    });
  });

  app.post("/api/admin/orders/:orderNumber/refund", requireAdmin, async (req, res) => {
    const orderNumber = String(req.params.orderNumber || "").toUpperCase();
    const row = db.prepare("SELECT order_number, total, payment_status, razorpay_payment_id FROM orders WHERE order_number = ?").get(orderNumber);
    if (!row) return res.status(404).json({ error: "Order not found." });
    if (row.payment_status === "refunded") return res.json({ ok: true, orderNumber, paymentStatus: "refunded", message: "This order has already been refunded." });
    if (row.payment_status !== "paid" || !row.razorpay_payment_id) return res.status(409).json({ error: "Only captured online payments can be refunded from this dashboard." });
    if (typeof razorpayRequest !== "function") return res.status(503).json({ error: "Payment refunds are not configured." });
    try {
      const refund = await razorpayRequest("/payments/" + encodeURIComponent(row.razorpay_payment_id) + "/refund", {
        method: "POST", body: { amount: Math.round(Number(row.total) * 100), notes: { foodiehub_order_number: orderNumber } }
      });
      const completeRefund = db.transaction(() => {
        db.prepare("UPDATE orders SET payment_status = 'refunded', status = 'cancelled' WHERE order_number = ?").run(orderNumber);
        releaseInventory(orderNumber);
        releaseCoupon(orderNumber);
      });
      completeRefund();
      audit("admin", "order.refunded", "order", orderNumber, { refundId: refund.id });
      return res.json({ ok: true, orderNumber, paymentStatus: "refunded", refundId: refund.id });
    } catch (error) {
      return res.status(error.status || 502).json({ error: error.message || "The refund could not be completed." });
    }
  });

  app.post("/api/payments/webhook", async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) return res.status(503).json({ error: "Payment webhooks are not configured." });
    const signature = String(req.get("x-razorpay-signature") || "");
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(signature) || !safeEqual(expected, signature.toLowerCase())) {
      return res.status(400).json({ error: "Webhook signature verification failed." });
    }
    const eventId = String(req.get("x-razorpay-event-id") || crypto.createHash("sha256").update(rawBody).digest("hex"));
    const event = String((req.body || {}).event || "unknown");
    const saved = db.prepare("INSERT OR IGNORE INTO webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)")
      .run(eventId, event, now());
    if (!saved.changes) return res.json({ received: true, duplicate: true });

    const payload = (req.body || {}).payload || {};
    const payment = payload.payment && payload.payment.entity ? payload.payment.entity : {};
    const paymentOrderId = payment.order_id || (payload.order && payload.order.entity && payload.order.entity.id);
    const row = paymentOrderId
      ? db.prepare("SELECT order_number, status, payment_status, total FROM orders WHERE gateway_order_id = ?").get(paymentOrderId)
      : null;

    const eventAmount = Number(payment.amount || (payload.order && payload.order.entity && payload.order.entity.amount) || 0);
    const eventCurrency = String(payment.currency || (payload.order && payload.order.entity && payload.order.entity.currency) || "").toUpperCase();
    if (row && ["payment.captured", "order.paid"].includes(event) && row.payment_status !== "refunded") {
      if (eventAmount !== Math.round(Number(row.total) * 100) || eventCurrency !== "INR") {
        audit("system", "payment.webhook_amount_mismatch", "order", row.order_number, { event, eventAmount, eventCurrency });
        return res.status(202).json({ received: true, ignored: true });
      }
      if (["failed", "cancelled"].includes(row.status)) {
        try {
          if (payment.id && typeof razorpayRequest === "function") {
            await razorpayRequest("/payments/" + encodeURIComponent(payment.id) + "/refund", {
              method: "POST", body: { amount: Math.round(Number(row.total) * 100), notes: { foodiehub_order_number: row.order_number, reason: "Order reservation expired or order cancelled" } }
            });
            db.prepare("UPDATE orders SET payment_status = 'refunded', status = 'cancelled', razorpay_payment_id = ? WHERE order_number = ?")
              .run(payment.id, row.order_number);
            audit("system", "payment.late_capture_refunded", "order", row.order_number);
          } else {
            db.prepare("UPDATE orders SET payment_status = 'refund_required' WHERE order_number = ?").run(row.order_number);
          }
        } catch (error) {
          db.prepare("UPDATE orders SET payment_status = 'refund_required' WHERE order_number = ?").run(row.order_number);
          audit("system", "payment.refund_required", "order", row.order_number, { message: error.message });
        }
      } else {
        const tx = db.transaction(() => {
          db.prepare("UPDATE orders SET payment_status = 'paid', status = CASE WHEN status = 'payment_pending' THEN 'confirmed' ELSE status END, razorpay_payment_id = ? WHERE order_number = ?")
            .run(payment.id || null, row.order_number);
          consumeInventory(row.order_number);
        });
        tx();
      }
    } else if (row && event === "payment.failed") {
      const tx = db.transaction(() => {
        db.prepare("UPDATE orders SET payment_status = 'failed', status = 'failed' WHERE order_number = ? AND payment_status != 'paid'").run(row.order_number);
        releaseInventory(row.order_number);
        releaseCoupon(row.order_number);
      });
      tx();
    }
    return res.json({ received: true });
  });

  const cleanupTimer = setInterval(() => {
    try { expirePaymentReservations(); } catch (error) { console.error("Reservation cleanup failed:", error); }
  }, 5 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return {
    attachOptionalUser,
    verifyAdminToken,
    calculateCoupon,
    isProductActive,
    reserveInventory,
    consumeInventory,
    releaseInventory,
    claimCoupon,
    releaseCoupon,
    audit,
    expirePaymentReservations
  };
}

module.exports = createProductionBackend;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
module.exports.signToken = signToken;
module.exports.verifyToken = verifyToken;
