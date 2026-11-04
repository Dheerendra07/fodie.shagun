(() => {
  "use strict";

  const STATES = new Set([
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
    "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
    "Ladakh", "Lakshadweep", "Puducherry"
  ]);
  const ADDRESS_FIELDS = [
    "house", "building", "street", "area", "landmark",
    "town", "city", "district", "state", "pincode"
  ];
  const REQUIRED_ADDRESS = ["house", "street", "area", "town", "city", "district", "state", "pincode"];

  function result(error, field, value) {
    return error ? { valid: false, error, field: field || "" } : { valid: true, value };
  }

  function text(value, label, min, max, required = true, pattern = null) {
    if (value === undefined || value === null) {
      return required ? label + " is required." : "";
    }
    if (typeof value !== "string") return label + " must be text.";
    const normalized = value.normalize("NFC").trim().replace(/[ \t]+/g, " ");
    if (!normalized && !required) return "";
    if (normalized.length < min || normalized.length > max) {
      return label + " must contain " + min + " to " + max + " characters.";
    }
    if (/[\u0000-\u001F\u007F]/.test(normalized)) return label + " contains unsupported characters.";
    if (pattern && !pattern.test(normalized)) return label + " contains unsupported characters.";
    return normalized;
  }

  function name(value, required = true) {
    const normalized = text(value, "Full name", 2, 80, required);
    if (typeof normalized !== "string" || !normalized) return normalized;
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$/u.test(normalized) ||
        (normalized.match(/\p{L}/gu) || []).length < 2) {
      return "Full name must use letters with normal spaces, apostrophes, periods or hyphens.";
    }
    return normalized;
  }

  function phone(value, required = true) {
    if (value === undefined || value === null || value === "") return required ? "Mobile number is required." : "";
    if (typeof value !== "string") return "Mobile number must be entered as text.";
    const raw = value.trim();
    if (!raw || !/^\+?[0-9\s()-]+$/.test(raw)) return "Enter a valid 10-digit Indian mobile number.";
    let digits = raw.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    return /^[6-9]\d{9}$/.test(digits) ? digits : "Enter a valid 10-digit Indian mobile number.";
  }

  function email(value, required = false) {
    if (value === undefined || value === null || value === "") return required ? "Email address is required." : "";
    const normalized = text(value, "Email address", 3, 254, true);
    if (typeof normalized !== "string" || !normalized) return normalized;
    const parts = normalized.split("@");
    if (parts.length !== 2 || parts[0].length > 64 ||
        parts[0].startsWith(".") || parts[0].endsWith(".") || parts[0].includes("..") ||
        !/^[A-Z0-9.!#$%&'*+/=?^_{|}~-]+$/i.test(parts[0]) ||
        !/^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(parts[1])) {
      return "Enter a valid email address.";
    }
    return normalized.toLowerCase();
  }

  function address(input, required = true) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { error: "Delivery address must be a valid object.", field: "house" };
    }
    const unknown = Object.keys(input).filter(field => !ADDRESS_FIELDS.includes(field));
    if (unknown.length) return { error: "Delivery address contains unsupported fields: " + unknown.join(", ") + ".", field: unknown[0] };
    const data = input;
    const hasAnyValue = ADDRESS_FIELDS.some(field => String(data[field] || "").trim());
    if (required && !input) return { error: "Complete your delivery address.", field: "house" };
    if (!required && !hasAnyValue) return { value: Object.fromEntries(ADDRESS_FIELDS.map(field => [field, ""])) };

    const value = {};
    const limits = {
      house: [1, 80], building: [0, 100], street: [2, 120], area: [2, 120],
      landmark: [0, 120], town: [2, 100], city: [2, 100], district: [2, 100],
      state: [2, 60], pincode: [6, 6]
    };
    for (const field of ADDRESS_FIELDS) {
      const [min, max] = limits[field];
      const isRequired = required && REQUIRED_ADDRESS.includes(field);
      const fieldLabel = field === "pincode" ? "PIN code" : field[0].toUpperCase() + field.slice(1);
      const normalized = text(data[field] || "", fieldLabel,
        min, max, isRequired || Boolean(data[field]),
        field === "pincode" ? /^[1-9]\d{5}$/ : field === "state" ? null : /^[\p{L}\p{M}\p{N} .,'/#()&-]*$/u);
      if (typeof normalized !== "string" || normalized.startsWith(fieldLabel + " ")) {
        return { error: normalized, field };
      }
      if (field === "state" && normalized && !STATES.has(normalized)) {
        return { error: "Select a valid Indian state or Union Territory.", field };
      }
      value[field] = normalized;
    }
    return { value };
  }

  function profile(input) {
    const source = input || {};
    const normalizedName = name(source.name, false);
    if (!normalizedName && source.name) return result("Enter a valid full name.", "name");
    if (typeof normalizedName === "string" && normalizedName.startsWith("Full name ")) return result(normalizedName, "name");
    const normalizedPhone = phone(source.phone, false);
    if (typeof normalizedPhone !== "string" || (source.phone && normalizedPhone.startsWith("Enter ")) || normalizedPhone.startsWith("Mobile number ")) {
      return result(typeof normalizedPhone === "string" ? normalizedPhone : "Enter a valid mobile number.", "phone");
    }
    const normalizedEmail = email(source.email, false);
    if (typeof normalizedEmail !== "string" || (source.email && (normalizedEmail.startsWith("Enter ") || normalizedEmail.startsWith("Email address ")))) {
      return result(typeof normalizedEmail === "string" ? normalizedEmail : "Enter a valid email address.", "email");
    }
    const checkedAddress = address(source.addressDetails || {}, false);
    if (checkedAddress.error) return result(checkedAddress.error, checkedAddress.field);
    if (!normalizedName && !normalizedPhone && !normalizedEmail &&
        !ADDRESS_FIELDS.some(field => checkedAddress.value[field])) {
      return result("Add at least one profile detail before saving.", "name");
    }
    return result("", "", {
      name: normalizedName || "",
      phone: normalizedPhone || "",
      email: normalizedEmail || "",
      addressDetails: checkedAddress.value
    });
  }

  function checkout(input) {
    const source = input || {};
    const normalizedName = name(source.name, true);
    if (typeof normalizedName !== "string" || normalizedName.startsWith("Full name ")) {
      return result(typeof normalizedName === "string" ? normalizedName : "Enter a valid full name.", "name");
    }
    const normalizedPhone = phone(source.phone, true);
    if (typeof normalizedPhone !== "string" || normalizedPhone.startsWith("Enter ") || normalizedPhone.startsWith("Mobile number ")) {
      return result(typeof normalizedPhone === "string" ? normalizedPhone : "Enter a valid mobile number.", "phone");
    }
    const normalizedEmail = email(source.email, false);
    if (typeof normalizedEmail !== "string" || normalizedEmail.startsWith("Enter ") || normalizedEmail.startsWith("Email address ")) {
      return result(typeof normalizedEmail === "string" ? normalizedEmail : "Enter a valid email address.", "email");
    }
    const checkedAddress = address(source.addressDetails, true);
    if (checkedAddress.error) return result(checkedAddress.error, checkedAddress.field);
    if (!["cod", "upi_at_door", "razorpay"].includes(source.paymentMethod)) {
      return result("Choose a valid payment method.", "paymentMethod");
    }
    return result("", "", {
      name: normalizedName,
      phone: normalizedPhone,
      email: normalizedEmail || "",
      addressDetails: checkedAddress.value,
      paymentMethod: source.paymentMethod
    });
  }

  function tracking(orderNumber, mobile) {
    const number = typeof orderNumber === "string" ? orderNumber.trim().toUpperCase() : "";
    if (!/^FH-[A-Z0-9]{8}$/.test(number)) return result("Enter a valid FoodieHub order number.", "orderNumber");
    const normalizedPhone = phone(mobile, true);
    if (typeof normalizedPhone !== "string" || normalizedPhone.startsWith("Enter ") || normalizedPhone.startsWith("Mobile number ")) {
      return result(typeof normalizedPhone === "string" ? normalizedPhone : "Enter a valid mobile number.", "phone");
    }
    return result("", "", { orderNumber: number, phone: normalizedPhone });
  }

  function coupon(value) {
    const code = typeof value === "string" ? value.trim().toUpperCase() : "";
    return /^[A-Z0-9_-]{3,24}$/.test(code) ? { valid: true, value: code } : { valid: false, error: "Enter a coupon code using 3–24 letters, numbers, hyphens or underscores." };
  }

  function note(value) {
    const normalized = text(value, "Kitchen note", 0, 180, false);
    if (typeof normalized !== "string" || normalized.startsWith("Kitchen note ")) {
      return { valid: false, error: normalized };
    }
    return { valid: true, value: normalized };
  }

  window.FoodieHubValidation = Object.freeze({ name, phone, email, address, profile, checkout, tracking, coupon, note });
})();
