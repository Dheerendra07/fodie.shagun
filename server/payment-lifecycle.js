"use strict";

const PENDING_PAYMENT_STATES = new Set(["created", "authorized", "pending"]);
const REFUND_STATES = new Set(["failed", "expired", "refund_required"]);

function getPaymentState(db, orderNumber) {
  return db.prepare("SELECT order_number, status, payment_status, razorpay_payment_id FROM orders WHERE order_number = ?")
    .get(orderNumber) || null;
}

function applyPaymentFailure(db, backend, orderNumber) {
  return db.transaction(() => {
    const current = getPaymentState(db, orderNumber);
    if (!current) return "not_found";
    if (current.payment_status === "paid") return "already_paid";
    if (current.payment_status === "refunded") return "already_refunded";

    const failed = db.prepare([
      "UPDATE orders SET status = 'failed', payment_status = 'failed'",
      "WHERE order_number = ? AND status = 'payment_pending'",
      "AND payment_status IN ('created', 'authorized', 'pending')"
    ].join(" ")).run(orderNumber);
    if (!failed.changes) return "unchanged";

    backend.releaseInventory(orderNumber);
    backend.releaseCoupon(orderNumber);
    return "failed";
  })();
}

function applyPaymentCapture(db, backend, orderNumber, paymentId) {
  return db.transaction(() => {
    const current = getPaymentState(db, orderNumber);
    if (!current) return "not_found";
    if (current.payment_status === "paid") return "already_paid";
    if (current.payment_status === "refunded") return "already_refunded";
    if (["failed", "cancelled"].includes(current.status) || REFUND_STATES.has(current.payment_status)) {
      return "refund_required";
    }
    if (current.status !== "payment_pending" || !PENDING_PAYMENT_STATES.has(current.payment_status)) {
      return "conflict";
    }

    const captured = db.prepare([
      "UPDATE orders SET status = 'confirmed', payment_status = 'paid', razorpay_payment_id = ?",
      "WHERE order_number = ? AND status = 'payment_pending'",
      "AND payment_status IN ('created', 'authorized', 'pending')"
    ].join(" ")).run(paymentId || null, orderNumber);
    if (!captured.changes) return "conflict";

    backend.consumeInventory(orderNumber);
    return "confirmed";
  })();
}

module.exports = { getPaymentState, applyPaymentFailure, applyPaymentCapture };
