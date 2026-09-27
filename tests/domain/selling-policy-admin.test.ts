import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import type { SellingModeFlags, SellingPolicyChange } from "../../src/commerce/selling-policy.ts";
import { createSellingPolicyAdminService } from "../../src/commerce/selling-policy-admin.ts";

const admin = { user: { id: "admin-1", role: "ADMIN" }, session: { id: "s-1" } };

function harness(options: { flags?: SellingModeFlags; exists?: boolean; composite?: boolean } = {}) {
  const saved: { productId: string; change: SellingPolicyChange; actor: string }[] = [];
  const service = createSellingPolicyAdminService({
    readFlags: () => options.flags ?? { sellingModesEnabled: true, preorderEnabled: true },
    productExists: async () => options.exists ?? true,
    productHasCompositeParent: async () => options.composite ?? false,
    saveSellingPolicy: async (productId, change, actor) => {
      saved.push({ productId, change, actor });
    },
  });
  return { service, saved };
}

test("a valid change is saved with the actor from the session, never from the input", async () => {
  const { service, saved } = harness();
  const result = await service.update(admin, {
    productId: "p-1",
    sellingMode: "OVERSELL",
    negativeStockLimit: "-15",
    // An attacker-controlled field is simply not read.
    ...({ updatedByUserId: "someone-else" } as object),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(saved, [
    { productId: "p-1", change: { kind: "SET", sellingMode: "OVERSELL", negativeStockLimit: -15 }, actor: "admin-1" },
  ]);
});

test("non-admins and anonymous callers are refused before anything is read", async () => {
  const { service, saved } = harness();
  for (const session of [null, { user: { id: "u", role: "CUSTOMER" }, session: { id: "s" } }]) {
    await assert.rejects(
      service.update(session, { productId: "p-1", sellingMode: "STANDARD", negativeStockLimit: "0" }),
      AuthorizationError,
    );
  }
  assert.equal(saved.length, 0);
});

test("non-STANDARD modes are refused while SELLING_MODES_ENABLED is off; STANDARD and reset are not", async () => {
  const { service, saved } = harness({ flags: { sellingModesEnabled: false, preorderEnabled: true } });
  for (const sellingMode of ["OVERSELL", "PREORDER"]) {
    assert.deepEqual(
      await service.update(admin, { productId: "p-1", sellingMode, negativeStockLimit: "-20" }),
      { ok: false, reason: "SELLING_MODES_DISABLED" },
    );
  }
  assert.deepEqual(
    await service.update(admin, { productId: "p-1", sellingMode: "STANDARD", negativeStockLimit: "-20" }),
    { ok: true },
  );
  assert.deepEqual(
    await service.update(admin, { productId: "p-1", sellingMode: "DEFAULT", negativeStockLimit: "" }),
    { ok: true },
  );
  assert.deepEqual(saved.map((entry) => entry.change.kind), ["SET", "RESET"]);
});

test("PREORDER is refused unless the preorder flag is also on", async () => {
  const { service } = harness({ flags: { sellingModesEnabled: true, preorderEnabled: false } });
  assert.deepEqual(
    await service.update(admin, { productId: "p-1", sellingMode: "PREORDER", negativeStockLimit: "-20" }),
    { ok: false, reason: "PREORDER_DISABLED" },
  );
  assert.deepEqual(
    await service.update(admin, { productId: "p-1", sellingMode: "OVERSELL", negativeStockLimit: "-20" }),
    { ok: true },
  );
});

test("a product with a composite parent variant may only be STANDARD", async () => {
  const { service, saved } = harness({ composite: true });
  for (const sellingMode of ["OVERSELL", "PREORDER"]) {
    assert.deepEqual(
      await service.update(admin, { productId: "p-1", sellingMode, negativeStockLimit: "-20" }),
      { ok: false, reason: "COMPOSITE_MODE_UNSUPPORTED" },
    );
  }
  assert.deepEqual(
    await service.update(admin, { productId: "p-1", sellingMode: "STANDARD", negativeStockLimit: "0" }),
    { ok: true },
  );
  assert.equal(saved.length, 1);
});

test("out-of-range limits, unknown modes and bad product ids are INVALID_INPUT; missing products are reported", async () => {
  const { service, saved } = harness();
  for (const input of [
    { productId: "p-1", sellingMode: "OVERSELL", negativeStockLimit: "1" },
    { productId: "p-1", sellingMode: "OVERSELL", negativeStockLimit: "-100001" },
    { productId: "p-1", sellingMode: "BACKORDER", negativeStockLimit: "-1" },
    { productId: " p-1", sellingMode: "STANDARD", negativeStockLimit: "0" },
    { productId: "", sellingMode: "STANDARD", negativeStockLimit: "0" },
  ]) {
    assert.deepEqual(await service.update(admin, input), { ok: false, reason: "INVALID_INPUT" }, JSON.stringify(input));
  }
  const missing = harness({ exists: false });
  assert.deepEqual(
    await missing.service.update(admin, { productId: "p-9", sellingMode: "STANDARD", negativeStockLimit: "0" }),
    { ok: false, reason: "PRODUCT_NOT_FOUND" },
  );
  assert.equal(saved.length + missing.saved.length, 0);
});
