"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const validation = require("../server/validation");

const address = {
  house: "B-204",
  building: "Green Residency",
  street: "Park Street",
  area: "Shastri Nagar",
  landmark: "",
  town: "Meerut",
  city: "Meerut",
  district: "Meerut",
  state: "Uttar Pradesh",
  pincode: "250001"
};

test("validates customer names without accepting arbitrary input", () => {
  assert.equal(validation.validateName("Dheerendra Singh"), "Dheerendra Singh");
  assert.equal(validation.validateName("Aarav Kumar"), "Aarav Kumar");
  assert.throws(() => validation.validateName("123456"), /letters/i);
  assert.throws(() => validation.validateName("<script>"), /letters/i);
  assert.throws(() => validation.validateName("A"), /2 to 80/i);
  assert.throws(() => validation.validateName("Name\nInjected"), /control characters/i);
});

test("normalizes only valid Indian mobile number formats", () => {
  assert.equal(validation.normalizePhone("9876543210"), "9876543210");
  assert.equal(validation.normalizePhone("+91 98765 43210"), "9876543210");
  assert.equal(validation.normalizePhone("91-9876543210"), "9876543210");
  for (const value of ["abc9876543210", "1234567890", "987654321", "09876543210", "99999999999", "++919876543210"]) {
    assert.throws(() => validation.normalizePhone(value));
  }
});

test("validates email address length, syntax and domain", () => {
  assert.equal(validation.normalizeEmail("  Dheerendra@example.com  "), "dheerendra@example.com");
  for (const value of ["", "not-an-email", "a@b", "a..b@example.com", ".name@example.com", "name@example..com", "name@-example.com", "x".repeat(65) + "@example.com"]) {
    assert.throws(() => validation.normalizeEmail(value, "Email address", true));
  }
});

test("validates structured delivery address fields and allowed state values", () => {
  assert.deepEqual(validation.validateAddress(address), address);
  assert.throws(() => validation.validateAddress({ ...address, pincode: "25A001" }), /PIN code/i);
  assert.throws(() => validation.validateAddress({ ...address, state: "Somewhere" }), /state/i);
  assert.throws(() => validation.validateAddress({ ...address, street: " " }), /Street must contain/i);
  assert.throws(() => validation.validateAddress({ ...address, phone: "9876543210" }), /unsupported fields/i);
  assert.throws(() => validation.validateAddress({ ...address, city: "<b>Meerut</b>" }), /unsupported characters/i);
  assert.throws(() => validation.validateAddress(null), /JSON object/i);
});

test("validates address labels without silently truncating them", () => {
  assert.equal(validation.validateLabel("Home"), "Home");
  assert.throws(() => validation.validateLabel("A".repeat(31)), /1 to 30/i);
  assert.throws(() => validation.validateLabel("<img>"), /unsupported characters/i);
});

test("validates complete customer data and strict FoodieHub order numbers", () => {
  const customer = validation.validateCustomer({
    name: "Dheerendra Singh",
    phone: "+91 98765 43210",
    email: "Dheerendra@example.com",
    addressDetails: address
  });
  assert.equal(customer.phone, "9876543210");
  assert.equal(customer.email, "dheerendra@example.com");
  assert.match(customer.address, /Uttar Pradesh - 250001/);
  assert.throws(() => validation.validateCustomer({ name: "Customer", phone: "abc9876543210", email: "", addressDetails: address }));
  assert.equal(validation.validateOrderNumber("fh-a1b2c3d4"), "FH-A1B2C3D4");
  assert.throws(() => validation.validateOrderNumber("anything-at-all"));
});


test("browser form validators reject incomplete or malformed field values", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../assets/js/validation.js"), "utf8"), browser);
  const client = browser.window.FoodieHubValidation;

  const profile = client.profile({
    name: "Dheerendra Singh",
    phone: "+91 98765 43210",
    email: "dheerendra@example.com",
    addressDetails: {}
  });
  assert.equal(profile.valid, true);
  assert.equal(profile.value.phone, "9876543210");

  const badProfile = client.profile({
    name: "12345",
    phone: "abc9876543210",
    email: "not-an-email",
    addressDetails: {}
  });
  assert.equal(badProfile.valid, false);

  const checkout = client.checkout({
    name: "Dheerendra Singh",
    phone: "9876543210",
    email: "",
    addressDetails: address,
    paymentMethod: "cod"
  });
  assert.equal(checkout.valid, true);

  const badCheckout = client.checkout({
    name: "Dheerendra123",
    phone: "9876543210",
    email: "",
    addressDetails: { ...address, pincode: "25A001" },
    paymentMethod: "cash"
  });
  assert.equal(badCheckout.valid, false);

  assert.equal(client.tracking("FH-A1B2C3D4", "9876543210").valid, true);
  assert.equal(client.tracking("FH-NOT-VALID", "9876543210").valid, false);
  assert.equal(client.coupon("hub50").value, "HUB50");
  assert.equal(client.coupon("bad code").valid, false);
  assert.equal(client.note("Keep sauce aside").valid, true);
  assert.equal(client.note("x".repeat(181)).valid, false);
});
