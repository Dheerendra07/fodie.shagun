"use strict";

const INDIAN_STATES = new Set([
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry"
]);

const ADDRESS_FIELDS = Object.freeze([
  "house", "building", "street", "area", "landmark",
  "town", "city", "district", "state", "pincode"
]);
const REQUIRED_ADDRESS_FIELDS = Object.freeze([
  "house", "street", "area", "town", "city", "district", "state", "pincode"
]);
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  confirmed: Object.freeze(["preparing", "cancelled"]),
  preparing: Object.freeze(["out_for_delivery"]),
  out_for_delivery: Object.freeze(["delivered"])
});

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, label = "Request body") {
  if (!isPlainObject(value)) invalid(label + " must be a JSON object.");
  return value;
}

function rejectUnknownFields(value, allowedFields, label = "Request") {
  const source = requireObject(value, label);
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(source).filter(key => !allowed.has(key));
  if (unknown.length) invalid(label + " contains unsupported fields: " + unknown.join(", ") + ".");
  return source;
}

function cleanString(value, label, options = {}) {
  const { min = 0, max = 500, required = true, pattern, allowNewlines = false } = options;
  if (value === undefined || value === null) {
    if (!required) return "";
    invalid(label + " is required.");
  }
  if (typeof value !== "string") invalid(label + " must be text.");
  const normalized = value.normalize("NFC").trim().replace(/[ \t]+/g, " ");
  if (!normalized && !required) return "";
  if (normalized.length < min || normalized.length > max) {
    invalid(label + " must contain " + min + " to " + max + " characters.");
  }
  const controls = allowNewlines ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/;
  if (controls.test(normalized)) invalid(label + " contains unsupported control characters.");
  if (pattern && !pattern.test(normalized)) invalid(label + " contains unsupported characters.");
  return normalized;
}

function validateName(value, label = "Name") {
  const name = cleanString(value, label, { min: 2, max: 80 });
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$/u.test(name) ||
      (name.match(/\p{L}/gu) || []).length < 2) {
    invalid(label + " must use letters with normal spaces, apostrophes, periods or hyphens.");
  }
  return name;
}

function normalizeEmail(value, label = "Email address", required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) invalid(label + " is required.");
    return "";
  }
  const email = cleanString(value, label, { min: 3, max: 254 });
  const parts = email.split("@");
  if (parts.length !== 2 || parts[0].length > 64 ||
      parts[0].startsWith(".") || parts[0].endsWith(".") || parts[0].includes("..") ||
      !/^[A-Z0-9.!#$%&'*+/=?^_{|}~-]+$/i.test(parts[0]) ||
      !/^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(parts[1])) {
    invalid("Enter a valid " + label.toLowerCase() + ".");
  }
  return email.toLowerCase();
}

function normalizePhone(value, label = "Mobile number", required = true) {
  if (value === undefined || value === null || value === "") {
    if (required) invalid(label + " is required.");
    return "";
  }
  if (typeof value !== "string") invalid(label + " must be entered as text.");
  const raw = value.trim();
  if (!raw || !/^\+?[0-9\s()-]+$/.test(raw)) invalid("Enter a valid 10-digit Indian " + label.toLowerCase() + ".");
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) invalid("Enter a valid 10-digit Indian " + label.toLowerCase() + ".");
  return digits;
}

function validateAddress(input, options = {}) {
  const { required = true } = options;
  const source = requireObject(input === undefined || input === null ? (required ? input : {}) : input, "Delivery address");
  const unknown = Object.keys(source).filter(key => !ADDRESS_FIELDS.includes(key));
  if (unknown.length) invalid("Delivery address contains unsupported fields: " + unknown.join(", ") + ".");
  const hasAnyValue = ADDRESS_FIELDS.some(key => source[key] !== undefined && source[key] !== null && source[key] !== "");
  if (!required && !hasAnyValue) return Object.fromEntries(ADDRESS_FIELDS.map(key => [key, ""]));
  const result = {};
  for (const field of ADDRESS_FIELDS) {
    const isRequired = REQUIRED_ADDRESS_FIELDS.includes(field);
    const limits = {
      house: [1, 80], building: [0, 100], street: [2, 120], area: [2, 120],
      landmark: [0, 120], town: [2, 100], city: [2, 100], district: [2, 100],
      state: [2, 60], pincode: [6, 6]
    }[field];
    result[field] = cleanString(source[field], field === "pincode" ? "PIN code" : field[0].toUpperCase() + field.slice(1), {
      min: limits[0],
      max: limits[1],
      required: required && isRequired || Boolean(source[field]),
      pattern: field === "pincode"
        ? /^[1-9]\d{5}$/
        : field === "state"
          ? null
          : /^[\p{L}\p{M}\p{N} .,'/#()&-]*$/u
    });
  }
  if (result.state && !INDIAN_STATES.has(result.state)) invalid("Select a valid Indian state or Union Territory.");
  return result;
}

function validateCustomer(input) {
  const source = rejectUnknownFields(input, ["name", "phone", "email", "address", "addressDetails"], "Customer details");
  if (source.address !== undefined) cleanString(source.address, "Formatted delivery address", { min: 12, max: 500 });
  const name = validateName(source.name, "Full name");
  const phone = normalizePhone(source.phone);
  const email = normalizeEmail(source.email, "Email address", false);
  const addressDetails = validateAddress(source.addressDetails, { required: true });
  const places = [...new Set([addressDetails.town, addressDetails.city, addressDetails.district].filter(Boolean))];
  const address = [
    [addressDetails.house, addressDetails.building].filter(Boolean).join(", "),
    [addressDetails.street, addressDetails.area].filter(Boolean).join(", "),
    addressDetails.landmark ? "Near " + addressDetails.landmark : "",
    places.join(", "),
    addressDetails.state + " - " + addressDetails.pincode
  ].filter(Boolean).join(", ");
  if (address.length < 12 || address.length > 500) invalid("Please enter a complete delivery address.");
  return { name, phone, email, address, addressDetails };
}

function canTransitionOrderStatus(current, next) {
  if (typeof current !== "string" || typeof next !== "string") return false;
  if (current === next) return true;
  return Boolean(ORDER_STATUS_TRANSITIONS[current] && ORDER_STATUS_TRANSITIONS[current].includes(next));
}

function validateOrderNumber(value) {
  const number = cleanString(value, "Order number", { min: 11, max: 11 });
  if (!/^FH-[A-Z0-9]{8}$/.test(number.toUpperCase())) invalid("Enter a valid FoodieHub order number.");
  return number.toUpperCase();
}

function normalizeCouponCode(value, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) invalid("Coupon code is required.");
    return "";
  }
  if (typeof value !== "string") invalid("Coupon code must be text.");
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) invalid("Coupon code is required.");
    return "";
  }
  const code = cleanString(trimmed, "Coupon code", { min: 3, max: 24 });
  if (!/^[A-Z0-9_-]{3,24}$/i.test(code)) {
    invalid("Coupon code may contain only 3–24 letters, numbers, hyphens or underscores.");
  }
  return code.toUpperCase();
}

function validateLabel(value) {
  const label = cleanString(value, "Address label", { min: 1, max: 30 });
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} &'_-]*$/u.test(label)) {
    invalid("Address label contains unsupported characters.");
  }
  return label;
}

function validateEmail(value) {
  try {
    normalizeEmail(value, "Email address", true);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  ADDRESS_FIELDS,
  REQUIRED_ADDRESS_FIELDS,
  INDIAN_STATES,
  cleanString,
  isPlainObject,
  requireObject,
  rejectUnknownFields,
  validateName,
  normalizeEmail,
  normalizePhone,
  validateAddress,
  validateCustomer,
  canTransitionOrderStatus,
  normalizeCouponCode,
  validateOrderNumber,
  validateLabel,
  validateEmail
};
