# Spec — `SYNC_UNKNOWN` order reconciliation v1

Status: **PROPOSED. Human review is required before planning or implementation. The Pancake evidence gate in §5 must pass
before any code writes or searches a marker.**

Base: `storefront-core-kit/main` after nguyentuanson27-netizen/storefront-core-kit#17.

This spec is written for `storefront-core-kit` only. The Lana storefront (`nguyentuanson27-netizen/la.na_design_storefront`)
is evidence that this problem is real and that a marker search can find a lost order. It is not a design to copy. §3 lists
the places where this spec deliberately departs from it.

## 1. Problem

When the Pancake create-order request has an unknown outcome, Core Kit moves the order to `SYNC_UNKNOWN` and **keeps its
capacity hold for ever**. Unknown outcomes include a timeout, a transport failure, a response that cannot be parsed, a crash
while the request is in flight, or a local write failure after Pancake answered. Keeping the hold is correct: Pancake is
not a concurrency authority, so releasing it could oversell. The production-hardening spec (§5.4) requires it. But nothing
ever resolves such an order today:

- the buyer's cart is locked to that checkout (`lockActiveCheckout` treats `SYNC_UNKNOWN` as active) and order tracking
  shows `CHECKING` indefinitely;
- the held units never return, even when Pancake never created the order;
- when Pancake did create the order, it is never linked locally: no `pancakeOrderId`, no `CONFIRMED`, no Purchase event,
  and no mirror handoff (the hold never becomes mirror-owned, so capacity is counted twice for as long as the order lives
  in Pancake);
- `docs/integrations/pancake.md` and `docs/operations/release-and-rollback.md` state that an operator must resolve these
  orders by hand, and that duplicate-safe reconciliation "remains blocked until a trustworthy unique reference is
  separately verified".

This spec defines that reference and the evidence required to use it. It also defines how an order in `SYNC_UNKNOWN` may
leave that state without ever releasing capacity on weaker evidence than the hardening spec allows.

## 2. Current Core Kit facts

These facts come from the code and reviewed evidence on `main`, not from Lana.

### 2.1 How an order becomes `SYNC_UNKNOWN`

There are three paths, all in `src/commerce/pancake-order-submit.ts` and `src/commerce/guest-checkout-recovery.ts`:

| Path | What is known locally |
| --- | --- |
| **A.** `gateway.createOrder` throws, or the response has no valid `id` | Nothing: Pancake may or may not have an order. |
| **B.** The response was parsed (a Pancake order id was in hand), but the local `CONFIRMED` transaction failed | Pancake **did** create an order and returned its id. Today that id is discarded. |
| **C.** The recovery sweep finds `POS_SUBMITTING` older than its cutoff (a crash mid-request) | Nothing. |

The hold is taken in the same transaction that claims `POS_SUBMITTING` (hardening §19 Q1), so every `SYNC_UNKNOWN` order
has a hold. `CapacityReservation.acceptedAt` stays `null`.

### 2.2 What the reviewed Pancake contract says

- **Create** (`docs/integrations/pancake-order-create-contract-observed.json`, `pancake-order-openapi-evidence.md`):
  - `POST /shops/{SHOP_ID}/orders`, with the response identity `id: integer`.
  - The request accepts `note`, `note_print`, `custom_id`, and `shipping_address.address` / `full_address` (all strings).
    `custom_id` is also a selected response property.
  - The manual review found **no** idempotency key, uniqueness guarantee or client-reference guarantee.
  - `custom_id` is described only as "Custom ID" and **must not** be treated as an idempotency key.
- **Detail** (`pancake-order-status-contract-observed.json`):
  - `GET /shops/{SHOP_ID}/orders/{ORDER_ID}` is reviewed.
  - It returns `id`, `system_id`, `shop_id`, `status` (enum), `inserted_at` and `updated_at`.
  - Production showed that timestamps may have no timezone.
- **List/search: no reviewed contract.** There is no evidence for `GET /shops/{SHOP_ID}/orders` covering:
  - which query parameters filter it (free-text search, `custom_id`, time window, status, deleted/trash);
  - its sort order;
  - its pagination metadata;
  - whether cancelled or deleted orders are returned;
  - which fields each list item carries.

  **This is the first blocker.** A marker cannot be searched through an endpoint whose behaviour has not been reviewed.

### 2.3 What the ledger can represent

- A resource counts toward `activeReservedUnits` while `CapacityReservationResource.mirroredAt IS NULL`. Every capacity
  read uses that predicate:
  - TypeScript: `capacity-reservation-repository.ts`;
  - SQL: `CAPACITY_SELLABLE_CTES` in `storefront-catalog.ts`;
  - the Merchant stock query in `merchant-offer-repository.ts`;
  - the partial index `…_index_unmirrored_capacity_resources`.
- **There is no "released" representation.** No path today releases a hold that was taken, because the only definitive
  no-sale path (rejection before the POST) happens before a hold exists.
- Mirror handoff needs `acceptedAt`. A catalog sync hands a resource off only when its stock read *started* after
  `acceptedAt` (hardening §5.4, §19 Q3).

## 3. Lana evidence, and why this is not a copy

Lana's I8 work (`src/commerce/pancake-order-reconciliation.ts`, `src/integrations/pancake/order-search.ts`) shows that a
marker written into the order and then searched for can find an order whose create outcome was lost:

- **Marker.** `[ORDER:<publicCode>]` is appended to `note` **and** `shipping_address.address`.
- **Outcomes.**
  - `FOUND` (exactly one match) → `CONFIRMED` with the Pancake id; holds committed.
  - `AMBIGUOUS` (several matches, transport error, invalid response, or incomplete coverage) → stays `SYNC_UNKNOWN`.
  - `ABSENT` → `REJECTED` and holds released.
- **Hardening.** Search coverage is bounded and fails closed. Absence is confirmed by searching again several times
  (default 5 attempts, 1 s apart) before `ABSENT` becomes terminal.

Core Kit keeps the proven part: a marker is a **reconciliation identity**, found by a search that fails closed on incomplete
coverage, with more than one match treated as ambiguous. It deliberately differs on the following points.

| Lana behaviour | Risk | Core Kit rule |
| --- | --- | --- |
| Marker in `shipping_address.address` | It is printed on the shipping label and read by the carrier; it pollutes an operational field. | The marker never goes in a delivery field (§6.2). |
| Marker in free-text `note`, which staff can edit | Staff can delete it. A deleted marker makes a real order look absent. | The carrier field is chosen by evidence (§5). Absence alone can never prove no-sale (§9). |
| Search scans the newest pages of the unfiltered order list (3 × 50) and trusts that order | The sort order is unreviewed. In any shop larger than 150 orders, coverage is never complete, so every miss is `AMBIGUOUS`. | Search is a **reviewed, filtered, time-bounded window** whose complete coverage is proven page by page (§8). |
| Absence confirmed by 5 searches about 1 s apart, in memory, in one call | The window is far shorter than any plausible Pancake processing or indexing lag. A restart loses the count. | Absence evidence is **durable, spread over a minimum age and elapsed time**, and by default never releases automatically (§9). |
| `ABSENT` → `REJECTED` | If the order appears later, the buyer has been told "rejected", their cart is unlocked for a second order, and a real Pancake order exists with no hold. | Absence never changes the order to `REJECTED` automatically in v1 (§9, §10). |
| Reconciliation triggered per cart, when the buyer returns | Orders whose buyer never returns are never resolved. | A bounded scheduled sweep (§11), plus the per-order operator command (§12). |
| Order found by marker only | A copied or colliding marker links the wrong order. | A match must also agree with the local order's lines and contact (§8.3). |

## 4. Goals and non-goals

### Goals

1. An order in `SYNC_UNKNOWN` whose Pancake order exists is linked (`pancakeOrderId`), moved to `CONFIRMED`, and its hold
   becomes eligible for the normal mirror handoff, without a human.
2. An order in `SYNC_UNKNOWN` whose Pancake order does not exist is surfaced with durable, reviewable absence evidence. It
   is released only by the rule in §9.
3. No path releases capacity, rejects an order or unlocks a cart on a single miss, a transport error, incomplete
   coverage, or elapsed time alone.
4. Every decision is recorded as evidence that can be audited later.

### Non-goals

- **No retry of the create request.** A marker is not an idempotency key. v1 never sends a second `POST` for an order,
  whatever reconciliation finds.
- No Pancake webhook receiver.
- No mapping of Pancake numeric statuses into `LocalOrderState` beyond "this order exists".
- No change to the checkout path itself, apart from writing the marker (§6) and keeping the returned id on path B (§7).
- No change to Lana.

## 5. Evidence gate (blocks implementation)

No code writes a marker, calls a list endpoint, or changes an order's state from search results until all of E1–E5 are
checked in as sanitized evidence. The evidence uses the same fingerprinted-OpenAPI workflow as
`docs/integrations/pancake-order-openapi-evidence.md`, plus one **human-gated** live verification against a test shop.
The standing rule is unchanged: no CI job makes a live create-order write.

| Gate | Question | Accepted evidence |
| --- | --- | --- |
| **E1 — carrier round-trip** | For each candidate field (`custom_id`, `note`, `note_print`), does a value sent on create come back byte-for-byte on detail **and** list reads? | A sanitized, checked-in live observation. |
| **E2 — carrier stability** | Does Pancake itself rewrite the field (normalize, truncate, prefix, auto-fill `custom_id`)? Is the field editable in the Pancake UI? Does it appear on customer-facing or carrier-facing output (invoice, label)? | Live observation plus the Pancake UI/documentation. A field that is customer- or carrier-facing is rejected. |
| **E3 — list contract** | For `GET /shops/{SHOP_ID}/orders`, what are the reviewed query parameters and item fields? Is there a server-side filter that can find the marker, and a time-window filter? What is the pagination metadata? Which endpoint (list item or order detail) carries the line items and billing phone that §8.3 compares? | A machine-derived OpenAPI evidence file, the same kind as the create/detail files. |
| **E4 — coverage semantics** | Can the list be proven complete for a window? That means stable `total_entries`/`total_pages`, whether cancelled, returned and **deleted/trashed** orders are included (or which filter includes them), and the time-zone semantics of the window parameters. | E3 plus a live observation: an order created, cancelled and deleted, then searched in the window. |
| **E5 — propagation** | How long after a create response is the new order visible to the chosen search? | A live measurement over several creates. It sets the minimum age before any absence observation counts (§9). |

**Carrier choice rule.** Prefer, in order:

1. a field that is filterable server-side, not staff-facing, and round-trips unchanged — `custom_id` is the first
   candidate;
2. otherwise a staff-facing field that round-trips unchanged (`note`), accepting that staff can remove the marker; in that
   case §9's automatic release stays permanently off.

`shipping_address.*` and `note_print` are never carriers (E2).

If E3 shows no server-side filter that can find the marker, the search must cover the whole time window page by page (§8.2).
If E4 cannot prove complete coverage of a window, `ABSENT` can never be concluded and v1 ships `FOUND`-only.

## 6. Marker contract

### 6.1 Identity

- The marker is a reconciliation identity: it tells us which Pancake order (if any) came from **this** create attempt. It
  is **not** an idempotency key and gives no permission to retry.
- It is generated server-side as `ck1-` + 26 Crockford base32 characters from 128 random bits. Its uniqueness is by
  construction, never by assumption about Pancake.
  - It is not derived from `publicCode`, so it carries no buyer-facing identifier and cannot be guessed from one.
- It is persisted on the order (for example `OrderMirror.reconciliationMarker @unique`, additive and nullable) **in the
  same transaction that claims `POS_SUBMITTING`** (and takes the hold), that is, before the request can leave.
  - An order whose marker is null was never sent with one.
  - Reconciliation must treat that order as marker-less (§10), never search for it.
- One order, one attempt, one marker. Core Kit's one-shot state machine already guarantees at most one `POST` per order.

### 6.2 Carrier

- The marker goes only into the carrier field chosen by §5, and is written verbatim.
- If the carrier is shared free text (`note`), the marker is appended on its own line as `[ck:<marker>]` after the buyer's
  note. It is never inside it.
- The request builder (`buildPancakeCreateOrderRequest`) takes the marker as a validated input. The browser never supplies
  it.
- It never goes into `shipping_address.*`, `note_print`, `bill_*` or any other delivery or customer field.

## 7. Keep the id Pancake already returned (path B)

Path B loses evidence that Core Kit already had. The fallback write that sets `SYNC_UNKNOWN` after a failed `CONFIRMED`
transaction also persists the parsed id in an additive column, for example `OrderMirror.createResponseOrderId`. It
**never** persists it in `pancakeOrderId`: the order is not confirmed, and `pancakeOrderId` is `@unique` confirmation state.

Reconciliation of such an order does not search. It reads the reviewed detail endpoint by that id:

- a valid response for the same shop → `FOUND`;
- `404` or a contract failure → `AMBIGUOUS`, never `ABSENT`: a create response *said* it existed.

This part needs no new Pancake evidence and may ship first (§14, R1).

## 8. Search contract

### 8.1 Window

The search window is anchored on the local `POS_SUBMITTING` claim time (the order's `updatedAt` at that transition,
recorded explicitly as `submitAttemptedAt`) and not on the buyer's clock:

```text
from = submitAttemptedAt − skewAllowance
to   = min(now, submitAttemptedAt + maxCreateLag)
```

- `skewAllowance` defaults to 1 day and covers Pancake's timezone-less timestamps (E4). `maxCreateLag` comes from E5 with
  a generous margin.
- Widening the window is always safe, because it costs requests, not correctness. Narrowing it below the E4/E5 evidence is
  not allowed.

### 8.2 Coverage

- A search result is **complete** only if:
  - every page of the filtered window was read;
  - the reported totals stayed identical across the pages;
  - the pages returned no duplicate ids;
  - the window's parameters were accepted as reviewed (E3).
- The result is **incomplete** if a page limit is reached, metadata is missing or contradictory, a transport error occurs,
  or an item fails the reviewed item shape.
- Incomplete coverage is `AMBIGUOUS`, whatever was or was not seen.

### 8.3 Classification

For one order, one search yields exactly one of:

- **`FOUND(id)`**. Coverage is complete, **exactly one** item carries the marker, and that item agrees with the local
  order:
  - same shop;
  - the same set of `(variation_id, quantity)` lines;
  - the same billing phone.

  The Pancake id must not already be linked to another local order (`pancakeOrderId` is `@unique`). A match seen on a
  search whose coverage was incomplete is recorded as `AMBIGUOUS(MATCH_WITH_INCOMPLETE_COVERAGE)`, because "exactly one"
  cannot be proven. The next complete search turns it into `FOUND`.
- **`ABSENT`**. Coverage is complete and no item carries the marker.
- **`AMBIGUOUS(reason)`**. Anything else:
  - more than one match;
  - a match that disagrees with the local order;
  - an id already linked elsewhere;
  - incomplete coverage;
  - a transport or contract error;
  - an order that is missing its marker or shop scope.

## 9. Absence is never terminal on one miss

This section is the safety core of the spec.

### 9.1 What one absence proves

One complete `ABSENT` observation proves only that the order was not visible **at that moment** through that search. It
does not prove that Pancake never created the order, or that it cannot still appear: processing or indexing may lag, and
staff may have edited a staff-facing marker away. Therefore:

- a single `ABSENT` changes nothing: not the order state, not the hold, not the cart lock;
- `AMBIGUOUS` resets nothing and proves nothing;
- elapsed time alone proves nothing.

### 9.2 Durable absence evidence

Every search outcome is appended to a ledger (for example `OrderReconciliationObservation`: order, observed-at, outcome,
window, pages read, totals, reason code). An order is **absence-confirmed** only when all of these hold:

1. it has a marker (§6.1), and the carrier is not staff-editable (§5 rule 1);
2. at least `K` consecutive complete `ABSENT` observations exist, with no `FOUND` or `AMBIGUOUS` among them — any other
   outcome restarts the count;
3. the first counted observation is at least `minAge` after `submitAttemptedAt`, where `minAge` is at least the E5
   propagation bound plus the create request's own timeout;
4. consecutive counted observations are at least `D` apart, and the span from first to last is at least `S`.

The recommended defaults are `K = 3`, `D = 10 min`, `S = 30 min` and `minAge = max(30 min, E5 bound × 3)`. §5 evidence may
raise them. Lowering them requires a spec amendment.

### 9.3 What absence-confirmed allows

- **Default (v1): nothing automatic.** An absence-confirmed order stays `SYNC_UNKNOWN` and keeps its hold. The operator
  report (§12) lists it with its evidence, and the operator command (§12) can release it. The command refuses unless the
  order is absence-confirmed, and it records who released it and why.
- **Automatic release (owner decision, §15 Q1).** Only when the owner explicitly enables it: a flag that defaults off, set
  per deployment. It is allowed only with carrier rule 1. The release is the same transition as the operator command,
  performed by the sweep.

In both cases the release transition is the **definitive no-sale release** of hardening §5.4.1, and it is a single atomic
transaction:

- The order moves `SYNC_UNKNOWN → REJECTED` with `syncErrorCode = CREATE_NOT_FOUND`. The compare-and-set requires
  `state = SYNC_UNKNOWN`.
- Every resource of its reservations gets `releasedAt` (a new additive column) set.
- A released resource stops counting in **every** capacity read path listed in §2.3: the TypeScript read, the SQL CTEs,
  the Merchant stock query, and the partial index predicate (`mirroredAt IS NULL AND releasedAt IS NULL`).
  `tests/database/capacity-sql-parity.test.ts` must cover the released case.

### 9.4 After a release

- If a later observation ever finds the marker (`FOUND`) for a released order, that is an **incident**, not a silent
  re-confirmation.
- The sweep records it and alerts. The released hold is **not** silently re-taken (capacity may already be sold).
- The operator resolves it in Pancake.
- The sweep keeps observing released orders for a bounded tail (`S` again) precisely so that this case is detected rather
  than missed.

## 10. `FOUND` and the order lifecycle

A `FOUND(id)` (from §7 or §8) is applied in one transaction, as a compare-and-set on `state = SYNC_UNKNOWN`:

- **Order.** `state = CONFIRMED`, `pancakeOrderId = id`, `syncErrorCode = null`.
- **Acceptance.** `markOrderCapacityAccepted(tx, orderId, acceptedAt)`, where `acceptedAt` is the instant the search or
  detail response that found the order was received, sampled after the response.
  - This is later than the true creation time, and that is deliberately conservative. Handoff requires a stock read that
    *started* after `acceptedAt`. The order provably existed before that instant, and Pancake decrements
    `remain_quantity` at order save, so such a read includes its effect.
  - The true (earlier) creation time is never used: Pancake's timezone-less `inserted_at` cannot be compared with a local
    instant.
- **After the transaction.** The existing mirror handoff rules apply unchanged.
- **Events.** The confirmed-purchase event and any buyer notification behave as if the order had been confirmed at
  submission. They are emitted after the commit and never twice: the compare-and-set is the guard.

Marker-less orders (anything sent before R2 ships) on path A or C can only be resolved by the operator command. The
command links a Pancake id the operator supplies. It first checks shop and existence against the reviewed detail read,
and then the §8.3 agreement checks, once E3 has reviewed the fields they need. Until then the operator confirms lines and
phone in the Pancake UI and the command records that they did. There is no search and no automatic release for these
orders.

For path B the id came from Pancake's own create response to this order, so the detail read only has to confirm that
the order exists in the same shop. No agreement check is needed.

## 11. Runtime

- **Where it runs.** The sweep runs in the existing `catalog-sync` process, after each successful catalog sync. That
  process is already scheduled, health-checked, and quiesced together with the app by `deploy.sh` and stopped first by
  `rollback.sh`, so no new writer has to be added to the deploy sequence.
  - Running it after the sync, not before, means a `FOUND` order's hold becomes eligible for handoff on the next sync.
  - The sweep's failure must not fail the sync or its heartbeat. It is logged with fixed, non-PII messages.
- **Batch.** Each tick handles at most `N` orders (default 20), oldest `submitAttemptedAt` first, with a per-tick Pancake
  request budget.
  - An order not yet at `minAge` is observed (for `FOUND`) but its `ABSENT` does not count.
  - Released orders are observed only within their §9.4 tail.
- **Concurrency.** The transitions are compare-and-sets on `state = SYNC_UNKNOWN`. A buyer revisiting the order, an
  operator command and the sweep may race, and exactly one wins. The losers re-read the state and report it.

## 12. Operator surface

- **Report.** `pnpm pancake:orders:unknown` lists every `SYNC_UNKNOWN` order with:
  - its age, marker presence and path (A/B/C);
  - its last observations;
  - whether it is absence-confirmed;
  - its held units.

  It prints no PII beyond the public order code.
- **Command.** `pnpm pancake:orders:reconcile <publicCode> [--link <pancakeOrderId> | --release]`.
  - With no flag it runs one observation now.
  - `--link` applies §10 after the agreement checks.
  - `--release` applies §9.3 and refuses unless the order is absence-confirmed.
  - Every use is recorded with the operator identity and reason.
- **Docs.** `docs/operations/release-and-rollback.md` replaces "resolve by hand" with this procedure.
  `docs/integrations/pancake.md` records the reviewed marker and list contract.

## 13. Required tests

**Domain:**

- classification:
  - a single match with agreement → `FOUND`;
  - two matches → `AMBIGUOUS`;
  - a match with different lines or phone → `AMBIGUOUS`;
  - an id already linked → `AMBIGUOUS`;
- coverage:
  - missing, contradictory or changing totals → `AMBIGUOUS`;
  - a page limit reached → `AMBIGUOUS`;
  - duplicate ids across pages → `AMBIGUOUS`;
- absence confirmation:
  - `K−1` absences → not confirmed;
  - an `AMBIGUOUS` or `FOUND` between absences restarts the count;
  - an observation before `minAge` does not count;
  - spacing below `D` does not count;
- a marker-less order is never searched.

**Database:**

- `FOUND` → `CONFIRMED`, `acceptedAt` set, and exactly one confirmation event when the sweep and a buyer race;
- a later catalog sync hands the reconciled hold off;
- path B reads detail by the stored id, and a `404` stays `SYNC_UNKNOWN`;
- **one `ABSENT` changes nothing**: order state, hold, cart lock and tracking status are all unchanged;
- absence-confirmed with automatic release off → still held;
- operator `--release` on an order that is not absence-confirmed is refused;
- release → every capacity read path stops counting the resource (the parity test extended);
- `FOUND` after release is recorded as an incident and re-takes nothing;
- the sweep never sends a create request.

**Integration:** the marker is written in the `POS_SUBMITTING` transaction before the gateway is called (the gateway fake
reads the database, as `pancake-order-capacity.test.ts` already does), and it never appears in delivery fields of the
request.

**Deploy:** the sweep inherits `catalog-sync` quiescing (the existing `vps-deploy-sequence` tests stay green, no new
writer).

## 14. Slicing

| Slice | Content | Depends on |
| --- | --- | --- |
| **R0** — evidence | E1–E5 artifacts and docs only. Live verification is human-gated. | owner approval of this spec |
| **R1** — path B | Keep the returned id; detail-read reconciliation; `FOUND` → `CONFIRMED` + `acceptedAt`; the observation ledger; the report command. | none (reviewed detail contract) |
| **R2** — marker write | Additive `reconciliationMarker` and `submitAttemptedAt`; written in the claim transaction; carrier per E1/E2. | R0 |
| **R3** — search and `FOUND` | The reviewed list gateway; §8 classification; the sweep in `catalog-sync`; `FOUND`-only transitions. | R0, R2 |
| **R4** — absence evidence and operator release | The §9.2 ledger rules; `releasedAt` across every capacity read path; the operator `--release`. | R3 |
| **R5** — automatic release (optional) | The flag, default off. | R4 + owner decision §15 Q1 + carrier rule 1 |

Each slice is its own pull request. R1 can ship before any new Pancake evidence exists.

## 15. Owner decisions

1. **Automatic release (§9.3).** Recommendation: ship R1–R4 and keep releases operator-only until production shows how
   often absence-confirmed orders occur. Revisit R5 with that data.
2. **Carrier (§5).** Accept `custom_id` if E1–E4 pass. If only `note` works, accept that automatic release is permanently
   off.
3. **Buyer message while `CHECKING`.** Should tracking say more than it does today, for example "we are confirming your
   order with the shop"? This is copy only, and optional.

## 16. Boundaries

**Always**

- One marker per order, persisted before the request leaves.
- Search coverage is proven, or the result is `AMBIGUOUS`.
- Transitions are compare-and-sets on `state = SYNC_UNKNOWN`.
- Every observation and decision is recorded.
- Holds are released only through §9.3.

**Ask first**

- Changing a §9.2 default downward.
- Enabling automatic release.
- Adding a carrier field.
- Running a live create-order verification.

**Never**

- A second create request for an order.
- Treating the marker (or `custom_id`) as an idempotency key.
- Putting the marker in a delivery or customer-facing field.
- Releasing or rejecting on one miss, a transport error, incomplete coverage, or elapsed time.
- Re-taking a released hold silently.
- Changing Lana.
