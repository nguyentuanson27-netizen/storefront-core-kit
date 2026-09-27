# Spec — Core Kit Selling Modes v1

Status: **PROPOSED. Human review is required before planning or implementation.**

Base: `storefront-core-kit/main@c3d421e` (after nguyentuanson27-netizen/storefront-core-kit#20).

This spec is written for `storefront-core-kit` only. The Lana storefront (`nguyentuanson27-netizen/la.na_design_storefront`,
ADR 0014 and `src/commerce/capacity-policy.ts`) is production evidence that the three modes, a per-product negative
limit enforced per variant, and a single policy resolver work. It is not copied. §3 lists where Core Kit deliberately
differs.

**Relationship to the production-hardening spec.** Hardening §5.1 says: "Core Kit has no oversell/preorder selling
policy today … v1 keeps that single floor … Introducing any oversell/preorder policy is an ask-first change (§15) and
would need its own resource-level floor definition." This spec is that ask. It defines the resource-level floor and,
once approved, amends hardening §5.1. Everything else in the hardening capacity contract is unchanged:

- locking;
- the ledger;
- mirror handoff;
- `SYNC_UNKNOWN` holding;
- the `TOPOLOGY_CHANGED` guard.

## 1. Objective

Give every product exactly one website-owned selling mode, enforced by the same capacity authority that checkout
already uses:

| Mode | Floor | Customer-facing |
| --- | --- | --- |
| `STANDARD` | 0 | Today's behavior. At 0 the variant is out of stock. |
| `OVERSELL` | `negativeStockLimit` | Purchasable down to the limit with **no** label. At the limit it is out of stock. |
| `PREORDER` | `negativeStockLimit` | Above 0 it sells like `STANDARD`, with no marker. At or below 0 and above the limit it stays purchasable **and is marked as a preorder**. At the limit it is out of stock. |

The limit is configured once per product and enforced **independently per variant**. With a limit of `−20`:

- a variant at `−19` may accept one more unit;
- a variant at `−20` may accept none.

### Non-goals (v1)

- **No UI redesign.** Existing surfaces consume new view-model facts. The only new customer-facing element is a minimal
  preorder text marker rendered by existing components (§9).
- **No preorder cycle, ETA, order-level preorder snapshot, or Merchant/JSON-LD preorder projection.** Those are
  *Preorder truth v1*, the next spec. Until it ships, `PREORDER` cannot be enabled in production (§10, §14 Q1, decided).
- **No oversell or preorder for composite parents** (§6).
- No per-variant policy override, no scheduled mode changes, no automatic mode switching.
- No change to Pancake: the policy is never written to Pancake, and catalog sync never writes it.

## 2. Current Core Kit facts: every place that assumes floor 0

| # | Location | Today |
| --- | --- | --- |
| F1 | `evaluatePlannedCapacity` (`src/commerce/capacity-resources.ts`) | `mirroredUnits − activeReservedUnits − requested < 0` refuses. This is the checkout authority, run inside `reserveOrderCapacity` after the lock. |
| F2 | `advisorySellableUnits` (same file) | `max(0, mirrored − held)`, and sets = min over components. |
| F3 | `CAPACITY_SELLABLE_CTES` (`src/commerce/storefront-catalog.ts`) | The SQL twin of F2, used by listing, filters, flash sale and `withAdvisorySellableStock`. Parity is pinned by `tests/database/capacity-sql-parity.test.ts`. |
| F4 | Merchant stock query + `classifyMerchantAvailability` (`merchant-offer-repository.ts`, `merchant-identity-audit.ts`) | `in_stock` only for positive stock after holds. |
| F5 | Live Pancake pre-check (`pancake-order-submit.ts`, "Live Pancake stock for every resource") | Refuses `STOCK_UNAVAILABLE` when Pancake's live stock is below demand. |
| F6 | `storefront-product.ts` | `sellableStock <= 0` → `unavailableReason = "OUT_OF_STOCK"`. |
| F7 | `storefront-cart.ts` | Clamps quantity to `option.sellableStock`. |
| F8 | JSON-LD (`src/seo/storefront-product-structured-data.ts`) | `purchasable` → `InStock`; `OUT_OF_STOCK` → `OutOfStock`. |
| F9 | Product card availability (`build-product-card-model.ts`) | `sellableStock > 0`. |
| F10 | `/shop` `availability=in-stock` filter | Uses F3's sellable units. |

F6, F7 and F9 already consume `sellableStock` from F2/F3. Redefining that advisory number per mode (§8) makes them
mode-aware without code changes in those surfaces. F1, F3, F4 and F5 need explicit changes.

## 3. Lana evidence, and where Core Kit differs

**Kept from Lana:**

- the three modes;
- `negativeStockLimit` as a non-positive integer, default `−20`, per product, enforced per variant;
- `STANDARD` ignores the limit (floor 0);
- one resolver owns the missing-row answer: **no row ⇒ `STANDARD`**;
- a stored invalid limit refuses sales rather than being silently replaced;
- an unknown mode resolves to `STANDARD`;
- oversell and preorder are refused for composite parents;
- turning oversell off while stock is negative preserves the negative stock.

**Different in Core Kit:**

| Topic | Lana | Core Kit v1 | Why |
| --- | --- | --- | --- |
| Composite components consumed by a set | Component-aware accounting is `STANDARD`-only (floor 0 via `max(0, componentStock)`) | Same, stated as a rule on **resource kind**: `COMPONENT` resources always use floor 0 (§6) | Core Kit already models resources explicitly (`CapacityReservationResource.kind`), so the rule belongs there. |
| A variant consumed both directly and as a component in one order | Not addressed | Floor 0 for that variant's whole demand in that order (§6.2) | Conservative and simple. |
| Policy changes racing checkout | Not addressed | The policy write takes the same `VariantMirror` locks as checkout (§7.2) | Evaluation and policy change then serialize. |
| `PREORDER` before preorder truth exists | Shipped together | The mode can be stored and is fully enforced, but **admin cannot enable it** until Preorder truth v1 ships (§10) | A preorder sale without a persisted preorder fact would lose order history. |
| Live Pancake pre-check | n/a | Mode-aware (§7.3) | Otherwise F5 would refuse every oversell sale. |

## 4. Policy model

### 4.1 Persistence (additive)

```text
enum SellingMode { STANDARD, OVERSELL, PREORDER }

model ProductSellingPolicy {
  productId          String        @id
  sellingMode        SellingMode
  negativeStockLimit Int
  updatedAt          DateTime      @updatedAt
  updatedByUserId    String?
  product            ProductMirror @relation(fields: [productId], references: [id], onDelete: Cascade)
  updatedBy          User?         @relation("SellingPolicyUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)

  @@index([updatedByUserId])
}

// reverse relation fields, required by Prisma:
model ProductMirror { … sellingPolicy ProductSellingPolicy? }
model User          { … sellingPoliciesUpdated ProductSellingPolicy[] @relation("SellingPolicyUpdatedBy") }
```

- **Referential integrity comes from explicit Prisma relations, not comments.** The two `@relation` fields above generate
  the database foreign keys: `productId → ProductMirror.id ON DELETE CASCADE`, and
  `updatedByUserId → User.id ON DELETE SET NULL`. The generated migration SQL must contain both `FOREIGN KEY` clauses.
  Review of M1 checks the SQL, not only the schema.
- **Prisma cannot express the limit CHECK**, so the migration adds it by hand:
  `ALTER TABLE "ProductSellingPolicy" ADD CONSTRAINT "ProductSellingPolicy_negativeStockLimit_range" CHECK
  ("negativeStockLimit" <= 0 AND "negativeStockLimit" >= -100000)`. This follows the existing precedent for hand-added
  constraints in this repository's migrations.

- **Website-owned.** It sits in a separate table, following the `ProductMerchantFacts` pattern, and catalog sync never
  reads or writes it.
- **Cascade on product delete is correct.** The policy is configuration, not ledger state. Existing holds are protected
  by the ledger's own `Restrict` relations.
- **No backfill.** An absent row is the common case, and it is resolved by §4.2, not by a column default. A column
  default fires only when a row is inserted.

### 4.2 The single resolver

`resolveSellingPolicy(stored | null) → { sellingMode, negativeStockLimit, isDefault, valid }`, in a new pure module
(`src/commerce/selling-policy.ts`):

- **No row** → `STANDARD`, `−20`, `isDefault: true`, `valid: true`. This reproduces today's behavior exactly.
- **Unknown mode value** → `STANDARD`. No owner intent survives in a value that names no mode. The stored limit is
  kept, so no allowance is silently widened.
- **Stored limit not a safe integer in `[−100000, 0]`** → returned **as stored** with `valid: false`. Every capacity
  decision on that product then refuses with `INVALID_POLICY`.
  - Substituting the default would sell under a limit the owner never set.
  - The DB CHECK makes this unreachable in practice. The resolver still fails closed for defense in depth.

**Every consumer goes through this resolver.** A test enumerates the modules that read `ProductSellingPolicy`, and only
the resolver's repository may.

### 4.2.1 Effective policy: the capability flags are enforced here, not only in admin

The stored policy is what the owner configured. The **effective policy** is what every sale decision uses: checkout,
the live pre-check, the advisory TypeScript read, the SQL twin, and Merchant. There is exactly one function:

```text
effectivePolicy(stored, flags) =
  resolved = resolveSellingPolicy(stored)                       // step 1: validate first
  if !resolved.valid                              → REFUSE_ALL                  (reason: INVALID_POLICY)
  else if !flags.SELLING_MODES_ENABLED            → STANDARD, floor 0          (reason: SELLING_MODES_DISABLED)
  else if resolved.sellingMode == PREORDER
       && !flags.SELLING_MODE_PREORDER_ENABLED    → STANDARD, floor 0          (reason: PREORDER_DISABLED)
  else                                            → resolved
```

**Authority order: validation first, flags second.**

- A stored row that fails validation makes every capacity decision on that product refuse `INVALID_POLICY`, whatever
  the flags say.
- No flag combination can bypass it: a disabled capability does **not** turn a corrupt row back into a `STANDARD` sale.
- Only **valid** policies are then downgraded by the flags.
- A missing row is valid (§4.2), so the common case is unaffected.

- **Both flags default to off.**
  - `SELLING_MODES_ENABLED` gates the whole capability.
  - `SELLING_MODE_PREORDER_ENABLED` additionally gates `PREORDER`.
- **A stored row outlives the flag that allowed it.** For example: the preorder flag is on, `PREORDER` is saved, then the
  flag is turned off. The effective policy is then `STANDARD`, so no preorder sale can happen. The product keeps selling
  from ready stock only, exactly as a `PREORDER` product above 0 already does.
  - This downgrade is always in the conservative direction.
  - It is explicit: the operator report lists every row whose stored mode differs from its effective mode, with the
    reason.
- The flags are read once per decision from server configuration. They are never read from the request.
- The SQL twin receives both flags as bound parameters, so TypeScript and SQL stay in parity under every flag
  combination.

### 4.3 The floor

```text
floor(mode, limit) = mode == STANDARD ? 0 : limit
```

A decision to accept `q` more units of variant `v` is allowed iff:

```text
mirroredUnits(v) − activeReservedUnits(v) − q ≥ floor
```

This is the same inequality as today, with the constant 0 replaced by `floor`. `mirroredUnits` keeps its existing
meaning: the floored sum of `WarehouseStock` rows, fail-closed on non-finite values. It may be negative. Flooring a
negative fraction goes down, so the result stays conservative.

### 4.4 Mode changes

- A change applies to **new** decisions only. Existing holds, reservations and orders are untouched.
- `OVERSELL`/`PREORDER` → `STANDARD` while stock is negative: stock is **preserved**, never reset. The variant becomes
  unpurchasable until `mirrored − held > 0`.
- Changing the limit upward (for example `−20` → `−5`) while stock is already below the new limit makes the variant
  unpurchasable. Nothing is reverted.

## 5. Which floor applies to a resource

A purchased line resolves to resources (hardening §5.1): `SELF` for a standalone variant, `COMPONENT` for each
component of a composite parent.

| Resource kind | Floor |
| --- | --- |
| `SELF` | `floor(policy of the purchased variant's product)` |
| `COMPONENT` | **0, always** (§6) |

## 6. Composite products

### 6.1 Parents

- A composite parent (a variant with `CompositeComponentMirror` edges) may only sell under `STANDARD` in v1.
- Admin refuses a non-`STANDARD` mode for a product that has a composite parent variant (§10).
- Topology can change after a policy is saved, because catalog sync adds edges. So the checkout authority and the
  advisory read also refuse a composite parent line whose product resolves to a non-`STANDARD` mode, with
  `COMPOSITE_MODE_UNSUPPORTED`. Such a line is not silently treated as `STANDARD`, because the owner configured
  something the system cannot honor, and a quiet downgrade would hide that.
- The operator report (§10.3) lists these products.

### 6.2 Components

- A component consumed by a set uses **floor 0**, whatever its own product's mode.
- Component-aware negative accounting is unproven. Lana deliberately never extended it, and the Pancake evidence covers
  only 1:1 decrements (hardening §19 Q3).
- A set sale may therefore never drive a component below 0, even if that component's product is `OVERSELL`.
- If one order consumes the same variant both as `SELF` and as `COMPONENT`, that variant's **whole** demand in that
  order is checked against floor 0.
- Direct sales of an `OVERSELL` component keep the component's own floor. So a set and a direct sale contend for the
  same units, and the set simply stops earlier.

## 7. Checkout authority

### 7.1 `reserveOrderCapacity`

- After the `VariantMirror` lock and the post-lock topology re-read (unchanged), it reads the policies of the products
  that own every **`SELF` resource**. The read is one query, after the lock.
- `evaluatePlannedCapacity` gains a floor per resource variant, computed by §5 and §6.2. The comparison becomes
  `≥ floor`.
- New refusal reasons, internal only:
  - `NEGATIVE_LIMIT_REACHED`;
  - `INVALID_POLICY`;
  - `COMPOSITE_MODE_UNSUPPORTED`.

  All of them map to the existing buyer-facing `REJECTED / STOCK_UNAVAILABLE` and emit their own internal reason in
  the submission event.

### 7.2 Serializing policy writes with checkout

The policy write:

1. locks the product's `VariantMirror` rows `FOR UPDATE`, in ascending `id` order, the same order checkout uses;
2. upserts the policy in the same transaction.

A checkout that holds those locks evaluates against the policy committed before it locked. A policy change waits for
in-flight checkouts. So no decision is ever made against a half-applied change, and the deadlock-free ordering is
preserved.

**Scope of this guarantee.** §7.2 serializes the **authoritative reservation decision** (`reserveOrderCapacity`, under the
lock) with policy writes, and nothing else. The live pre-check (§7.3) and every advisory read (§8) run outside that lock.
They may observe a policy that is already stale by the time the locked decision runs.

### 7.3 The live Pancake pre-check (F5)

It becomes mode-aware with the same floor:

```text
live.sellableStock − demand ≥ floor
```

It stays advisory to the ledger, as today. A non-finite live value still refuses.

**Consistency contract: conservatively stale.** The pre-check runs before the transaction that takes the `VariantMirror`
locks, so it reads `effectivePolicy` without serialization. A concurrent policy change can make it disagree with the
locked decision, and the two directions behave differently:

- **Pre-check looser than the locked decision.** Example: it read `OVERSELL`, then a change to `STANDARD` committed. The
  pre-check passes, and the locked authority (§7.1) refuses under the new floor. No oversell is possible: safety comes
  only from the locked decision.
- **Pre-check stricter than the locked decision.** Example: it read `STANDARD`, then a change to `OVERSELL` committed. The
  pre-check can refuse `STOCK_UNAVAILABLE` under the old floor before the order reaches the locked authority.
  - This is accepted. It is the same outcome the buyer would have seen one instant earlier.
  - Nothing is held or sent, and the rejection happens before `POS_SUBMITTING`.
  - The buyer can resubmit, and the next attempt reads the new policy.
  - The spec does **not** claim that the pre-check observes policy changes atomically. Implementations must not add
    retries, caches or comments that imply it does.

The pre-check deliberately does not try to share a snapshot with the locked decision. Tying the two would mean either
holding the locks across the Pancake request, which the hardening spec forbids for latency and deadlock reasons, or
re-running the check after the lock, which the locked authority already does.

### 7.4 What does not change

- Mirror handoff: a stock read that started after `acceptedAt`.
- `SYNC_UNKNOWN` holding.
- `TOPOLOGY_CHANGED`.
- The idempotent retry path.

Negative mirrored stock flows through the handoff unchanged. Handoff moves ownership of units, not their sign.

## 8. Advisory read model

For each variant with product policy `P`:

```text
freeUnits     = mirroredUnits − activeReservedUnits          // may be negative
sellableUnits = max(0, freeUnits − floor)                    // units that may still be accepted, per §5
readyUnits    = max(0, freeUnits)                            // units that exist now
isPreorderSale = P.mode == PREORDER && sellableUnits ≥ 1 && readyUnits < 1     // "the next single unit is a preorder"

acceptedAsPreorder(q) = P.mode == PREORDER && q > readyUnits                   // for a requested quantity q
```

**Preorder classification is quantity-aware.** `isPreorderSale` answers only "is one more unit a preorder". It drives
the card and PDP option marker. For any **line** — cart, checkout, and the order — the classification is
`acceptedAsPreorder(line.quantity)`. That covers the case where some units are ready and the rest are not.

Example: `freeUnits = 1`, limit `−20`:

- `sellableUnits = 21`;
- `isPreorderSale = false`, because the next single unit is ready;
- buying 2 is allowed (`2 ≤ 21`), but `acceptedAsPreorder(2) = true`.

So the cart and checkout line carries the preorder marker. It is never rendered as ordinary stock. This is the rule
Lana's `resolveAcceptedPreorderState` exists for.

In v1 the line classification is advisory: rendered in cart and checkout, and recomputed at checkout snapshot time.
Preorder truth v1 moves the authoritative classification to the capacity acceptance boundary, evaluated under the lock,
and persists it.

- **Composite parents:** unchanged. The existing min over components uses component floor 0. A non-`STANDARD` parent
  has `sellableUnits = 0` (§6.1).
- **`sellableStock` in every existing view model is `sellableUnits`.** That makes F6, F7 and F9 mode-aware for free:
  - an `OVERSELL` variant at `−3` with limit `−20` offers 17;
  - a `STANDARD` variant at `−3` offers 0, exactly as today.
- `readyUnits` and `isPreorderSale` are added to the variant view model.
- **The SQL twin (F3)** joins `ProductSellingPolicy` with the same missing-row default, and yields `sellableUnits`,
  `readyUnits` and `isPreorderSale`.
  - `tests/database/capacity-sql-parity.test.ts` is extended to every mode.
  - It covers: no row, an unknown mode, and a composite parent under a non-`STANDARD` mode.
  - It also covers negative stock, and stock exactly at the limit.

## 9. Surface semantics (v1)

The preorder marker text is a brand copy key (`BRAND.copy.preorderLabel`, default `Đặt trước`). Core never hardcodes
the string.

| Surface | `STANDARD` / `OVERSELL` / `PREORDER` with ready stock | `PREORDER` preorder-sale (`isPreorderSale`) | At or below floor |
| --- | --- | --- | --- |
| Card, PDP option | Purchasable; no marker | Purchasable; marker next to the existing availability text | `OUT_OF_STOCK`, as today |
| Cart and checkout line | Unchanged, unless `acceptedAsPreorder(line.quantity)` | Marker on the line whenever `acceptedAsPreorder(line.quantity)`, including a line that starts with ready units (§8) | Refused, as today |
| `/shop` `availability=in-stock` | Included when `sellableUnits ≥ 1`. This includes `OVERSELL` below 0 | **Excluded** | Excluded |
| JSON-LD offer | `InStock` | **Offer omitted** in v1 (§14 Q2, decided) | `OutOfStock` |
| Merchant feed | `in_stock` when `sellableUnits ≥ 1` | **Excluded** with reason `PREORDER_PROJECTION_PENDING` (§14 Q2, decided) | `out_of_stock` |

For `OVERSELL`, "the customer can actually buy" is the feed truth, so an `OVERSELL` variant below 0 is `in_stock`.

**The `availability=in-stock` filter means "buyable now without preorder"** (§14 Q4). A variant matches when
`sellableUnits ≥ 1 && !isPreorderSale`. That includes `OVERSELL` below 0, which has no customer-facing difference from
ready stock, and excludes preorder-sale variants. It deliberately does **not** mean "physically in stock"
(`readyUnits ≥ 1`), and the spec, UI copy and docs must not describe it that way. The existing label `Chỉ còn hàng`
("in stock only") is compatible with "buyable now".

Rows 2–5 of the `PREORDER` column are placeholders that Preorder truth v1 replaces:

- a preorder availability cycle and an `availability_date` authority for Merchant and JSON-LD;
- the accepted-line READY/PREORDER classification at the capacity acceptance boundary;
- the immutable confirmed-order snapshot.

## 10. Admin and operations

### 10.1 Editing

- The existing product editor (`src/app/admin/products/[productId]`) gains one fieldset in the current layout: **Selling
  policy**. It has mode radios and a limit number input, with no redesign.
- The server action:
  1. requires the existing admin session and role; the actor is recorded from the session, never from the form;
  2. validates the limit as an integer in `[−100000, 0]`;
  3. refuses a non-`STANDARD` mode for a product with a composite parent variant, with an explanation;
  4. refuses any non-`STANDARD` mode unless `SELLING_MODES_ENABLED` is on, and refuses `PREORDER` unless
     `SELLING_MODE_PREORDER_ENABLED` is also on;
  5. performs the §7.2 locked upsert.
- Both flags default to **off** and are documented in `deploy/vps/env.example`.
  - `SELLING_MODES_ENABLED` is turned on only after M3 has shipped (§13).
  - `SELLING_MODE_PREORDER_ENABLED` is turned on only after Preorder truth v1 ships.
- Admin gating is a convenience. **The authority is §4.2.1**, so a row saved while a flag was on stops affecting sales
  the moment that flag is off.

### 10.2 Why `PREORDER` ships behind a flag

The capacity semantics of `PREORDER` are fully implemented and tested in v1. But a preorder sale accepted without the
READY/PREORDER line classification and the confirmed-order snapshot would permanently lose its preorder history. Lana
paid for exactly that, in the defect documented in `resolveAcceptedPreorderState`. The flag keeps v1 shippable to
production for `STANDARD` + `OVERSELL`, and makes `PREORDER` a one-line enablement once its truth exists.

### 10.3 Operator report

`pnpm catalog:selling-policy:report` lists every product whose policy is not the default, with:

- its mode and limit;
- per variant: `freeUnits`, `sellableUnits` and `readyUnits`;
- flags: `INVALID_POLICY`, `COMPOSITE_MODE_UNSUPPORTED`, and variants at or below their floor.

It prints no PII.

## 11. Migration and rollout

- One additive migration: the enum, the table, the CHECK and the FK. No backfill, no data rewrite.
- Deploy uses the existing quiesce sequence (hardening §6).
- **Rollback is safe in the conservative direction.**
  - Older code ignores the table and treats every product as `STANDARD` (floor 0). It sells strictly less, never more.
  - Holds taken under `OVERSELL` stay valid ledger rows.
  - Negative stock simply stops selling.
- **Amendment to hardening §5.1**, applied in the implementation PR that ships §7: the "single floor" sentence becomes
  "floors per this spec".

## 12. Required tests

**Domain (resolver and floor):**

- a missing row is `STANDARD` / `−20` / default;
- an unknown mode is `STANDARD`, with the limit preserved;
- an invalid limit returns `valid: false`, and every decision refuses `INVALID_POLICY` **under all four flag
  combinations**. This includes `SELLING_MODES_ENABLED` off, and a stored `PREORDER` with the preorder flag off;
  neither flag turns the corrupt row into a `STANDARD` sale;
- `STANDARD` ignores the limit;
- boundary: `−19` → one more unit is allowed; `−20` → refused; a quantity of 2 at `−19` is refused;
- per-variant independence: two variants of one product, one at the limit and one above it;
- composite:
  - a component in a set uses floor 0 when its product is `OVERSELL`;
  - mixed `SELF` + `COMPONENT` in one order uses floor 0 for the whole demand;
  - a composite parent under a non-`STANDARD` mode gives `COMPOSITE_MODE_UNSUPPORTED`;
- `sellableUnits` / `readyUnits` / `isPreorderSale` truth table across modes and stock values: positive, 0, negative
  above the limit, at the limit, and below it.

**Database:**

- **referential integrity (§4.1):**
  - deleting a product deletes its `ProductSellingPolicy` row (cascade);
  - deleting the `updatedBy` user keeps the policy and sets `updatedByUserId = null`;
  - inserting a policy for a nonexistent product fails with a foreign-key error;
  - a limit of `1` or `−100001` fails the CHECK;

- concurrency at the limit: two buyers for the last oversell unit (`−19` → `−20`); exactly one succeeds;
- a policy change racing checkout serializes (§7.2): a checkout holding the locks finishes under the old policy, and the
  next checkout sees the new one;
- `OVERSELL` → `STANDARD` with negative stock: unpurchasable, and the stock is unchanged;
- SQL parity for every mode and edge case (§8);
- handoff of a hold taken below 0 behaves exactly like one taken above 0.

**Integration:**

- the live pre-check (F5) allows an oversell sale where live Pancake stock is `0`, and refuses one at the limit;
- the admin action:
  - refuses `PREORDER` while the flag is off;
  - refuses non-`STANDARD` for composite parents;
  - refuses an out-of-range limit;
  - takes its actor from the session;
- only the resolver's repository reads `ProductSellingPolicy`.

**Flags (effective policy, §4.2.1):**

- **flag on → save `PREORDER` → flag off → a preorder sale is impossible.** Checkout refuses beyond ready stock; the
  advisory read shows `sellableUnits = readyUnits` and `isPreorderSale = false`; SQL agrees; the report lists
  `PREORDER_DISABLED`;
- `SELLING_MODES_ENABLED` off → an `OVERSELL` row behaves exactly as `STANDARD` in checkout, advisory TypeScript, SQL,
  Merchant and the live pre-check;
- TS/SQL parity holds under all four flag combinations.

**Policy-change races (§7.2, §7.3):**

- **looser pre-check:** the pre-check reads `OVERSELL`, `STANDARD` commits before the lock, and at 0 stock the locked
  authority refuses. Nothing is held and nothing is sent to Pancake;
- **stricter pre-check:** the pre-check reads `STANDARD`, `OVERSELL` commits before the lock, and at 0 stock the order is
  rejected `STOCK_UNAVAILABLE` before `POS_SUBMITTING`. A resubmission then succeeds under `OVERSELL`;
- a policy write blocks while a checkout holds the product's variant locks, and the checkout completes under the policy
  it read under the lock.

**Quantity-aware preorder (§8):**

- `1 ready + buy 2` under `PREORDER`: the purchase is allowed; the card and PDP show no marker; the cart and checkout
  line show the marker (`acceptedAsPreorder(2) = true`);
- `2 ready + buy 2`: no marker anywhere.

**Filter (§9):**

- `OVERSELL` below 0 matches `availability=in-stock`; a preorder-sale variant does not; a `STANDARD` variant at 0 does
  not.

**Browser:**

- an `OVERSELL` variant at `−3` is purchasable with no marker;
- with the flag on in the test only, a `PREORDER` preorder-sale variant shows the brand marker on the card, PDP and cart;
- the `in-stock` filter excludes it.

## 13. Slicing

| Slice | Content | Depends on |
| --- | --- | --- |
| **M1** — policy | Migration; resolver; repository; admin fieldset and action with the flag; operator report. Nothing reads the policy for sales yet. | spec approval |
| **M2** — checkout authority | §5, §6, §7: floors in `evaluatePlannedCapacity`, the policy read after lock, the locked policy write, the mode-aware live pre-check, reasons; hardening §5.1 amendment. | M1 |
| **M3** — advisory and surfaces | §8 TypeScript and SQL with parity; `readyUnits`/`isPreorderSale` in view models; the §9 surface rules including Merchant exclusion and JSON-LD omission; the brand copy key; browser tests. | M2 |

Each slice is its own pull request with the full gate set. **No slice changes production behavior on its own.**

- `SELLING_MODES_ENABLED` stays off from M1 through M3, and the effective policy (§4.2.1) is `STANDARD` everywhere while
  it is off. So the intermediate states cannot be observed in production:
  - after M1, a policy can be stored but is never read for sales;
  - after M2, checkout would honor `OVERSELL` while card, PDP, cart and SQL do not yet.
- Every slice's tests run with the flag both off (asserting exact `STANDARD` behavior) and on.
- The flag is turned on in production only after M3 is merged and its browser tests pass. That step is a documented
  configuration change in `docs/operations/release-and-rollback.md`, not code.
- After that, `STANDARD` + `OVERSELL` are live. `PREORDER` additionally waits for its own flag and Preorder truth v1.

## 14. Owner decisions — all four decided (approved as recommended)

1. **`PREORDER` behind `SELLING_MODE_PREORDER_ENABLED` (default off) until Preorder truth v1.** Decided: yes (§10.2).
2. **Merchant and JSON-LD for preorder-sale variants in v1.** Decided:
   - preorder-sale variants are excluded from Merchant with reason `PREORDER_PROJECTION_PENDING`;
   - their JSON-LD offer is omitted;
   - both apply only once the flag is on, and Preorder truth v1 replaces them with a dated preorder projection.
3. **Default limit `−20`, product-level only.** Decided: yes. A per-variant override is out of scope.
4. **Meaning of the `availability=in-stock` filter.** Decided: "buyable now without preorder"
   (`sellableUnits ≥ 1 && !isPreorderSale`). It includes `OVERSELL` below 0 and excludes preorder-sale variants. It is
   not "physically in stock" (§9).

## 15. Boundaries

**Always**

- One resolver owns the policy.
- The floor comes from §5 and §6 only.
- Policy writes take the checkout lock order.
- Every refusal has an internal reason.
- SQL and TypeScript stay in parity.

**Ask first**

- Enabling `PREORDER` in production.
- Composite oversell or preorder.
- Per-variant overrides.
- Changing the default limit.
- Any new customer-facing element beyond the preorder marker.

**Never**

- Catalog sync writing the policy.
- Resetting negative stock.
- Silently downgrading an unsupported configuration to `STANDARD` for a sale decision.
- A set sale driving a component below 0.
- A preorder sale persisted without its preorder truth, which is why the flag exists.
- Changing Lana.
