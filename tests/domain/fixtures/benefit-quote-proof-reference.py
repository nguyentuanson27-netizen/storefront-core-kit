#!/usr/bin/env python3
"""Independent reference computation of `laq2` proofs for tests/domain/benefit-quote-proof.test.ts.

Deliberately written without reading src/commerce/benefit-quote-proof.ts: it follows only the accepted
spec (docs/specs/core-kit-benefit-quote-v1-technical-review.md section 2), so the test cannot confirm
the implementation's own mistakes. Standard library only. Run: python3 <this file>
The printed `proof=` values are pasted into the test as VECTORS; regenerate if the spec changes.
"""
import base64
import hashlib
import hmac

SECRET = "test-server-secret-at-least-32-characters-long"
CART_ID = "0f8d3c2a-4b1e-4d7a-9c6b-2e5f1a8d4c30"
KEY_CONTEXT = b"la-clothing:checkout-quote-proof-key:v2"


def pre(value):
    raw = value.encode("utf-8")
    return "%d:%s" % (len(raw), value)


def canonical(q):
    lines = sorted(q["lines"], key=lambda l: l["lineId"].encode("utf-8"))
    grants = sorted(q["grants"], key=lambda g: g["campaignId"].encode("utf-8"))
    out = "laq2|%d|%d|%d|%d|%d" % (
        q["paidQuantity"], q["paidSubtotalVnd"], q["shippingFeeVnd"], q["totalVnd"], len(lines))
    for l in lines:
        out += "|%s:%s:%s:%d:%d:%d:%s:%s" % (
            pre(l["lineId"]), l["role"], pre(l["variantExternalId"]), l["quantity"],
            l["unitPriceVnd"], l["lineTotalVnd"], pre(l["campaignId"] or ""), pre(l["entitlementKey"] or ""))
    out += "|%d" % len(grants)
    for g in grants:
        tier = -1 if g["tierIndex"] is None else g["tierIndex"]
        out += "|%s:%d:%d:%d:%d" % (
            pre(g["campaignId"]), g["eligiblePaidQuantity"], g["basisVnd"], tier, g["giftLineCount"])
    return out.encode("utf-8")


def proof(q):
    key = hmac.new(SECRET.encode(), KEY_CONTEXT, hashlib.sha256).digest()
    cart = CART_ID.encode()
    payload = canonical(q)
    mac = hmac.new(key, str(len(cart)).encode() + b":" + cart + payload, hashlib.sha256).digest()
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    return b64(payload) + "." + b64(mac)


def line(lid, role, var, qty, unit, camp=None, ent=None):
    return {"lineId": lid, "role": role, "variantExternalId": var, "quantity": qty,
            "unitPriceVnd": unit, "lineTotalVnd": qty * unit, "campaignId": camp, "entitlementKey": ent}


VECTORS = {
    # PAID X + GIFT X: same variant, two distinct signed lines.
    "paidAndGiftSameVariant": {
        "lines": [line("l1", "PAID", "var-x", 1, 500000, "camp-1"),
                  line("l2", "GIFT", "var-x", 1, 0, "camp-1", "gift-1")],
        "grants": [{"campaignId": "camp-1", "eligiblePaidQuantity": 1, "basisVnd": 500000,
                    "tierIndex": None, "giftLineCount": 1}],
        "paidQuantity": 1, "paidSubtotalVnd": 500000, "shippingFeeVnd": 30000, "totalVnd": 530000},
    # Ids made of the field delimiters, a reached tier, and an unsorted input order.
    "delimiterIdsAndTier": {
        "lines": [line("b|2:x", "PAID", "v:|9", 2, 400000, "c|:1"),
                  line("a|1", "PAID", "v|:8", 1, 650000)],
        "grants": [{"campaignId": "c|:1", "eligiblePaidQuantity": 2, "basisVnd": 800000,
                    "tierIndex": 2, "giftLineCount": 0}],
        "paidQuantity": 3, "paidSubtotalVnd": 1450000, "shippingFeeVnd": 0, "totalVnd": 1450000},
    # Benefit-shaped quote where no campaign was granted.
    "noGrant": {
        "lines": [line("only", "PAID", "var-a", 3, 100000)],
        "grants": [], "paidQuantity": 3, "paidSubtotalVnd": 300000, "shippingFeeVnd": 30000, "totalVnd": 330000},
}

if __name__ == "__main__":
    for name, q in VECTORS.items():
        print("%s\nproof=%s\n" % (name, proof(q)))
