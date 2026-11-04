"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const Database = require("better-sqlite3");
const createProductionBackend = require("../server/production");
const paymentLifecycle = require("../server/payment-lifecycle");

async function fixture(t) {
  const old = {
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    AUTH_TOKEN_TTL_SECONDS: process.env.AUTH_TOKEN_TTL_SECONDS,
    NODE_ENV: process.env.NODE_ENV
  };
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "foodiehub-test-secret-with-more-than-32-characters";
  process.env.ADMIN_EMAIL = "admin@example.test";
  process.env.ADMIN_PASSWORD_HASH = await createProductionBackend.hashPassword("FoodieHubTestPass123!");
  const app = express();
  app.use(express.json());
  const db = new Database(":memory:");
  db.exec("CREATE TABLE orders (order_number TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', payment_status TEXT NOT NULL DEFAULT 'pending', items_json TEXT NOT NULL DEFAULT '[]', gateway_order_id TEXT, total REAL, coupon_code TEXT); CREATE TABLE subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);");
  const menu = [{ id: "test-bowl", name: "Test Bowl", category: "Bowls", price: 200, originalPrice: 250, isVeg: true, description: "Test item", prepTime: 15, tags: [] }];
  const productById = new Map(menu.map(item => [item.id, item]));
  let backend;
  const adminGuard = (req, res, next) => {
    const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (backend && backend.verifyAdminToken(token)) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };
  backend = createProductionBackend({ app, db, menu, productById, requireAdmin: adminGuard, razorpayRequest: async () => ({}) });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return { base, db, backend };
}

function validAddressFixture() {
  return {
    house: "B-204", building: "Green Residency", street: "Park Street", area: "Shastri Nagar",
    landmark: "", town: "Meerut", city: "Meerut", district: "Meerut",
    state: "Uttar Pradesh", pincode: "250001"
  };
}

async function post(base, route, body, token) {
  return fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body)
  });
}

test("customer registration creates a signed session and protected profile", async t => {
  const { base } = await fixture(t);
  const created = await post(base, "/api/auth/register", {
    name: "Test Customer", email: "customer@example.test", phone: "9876543210", password: "CustomerTestPass123!"
  });
  assert.equal(created.status, 201);
  const account = await created.json();
  assert.ok(account.token);
  assert.equal(account.user.email, "customer@example.test");
  const duplicate = await post(base, "/api/auth/register", {
    name: "Test Customer", email: "customer@example.test", phone: "9876543210", password: "CustomerTestPass123!"
  });
  assert.equal(duplicate.status, 409);
  const profile = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer " + account.token } });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.name, "Test Customer");
  const rejected = await fetch(base + "/api/auth/me");
  assert.equal(rejected.status, 401);
  const adminArea = await fetch(base + "/api/admin/inventory", {
    headers: { Authorization: "Bearer " + account.token }
  });
  assert.equal(adminArea.status, 401);
  const logout = await post(base, "/api/auth/logout", {}, account.token);
  assert.equal(logout.status, 200);
  const revokedProfile = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer " + account.token }
  });
  assert.equal(revokedProfile.status, 401);
  const repeatedLogout = await post(base, "/api/auth/logout", {}, account.token);
  assert.equal(repeatedLogout.status, 401);
});

test("admin login issues a role-isolated revocable session", async t => {
  const { base } = await fixture(t);
  const login = await post(base, "/api/admin/auth/login", { email: "admin@example.test", password: "FoodieHubTestPass123!" });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.role, "admin");
  const inventory = await fetch(base + "/api/admin/inventory", { headers: { Authorization: "Bearer " + session.token } });
  assert.equal(inventory.status, 200);
  assert.equal((await inventory.json()).inventory[0].productId, "test-bowl");
  const customerArea = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer " + session.token }
  });
  assert.equal(customerArea.status, 401);
});

test("customer order history and saved addresses are isolated by account ownership", async t => {
  const { base, db } = await fixture(t);
  const first = await post(base, "/api/auth/register", {
    name: "First Customer", email: "first@example.test", phone: "9876543212", password: "CustomerTestPass123!"
  });
  const second = await post(base, "/api/auth/register", {
    name: "Second Customer", email: "second@example.test", phone: "9876543213", password: "CustomerTestPass123!"
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstAccount = await first.json();
  const secondAccount = await second.json();

  db.prepare("INSERT INTO orders (order_number, created_at, items_json, total, user_id) VALUES (?, ?, '[]', 200, ?)")
    .run("FH-FIRST0001", new Date().toISOString(), firstAccount.user.id);
  db.prepare("INSERT INTO orders (order_number, created_at, items_json, total, user_id) VALUES (?, ?, '[]', 300, ?)")
    .run("FH-SECOND001", new Date().toISOString(), secondAccount.user.id);

  const firstOrders = await fetch(base + "/api/auth/orders", {
    headers: { Authorization: "Bearer " + firstAccount.token }
  });
  const firstPayload = await firstOrders.json();
  assert.equal(firstOrders.status, 200);
  assert.deepEqual(firstPayload.orders.map(order => order.orderNumber), ["FH-FIRST0001"]);

  const saved = await post(base, "/api/auth/addresses", {
    label: "Home", address: validAddressFixture()
  }, firstAccount.token);
  assert.equal(saved.status, 201);
  const savedAddress = await saved.json();

  const secondAddresses = await fetch(base + "/api/auth/addresses", {
    headers: { Authorization: "Bearer " + secondAccount.token }
  });
  assert.equal(secondAddresses.status, 200);
  assert.equal((await secondAddresses.json()).addresses.length, 0);

  const crossAccountDelete = await fetch(base + "/api/auth/addresses/" + savedAddress.id, {
    method: "DELETE", headers: { Authorization: "Bearer " + secondAccount.token }
  });
  assert.equal(crossAccountDelete.status, 404);
  const firstAddresses = await fetch(base + "/api/auth/addresses", {
    headers: { Authorization: "Bearer " + firstAccount.token }
  });
  assert.equal((await firstAddresses.json()).addresses.length, 1);
});

test("coupon validation is database-backed and usage can be released", async t => {
  const { backend, db } = await fixture(t);
  assert.equal(backend.calculateCoupon("FOOD25", 300).discount, 75);
  assert.throws(() => backend.calculateCoupon("FOOD25", 200), /minimum subtotal/i);
  backend.claimCoupon("FOOD25", "FH-COUPON-TEST");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 1);
  backend.releaseCoupon("FH-COUPON-TEST");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 0);
});

test("inventory is reserved atomically and restored on cancellation", async t => {
  const { backend, db } = await fixture(t);
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory("FH-STOCK-TEST", [{ productId: "test-bowl", quantity: 2 }], null);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 3);
  backend.releaseInventory("FH-STOCK-TEST");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 5);
});

test("JWT verification rejects altered, non-canonical and oversized tokens", async () => {
  const secret = "this-is-a-long-test-signing-secret";
  const token = createProductionBackend.signToken({ sub: "user-1", role: "customer", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  assert.equal(createProductionBackend.verifyToken(token, secret).sub, "user-1");
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  assert.equal(createProductionBackend.verifyToken(parts.join("."), secret), null);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const signature = token.split(".")[2];
  const lastIndex = alphabet.indexOf(signature.at(-1));
  const equivalentIndex = alphabet.split("").findIndex((character, index) =>
    index !== lastIndex && (index >> 2) === (lastIndex >> 2)
  );
  assert.notEqual(equivalentIndex, -1);
  const equivalentSignature = signature.slice(0, -1) + alphabet[equivalentIndex];
  assert.deepEqual(
    Buffer.from(equivalentSignature, "base64url"),
    Buffer.from(signature, "base64url")
  );
  const nonCanonical = token.split(".");
  nonCanonical[2] = equivalentSignature;
  assert.equal(createProductionBackend.verifyToken(nonCanonical.join("."), secret), null);
  assert.equal(createProductionBackend.verifyToken(token + "x".repeat(8192), secret), null);
  assert.equal(createProductionBackend.verifyToken(token + "=", secret), null);
});

test("customer registration rolls back the account and session when audit persistence fails", async t => {
  const { base, db } = await fixture(t);
  db.exec("CREATE TRIGGER reject_customer_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END;");
  const response = await post(base, "/api/auth/register", {
    name: "Atomic Customer", email: "atomic@example.test",
    phone: "9876543211", password: "CustomerTestPass123!"
  });
  assert.equal(response.status, 500);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?").get("atomic@example.test").count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 0);
});


test("registration and saved addresses reject malformed customer input", async t => {
  const { base } = await fixture(t);
  const malformedBody = await post(base, "/api/auth/register", []);
  assert.equal(malformedBody.status, 400);

  const invalidName = await post(base, "/api/auth/register", {
    name: "123456", email: "customer@example.test", phone: "9876543210", password: "CustomerTestPass123!"
  });
  assert.equal(invalidName.status, 400);

  const unexpectedRegistrationField = await post(base, "/api/auth/register", {
    name: "Test Customer", email: "customer@example.test", phone: "9876543210",
    password: "CustomerTestPass123!", role: "admin"
  });
  assert.equal(unexpectedRegistrationField.status, 400);

  const invalidPhone = await post(base, "/api/auth/register", {
    name: "Test Customer", email: "customer@example.test", phone: "abc9876543210", password: "CustomerTestPass123!"
  });
  assert.equal(invalidPhone.status, 400);

  const created = await post(base, "/api/auth/register", {
    name: "Test Customer", email: "customer@example.test", phone: "+91 98765 43210", password: "CustomerTestPass123!"
  });
  assert.equal(created.status, 201);
  const account = await created.json();
  const invalidAddress = await post(base, "/api/auth/addresses", {
    label: "Home",
    address: {
      house: "B-204", street: "Park Street", area: "Shastri Nagar",
      town: "Meerut", city: "Meerut", district: "Meerut",
      state: "Uttar Pradesh", pincode: "25A001"
    }
  }, account.token);
  assert.equal(invalidAddress.status, 400);

  const unexpectedAddressField = await post(base, "/api/auth/addresses", {
    label: "Home", address: { ...validAddressFixture(), country: "India" }
  }, account.token);
  assert.equal(unexpectedAddressField.status, 400);

  const validAddress = await post(base, "/api/auth/addresses", {
    label: "Home",
    address: {
      house: "B-204", building: "Green Residency", street: "Park Street", area: "Shastri Nagar",
      town: "Meerut", city: "Meerut", district: "Meerut",
      state: "Uttar Pradesh", pincode: "250001"
    }
  }, account.token);
  assert.equal(validAddress.status, 201);
});

test("admin menu, inventory and coupon APIs reject string coercion and invalid fields", async t => {
  const { base } = await fixture(t);
  const login = await post(base, "/api/admin/auth/login", {
    email: "admin@example.test", password: "FoodieHubTestPass123!"
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;

  const invalidMenu = await post(base, "/api/admin/menu", {
    id: "invalid-menu", name: "Test Pasta", category: "Pasta", price: "249"
  }, token);
  assert.equal(invalidMenu.status, 400);

  const invalidBoolean = await post(base, "/api/admin/menu", {
    id: "invalid-menu", name: "Test Pasta", category: "Pasta", price: 249,
    originalPrice: 299, prepTime: 18, isVeg: "false"
  }, token);
  assert.equal(invalidBoolean.status, 400);

  const validMenu = await post(base, "/api/admin/menu", {
    id: "fresh-pasta", name: "Fresh Pasta", category: "Pasta", price: 249,
    originalPrice: 299, prepTime: 18, isVeg: true, featured: false,
    description: "Fresh pasta with sauce", badge: "Chef pick",
    tags: ["fresh", "pasta"], image: "https://images.example.test/pasta.jpg"
  }, token);
  assert.equal(validMenu.status, 201);

  const invalidStock = await fetch(base + "/api/admin/inventory/test-bowl", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ quantity: "4" })
  });
  assert.equal(invalidStock.status, 400);

  const unexpectedStockField = await fetch(base + "/api/admin/inventory/test-bowl", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ quantity: 4, trackingMode: "counted" })
  });
  assert.equal(unexpectedStockField.status, 400);

  const validStock = await fetch(base + "/api/admin/inventory/test-bowl", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ quantity: 4 })
  });
  assert.equal(validStock.status, 200);

  const invalidCoupon = await post(base, "/api/admin/coupons", {
    code: "TEST20", discountType: "percent", discountValue: "20", minimumOrder: 200
  }, token);
  assert.equal(invalidCoupon.status, 400);

  const unexpectedCouponField = await post(base, "/api/admin/coupons", {
    code: "TEST20", discountType: "percent", discountValue: 20,
    minimumOrder: 200, maxDiscount: 80, maxUses: 10, hiddenAdmin: true
  }, token);
  assert.equal(unexpectedCouponField.status, 400);

  const validCoupon = await post(base, "/api/admin/coupons", {
    code: "TEST20", discountType: "percent", discountValue: 20,
    minimumOrder: 200, maxDiscount: 80, maxUses: 10
  }, token);
  assert.equal(validCoupon.status, 201);
});


test("expired pending payment releases its inventory and coupon exactly once", async t => {
  const { backend, db } = await fixture(t);
  const orderNumber = "FH-EXPIRE-1234";
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory(orderNumber, [{ productId: "test-bowl", quantity: 2 }], 20);
  backend.claimCoupon("FOOD25", orderNumber);
  db.prepare("INSERT INTO orders (order_number, created_at, status, payment_status, items_json, total, coupon_code) VALUES (?, ?, 'payment_pending', 'created', '[]', 200, 'FOOD25')")
    .run(orderNumber, new Date().toISOString());
  db.prepare("UPDATE order_inventory SET expires_at = ? WHERE order_number = ?")
    .run(new Date(Date.now() - 60_000).toISOString(), orderNumber);

  backend.expirePaymentReservations();
  backend.expirePaymentReservations();

  assert.equal(db.prepare("SELECT status FROM orders WHERE order_number = ?").get(orderNumber).status, "failed");
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE order_number = ?").get(orderNumber).payment_status, "expired");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 5);
  assert.equal(db.prepare("SELECT status FROM order_inventory WHERE order_number = ?").get(orderNumber).status, "released");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 0);
});

test("reservation expiry never releases inventory for an already-paid payment state", async t => {
  const { backend, db } = await fixture(t);
  const orderNumber = "FH-PAID-EXPIRY";
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory(orderNumber, [{ productId: "test-bowl", quantity: 2 }], 20);
  backend.claimCoupon("FOOD25", orderNumber);
  db.prepare("INSERT INTO orders (order_number, created_at, status, payment_status, items_json, total, coupon_code) VALUES (?, ?, 'payment_pending', 'paid', '[]', 200, 'FOOD25')")
    .run(orderNumber, new Date().toISOString());
  db.prepare("UPDATE order_inventory SET expires_at = ? WHERE order_number = ?")
    .run(new Date(Date.now() - 60_000).toISOString(), orderNumber);

  backend.expirePaymentReservations();

  assert.equal(db.prepare("SELECT status FROM orders WHERE order_number = ?").get(orderNumber).status, "payment_pending");
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE order_number = ?").get(orderNumber).payment_status, "paid");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 3);
  assert.equal(db.prepare("SELECT status FROM order_inventory WHERE order_number = ?").get(orderNumber).status, "held");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 1);
});

test("payment capture and failure transitions are conditional and idempotent", async t => {
  const { backend, db } = await fixture(t);
  const orderNumber = "FH-LIFECYCLE-TEST";
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory(orderNumber, [{ productId: "test-bowl", quantity: 2 }], 20);
  backend.claimCoupon("FOOD25", orderNumber);
  db.prepare("INSERT INTO orders (order_number, created_at, status, payment_status, items_json, total, coupon_code) VALUES (?, ?, 'payment_pending', 'created', '[]', 200, 'FOOD25')")
    .run(orderNumber, new Date().toISOString());

  assert.equal(paymentLifecycle.applyPaymentCapture(db, backend, orderNumber, "pay_lifecycle_1"), "confirmed");
  assert.equal(paymentLifecycle.applyPaymentCapture(db, backend, orderNumber, "pay_lifecycle_1"), "already_paid");
  assert.equal(paymentLifecycle.applyPaymentFailure(db, backend, orderNumber), "already_paid");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_number = ?").get(orderNumber).status, "confirmed");
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE order_number = ?").get(orderNumber).payment_status, "paid");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 3);
  assert.equal(db.prepare("SELECT status FROM order_inventory WHERE order_number = ?").get(orderNumber).status, "consumed");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 1);
});

test("payment failure releases pending reservations once and late capture requests refund", async t => {
  const { backend, db } = await fixture(t);
  const orderNumber = "FH-LATE-CAPTURE";
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory(orderNumber, [{ productId: "test-bowl", quantity: 2 }], 20);
  backend.claimCoupon("FOOD25", orderNumber);
  db.prepare("INSERT INTO orders (order_number, created_at, status, payment_status, items_json, total, coupon_code) VALUES (?, ?, 'payment_pending', 'created', '[]', 200, 'FOOD25')")
    .run(orderNumber, new Date().toISOString());

  assert.equal(paymentLifecycle.applyPaymentFailure(db, backend, orderNumber), "failed");
  assert.equal(paymentLifecycle.applyPaymentFailure(db, backend, orderNumber), "unchanged");
  assert.equal(paymentLifecycle.applyPaymentCapture(db, backend, orderNumber, "pay_late_capture"), "refund_required");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_number = ?").get(orderNumber).status, "failed");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 5);
  assert.equal(db.prepare("SELECT status FROM order_inventory WHERE order_number = ?").get(orderNumber).status, "released");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 0);
});

test("late payment.failed webhook cannot release inventory or coupons for a paid order", async t => {
  const { base, db, backend } = await fixture(t);
  const secret = "foodiehub-webhook-test-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  const orderNumber = "FH-AB12CD34";
  const gatewayOrderId = "order_paid_late_failure";

  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory(orderNumber, [{ productId: "test-bowl", quantity: 2 }], null);
  backend.consumeInventory(orderNumber);
  backend.claimCoupon("FOOD25", orderNumber);
  db.prepare("INSERT INTO orders (order_number, created_at, status, payment_status, items_json, gateway_order_id, total, coupon_code) VALUES (?, ?, 'confirmed', 'paid', '[]', ?, 200, 'FOOD25')")
    .run(orderNumber, new Date().toISOString(), gatewayOrderId);

  const payload = {
    event: "payment.failed",
    payload: { payment: { entity: {
      id: "pay_late_failure", order_id: gatewayOrderId, amount: 20000, currency: "INR", status: "failed"
    } } }
  };
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const response = await fetch(base + "/api/payments/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": "evt_paid_then_failed"
    },
    body: rawBody
  });

  assert.equal(response.status, 200);
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE order_number = ?").get(orderNumber).payment_status, "paid");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 3);
  assert.equal(db.prepare("SELECT status FROM order_inventory WHERE order_number = ?").get(orderNumber).status, "consumed");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 1);
});

test("payment.failed webhook releases reservations only while checkout is pending", async t => {
  const { base, db, backend } = await fixture(t);
  const secret = "foodiehub-webhook-test-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  const orderNumber = "FH-CD34EF56";
  const gatewayOrderId = "order_pending_failure";

  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory(orderNumber, [{ productId: "test-bowl", quantity: 2 }], 20);
  backend.claimCoupon("FOOD25", orderNumber);
  db.prepare("INSERT INTO orders (order_number, created_at, status, payment_status, items_json, gateway_order_id, total, coupon_code) VALUES (?, ?, 'payment_pending', 'created', '[]', ?, 200, 'FOOD25')")
    .run(orderNumber, new Date().toISOString(), gatewayOrderId);

  const payload = {
    event: "payment.failed",
    payload: { payment: { entity: {
      id: "pay_pending_failure", order_id: gatewayOrderId, amount: 20000, currency: "INR", status: "failed"
    } } }
  };
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const response = await fetch(base + "/api/payments/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": "evt_pending_failed"
    },
    body: rawBody
  });

  assert.equal(response.status, 200);
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE order_number = ?").get(orderNumber).payment_status, "failed");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_number = ?").get(orderNumber).status, "failed");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 5);
  assert.equal(db.prepare("SELECT status FROM order_inventory WHERE order_number = ?").get(orderNumber).status, "released");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 0);
});
