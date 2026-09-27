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
| Absence confirmed by 5 searches about 1 s apart, in memory, in one call | The window is far shorter than any plausible Pancake processing or indexing lag. A restart loses the count. | Absence evidence is **durable and spread over a minimum age and elapsed time**. It is an investigation signal, not proof of no-sale, unless E4 and E6 are established (§9). |
| `ABSENT` → `REJECTED` | If the order appears later, the buyer has been told "rejected", their cart is unlocked for a second order, and a real Pancake order exists with no hold. | Absence never changes the order to `REJECTED` automatically in v1 (§9, §10). |
| Reconciliation triggered per cart, when the buyer returns | Orders whose buyer never returns are never resolved. | A bounded scheduled sweep (§11), plus the per-order operator command (§12). |
| Order found by marker only | A copied or colliding marker links the wrong order. | A match must also agree with the local order's lines and contact (§8.3). |

## 4. Goals and non-goals

### Goals

1. An order in `SYNC_UNKNOWN` whose Pancake order exists is linked (`pancakeOrderId`), moved to `CONFIRMED`, and its hold
   becomes eligible for the normal mirror handoff, without a human.
2. An order in `SYNC_UNKNOWN` whose Pancake order was not found is surfaced with durable, reviewable absence evidence, for
   investigation. Its hold is released only by one of the two releases in §9.3. Repeated absence on its own is never
   treated as proof of no-sale.
3. No path releases capacity, rejects an order or unlocks a cart on a single miss, a transport error, incomplete
   coverage, or elapsed time alone.
4. Every decision is recorded as evidence that can be audited later.
5. A reconciliation path that has stopped working is detectable in production, separately from catalog-sync health
   (§11.1).

### Non-goals

- **No retry of the create request.** A marker is not an idempotency key. v1 never sends a second `POST` for an order,
  whatever reconciliation finds.
- No Pancake webhook receiver.
- No mapping of Pancake numeric statuses into `LocalOrderState` beyond "this order exists".
- No change to the checkout path itself, apart from writing the marker (§6) and keeping the returned id on path B (§7).
- No change to Lana.

## 5. Evidence gate (blocks implementation)

No code writes a marker, calls a list endpoint, or changes an order's state from search results until E1–E5 are checked
in as sanitized evidence. E6 is not required to start; without it, the parts of this spec that depend on it stay off
(§8.1, §9.3). The evidence uses the same fingerprinted-OpenAPI workflow as
`docs/integrations/pancake-order-openapi-evidence.md`, plus one **human-gated** live verification against a test shop.
The standing rule is unchanged: no CI job makes a live create-order write.

| Gate | Question | Accepted evidence |
| --- | --- | --- |
| **E1 — carrier round-trip** | For each candidate field (`custom_id`, `note`, `note_print`), does a value sent on create come back byte-for-byte on detail **and** list reads? | A sanitized, checked-in live observation. |
| **E2 — carrier stability** | Does Pancake itself rewrite the field (normalize, truncate, prefix, auto-fill `custom_id`)? Is the field editable in the Pancake UI? Does it appear on customer-facing or carrier-facing output (invoice, label)? | Live observation plus the Pancake UI/documentation. A field that is customer- or carrier-facing is rejected. |
| **E3 — list contract** | For `GET /shops/{SHOP_ID}/orders`, what are the reviewed query parameters and item fields? Is there a server-side filter that can find the marker, and a time-window filter? What is the pagination metadata? Which endpoint (list item or order detail) carries the line items and billing phone that §8.3 compares? | A machine-derived OpenAPI evidence file, the same kind as the create/detail files. |
| **E4 — coverage semantics** | Can the list be proven complete for a window? That means: stable `total_entries`/`total_pages`; whether cancelled, returned and **deleted/trashed** orders are included (or which filter includes them); the time-zone semantics of the window parameters; and **pagination stability under concurrent writes**, which needs either a snapshot or cursor, or keyset pagination on an immutable sort key. With plain offset or page-number paging, an insert, delete or status change can shift an item between pages without changing totals or producing a duplicate. | E3 plus a live observation: an order created, cancelled and deleted, then searched in the window. For stability, the reviewed contract must name the snapshot, cursor or keyset mechanism. A live observation cannot prove it. |
| **E5 — search propagation** | How long after a *successful* create response is the new order visible to the chosen search? | A live measurement over several creates. It sets a lower bound on the minimum age before an absence observation counts (§9.2). It says nothing about creates whose response never arrived. |
| **E6 — create-outcome horizon** | After the client stops waiting (timeout, abort, crash — paths A and C), is there a **guaranteed** bound after which Pancake can no longer create an order from that request? | Only an authoritative statement: Pancake documentation or a written statement from Pancake of a server-side processing deadline or request expiry. A live measurement can show a typical delay, but it cannot prove that a late creation never happens, so it does not satisfy E6. |

**Carrier choice rule.** Prefer, in order:

1. a field that is filterable server-side, not staff-facing, and round-trips unchanged — `custom_id` is the first
   candidate;
2. otherwise a staff-facing field that round-trips unchanged (`note`), accepting that staff can remove the marker.

The chosen rule is recorded as the deployment's **carrier mode** (`RULE_1` or `STAFF_EDITABLE`). In `STAFF_EDITABLE`
mode:

- the definitive release (§9.3 a) and any automatic release are permanently unavailable, because a missing marker there
  can mean a staff edit, not a missing order;
- orders can still become absence-confirmed as an investigation status (§9.2);
- the manual override (§9.3 b) stays available. Its required independent verification searches the Pancake admin by time
  window, phone and items, and does not rely on the marker.

`shipping_address.*` and `note_print` are never carriers (E2).

If E3 shows no server-side filter that can find the marker, the search must cover the whole time window page by page (§8.2).
Such a scan can only conclude `ABSENT` if E4 also proves stable pagination; otherwise every miss is `AMBIGUOUS` and only
`FOUND` is reachable.
If E4 cannot prove complete coverage of a window, `ABSENT` can never be concluded and v1 ships `FOUND`-only.
If E6 is not established, the search window is never truncated (§8.1) and the definitive no-sale release does not exist
(§9.3). Only the manual risk override remains.

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
to   = now                                                         (default)
to   = min(now, submitAttemptedAt + createOutcomeHorizon + skewAllowance)   (only with E6)

createOutcomeHorizon = requestTimeout + upstreamCompletionBound (E6) + searchPropagationBound (E5) + margin
```

- `skewAllowance` defaults to 1 day and covers Pancake's timezone-less timestamps (E4).
- **The upper bound is not truncated unless E6 holds.** On paths A and C no response arrived. Pancake may still be
  processing the request and create the order later. E5 only measures visibility *after a successful response*, so it
  cannot bound when such an order is created. A window ending before the order's creation would exclude it from every
  later search and turn a real order into repeated `ABSENT`s. Without E6, `to` is always `now`.
- An open-ended window costs requests, not correctness. With a server-side marker filter (E3) it stays small. Without
  one, the page count grows with the shop's order volume. Once the page budget is exceeded, coverage becomes incomplete and
  the result is `AMBIGUOUS`, which fails closed.
- Widening the window is always safe. Narrowing it below what E4, E5 and E6 establish is not allowed.

### 8.2 Coverage

- A search result is **complete** only if:
  - every page of the filtered window was read;
  - the reported totals stayed identical across the pages;
  - the pages returned no duplicate ids;
  - the window's parameters were accepted as reviewed (E3).
- The result is **incomplete** if a page limit is reached, metadata is missing or contradictory, a transport error occurs,
  or an item fails the reviewed item shape.
- Incomplete coverage is `AMBIGUOUS`, whatever was or was not seen.
- **Absence needs stable pagination as well as complete coverage.** Consistent totals and no duplicates do not prove that
  no item was skipped: with offset or page-number paging, a concurrent change can move the marker-bearing order from an
  unread page to one already read. A complete search may therefore conclude `ABSENT` only when one of these holds:
  1. **the result fits in one page**: the server-side marker filter (E3) returned a single page whose reported total
     equals the items returned (normally zero), so there is no page boundary to slip across; or
  2. **E4 established stable pagination**: a snapshot, cursor, or keyset on an immutable key, which the gateway uses.

  Any other multi-page search that finds no match is `AMBIGUOUS(UNSTABLE_PAGINATION)`. That includes a multi-page scan of
  an unfiltered time window under offset paging. It never counts toward absence-confirmed. Re-reading or overlapping pages
  is not accepted as a substitute, because it narrows the gap but does not prove there is none.
- A match is not weakened by unstable pagination in the same way: an item that was seen exists. `FOUND` still requires
  the §8.3 agreement checks and complete coverage for "exactly one".

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
- **`ABSENT`**. Coverage is complete, pagination is stable (§8.2: a single page, or an E4-proven snapshot, cursor or
  keyset), and no item carries the marker.
- **`AMBIGUOUS(reason)`**. Anything else:
  - more than one match;
  - a match that disagrees with the local order;
  - an id already linked elsewhere;
  - incomplete coverage;
  - no match on a multi-page search without stable pagination (`UNSTABLE_PAGINATION`);
  - a transport or contract error;
  - an order that is missing its marker or shop scope.

## 9. Absence is evidence for investigation, not proof of no-sale

This section is the safety core of the spec.

### 9.1 What one absence proves

One complete `ABSENT` observation proves only that the order was not visible **at that moment** through that search. It
does not prove that Pancake never created the order, or that it cannot still appear: processing or indexing may lag, and
staff may have edited a staff-facing marker away. Therefore:

- a single `ABSENT` changes nothing: not the order state, not the hold, not the cart lock;
- `AMBIGUOUS` resets nothing and proves nothing;
- elapsed time alone proves nothing;
- **many** `ABSENT`s are still empirical absence. They show the order was not visible at each of those moments. They do
  not show that this create cannot still materialize. That guarantee exists only with E6 (§9.3).

### 9.2 Durable absence evidence

Every search outcome is appended to a ledger (for example `OrderReconciliationObservation`: order, observed-at, outcome,
window, pages read, totals, reason code). An order is **absence-confirmed** only when all of these hold.
Absence-confirmed is an investigation status: it puts the order in front of an operator with its evidence. It is not the
hardening §5.4 definitive no-sale proof.

1. it has a marker (§6.1), in either carrier mode (§5). The status records the carrier mode it was reached under, and the
   operator report shows it: in `STAFF_EDITABLE` mode a missing marker is weaker evidence, because staff may have edited
   it away;
2. at least `K` consecutive complete `ABSENT` observations exist, with no `FOUND` or `AMBIGUOUS` among them — any other
   outcome restarts the count;
3. the first counted observation is at least `minAge` after `submitAttemptedAt`. `minAge` is at least the create
   request's own timeout plus the E5 propagation bound. When E6 is established, it is at least `createOutcomeHorizon`;
4. consecutive counted observations are at least `D` apart, and the span from first to last is at least `S`.

The recommended defaults are `K = 3`, `D = 10 min`, `S = 30 min` and `minAge = max(30 min, E5 bound × 3)`. §5 evidence may
raise them. Lowering them requires a spec amendment.

### 9.3 The two releases, and what each requires

Absence-confirmed is a precondition for both releases below and sufficient for neither. It is reachable in both carrier
modes, so the manual override is reachable in both. The definitive release additionally requires carrier mode
`RULE_1`.

**(a) Definitive no-sale release: the hardening §5.4.1 path.** It exists only when **all** of these hold:

- E4 establishes authoritative completeness of the searched window, including cancelled, returned and deleted orders;
- E6 establishes the bounded no-late-materialization guarantee;
- the order was sent with a marker in carrier mode `RULE_1` (§5): server-filterable and not staff-editable. This stays
  mandatory for the definitive release and for anything automatic;
- every counted observation's window started at or before `submitAttemptedAt − skewAllowance` and was taken after
  `submitAttemptedAt + createOutcomeHorizon`.

Only then does repeated complete absence prove that this create produced no order **and** cannot produce one later. If
any condition is missing, this release does not exist in the code at all; it is not merely disabled. It is the only
release the sweep may ever perform automatically, behind a per-deployment flag that defaults off (R5, §15 Q1).

**(b) Manual risk override.** This is not a proof. It is an explicit, audited decision by a person to accept the risk of
a late materialization.

- It is available only through the operator command (§12), and only for an absence-confirmed order.
- **Trusted actor.** The actor recorded for the release is established by the operator surface, never asserted by the
  caller.
  - The command runs only in the trusted operator surface. For example: an admin action behind Core Kit's
    authenticated admin session, or a server-side command whose actor comes from an authenticated, authorized context
    such as the admin session's user id, or an OS or SSH identity mapped to an authorized operator account.
  - The actor must be authorized for this privileged action: an explicit role or allow-list, not just any signed-in user.
  - A caller-supplied string such as `--operator alice` never satisfies the audit requirement.
  - When no authenticated, authorized actor can be established, the command fails closed and releases nothing.
  - The exact mechanism is left to implementation; the rule is that the identity is not self-asserted.
- **Structured verification.** The operator records a reason and what they independently verified, as structured fields.
  At least:
  - a search in the Pancake admin (trash included) for the order's time window, phone and items;
  - its **outcome**, one of `NO_MATCHING_ORDER`, `MATCHING_ORDER_FOUND` or `INCONCLUSIVE`.

  Contact with the buyer is optional.
- **The outcome is a precondition, not a note.** The command releases only when the recorded outcome is
  `NO_MATCHING_ORDER`:
  - **`MATCHING_ORDER_FOUND`**: refuses. The external sale is known to exist, so this is no longer a risk override under
    uncertainty. It directs the operator to `--link <pancakeOrderId>` (§10), or to the release-incident procedure (§9.4)
    if the order was already released.
  - **`INCONCLUSIVE`**, or any missing field: refuses. The hold stays.
- It is never automated, never triggered by the sweep, and it has no flag.

The hardening spec's rule — no timer, label or retry may silently release an unresolved hold — is respected because the
override is neither silent nor automatic. It is still an exception to the hardening spec's §5.4 requirement for definitive
evidence before release. **The owner approved an amendment to hardening §5.4.1 that admits exactly this override
(§15 Q4, decided).** The amendment is recorded in `docs/specs/core-kit-production-hardening-v1.md` §5.4.1. It admits
nothing broader than this section describes.

Both releases are the same single atomic transaction. Only the recorded reason differs:

- The order moves `SYNC_UNKNOWN → REJECTED` with a compare-and-set on `state = SYNC_UNKNOWN`. `syncErrorCode` records
  which release it was: `CREATE_NOT_FOUND_DEFINITIVE` for (a), `MANUAL_RELEASE_OVERRIDE` for (b).
- Every resource of its reservations gets `releasedAt` (a new additive column) set.
- A released resource stops counting in **every** capacity read path listed in §2.3: the TypeScript read, the SQL CTEs,
  the Merchant stock query, and the partial index predicate (`mirroredAt IS NULL AND releasedAt IS NULL`).
  `tests/database/capacity-sql-parity.test.ts` must cover the released case.

### 9.4 After a release

- If a later observation ever finds the marker (`FOUND`) for a released order, that is an **incident**, not a silent
  re-confirmation.
  - The sweep records it and raises it on the operator surface (§12) and through the reconciliation health signal
    (§11.1).
  - The released hold is **not** silently re-taken: the capacity may already be sold.
  - The operator resolves it in Pancake.
- **Released orders stay under observation so that this case is detected, not missed.**
  - After a definitive release (a), they are observed until `createOutcomeHorizon` has passed with margin.
  - After a manual override (b), they are observed **indefinitely**. Nothing bounds a late materialization, so no fixed
    tail is safe.
  - Observation continues at a decaying cadence: every tick for the first `S`, then hourly for a day, then daily.
  - It shares the per-tick request budget (§11) and has lower priority than unreleased orders.
  - An operator may retire an override's watch entry only with a recorded decision, for example after the order window
    has been manually reviewed in Pancake again.

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
  - The sweep's failure must not fail the sync or the sync's heartbeat; catalog-sync health stays about catalog sync. The
    sweep has its own liveness signal instead (§11.1). Failures are logged with fixed, non-PII messages.
- **Batch and fair scheduling.** Each tick handles at most `N` work items (default 20) under a per-tick Pancake request
  budget. A work item is an unreleased `SYNC_UNKNOWN` order or a released order's watch entry (§9.4).
  - **`nextDueAt` on every item.**
    - Every work item carries a durable `nextDueAt`.
    - A new `SYNC_UNKNOWN` order starts due immediately.
    - After each observation, whatever its outcome, `nextDueAt = observedAt + cadence`. The cadence is `D` for an
      unreleased order, and the §9.4 decaying cadence for a watch entry.
    - An item whose observation could not run (the budget ran out, or a transport error) keeps its `nextDueAt`. It is
      therefore at the front of the queue on the next tick.
  - **Selection.**
    - A tick selects due items (`nextDueAt ≤ now`) ordered by `nextDueAt`, then `submitAttemptedAt`, then `id`.
    - Never-observed items sort first among equal due times.
    - Because every observed item moves behind everything already due, every due item is reached within
      `ceil(dueCount ÷ N)` ticks, whatever the backlog. Ordering by `submitAttemptedAt` alone would reselect the same `N`
      oldest orders on every tick and starve order `N + 1`.
  - **Reserved share for watch entries.** When any watch entry is due, at least `max(1, N ÷ 4)` of the tick's items go to
    watch entries. The rest go to unreleased orders, and each class may use the other's unused share. Neither class can
    starve the other.
  - **`minAge`.** An order not yet at `minAge` is still observed, so it can be `FOUND`, but its `ABSENT` does not count.
- **Concurrency.** The transitions are compare-and-sets on `state = SYNC_UNKNOWN`. A buyer revisiting the order, an
  operator command and the sweep may race, and exactly one wins. The losers re-read the state and report it.

### 11.1 Reconciliation liveness

Reconciliation that fails on every tick while catalog sync stays healthy must be visible in production. This is the same
class of failure that nguyentuanson27-netizen/storefront-core-kit#17 closed for catalog sync itself.

- **Durable sweep record.** Every sweep writes one row (for example `OrderReconciliationSweep`: `startedAt`,
  `finishedAt`, `ok`, per-outcome counts, a fixed failure code).
  - The record lives in the database, not in a container-local file, so it survives restarts and any process can read it.
  - A sweep is `ok` only if it ran its whole batch, committed its ledger writes, and every Pancake call returned a response
    that could be classified. Transport failures, exceptions and budget exhaustion before the batch ends are not `ok`.
  - A sweep with nothing eligible is `ok`: there was nothing to do.
- **Health rule.** `pnpm pancake:orders:reconciliation-health` exits non-zero, with a fixed reason, when either of these
  holds:
  1. no `ok` sweep has finished within `2 × CATALOG_SYNC_INTERVAL_SECONDS + 120 s`, the bound catalog sync already uses
     (`STALE_SWEEP`);
  2. **overdue work**: some work item's `nextDueAt` is overdue by more than
     `2 × interval + ceil(dueCount ÷ reservedShare) × interval` (`ORDER_UNOBSERVED`). This covers unreleased orders and
     watch entries, each against its own share.
     - This is a safety net, not the fairness mechanism. The scheduler above guarantees progress by construction.
     - The health check catches a scheduler defect, or a budget too small for the backlog.
- **Where it is surfaced.**
  - The health command is the contract.
  - `docs/operations/release-and-rollback.md` requires wiring it into the deployment's monitoring, the same place the
    app's health is watched.
  - The report command (§12) prints its result at the top.
  - `deploy.sh` runs it after `catalog-sync` turns healthy. A failed first sweep fails the deploy with "order
    reconciliation has not succeeded", as a failed first sync does.
  - It does not change the `catalog-sync` container's Docker health: production can tell "catalog sync healthy,
    reconciliation dead" apart from a healthy system.
- An open incident (§9.4) also makes the health command fail (`RELEASE_INCIDENT`) until an operator acknowledges it.

## 12. Operator surface

- **Report.** `pnpm pancake:orders:unknown` lists every `SYNC_UNKNOWN` order with:
  - its age, marker presence and path (A/B/C);
  - its last observations;
  - whether it is absence-confirmed (an investigation status, not proof);
  - its held units.

  It prints no PII beyond the public order code.
- **Command.** `pnpm pancake:orders:reconcile <publicCode> [--link <pancakeOrderId> | --release]`.
  - With no flag it runs one observation now.
  - `--link` applies §10 after the agreement checks.
  - `--release` applies the manual risk override (§9.3 b), approved as owner decision §15 Q4. It refuses unless all of
    these hold:
    - the order is absence-confirmed;
    - the structured verification fields are supplied;
    - the recorded verification outcome is `NO_MATCHING_ORDER`;
    - an authenticated, authorized actor is established by the operator surface.
  - `--link` and `--release` run only in the trusted operator surface (§9.3 b). Every use is recorded with that actor,
    the reason, and the verification outcome. A caller-supplied name is never the recorded actor.
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
- a marker-less order is never searched;
- the window's upper bound is `now` unless E6 is configured, so an order created long after `submitAttemptedAt` is still
  inside the window and is `FOUND`;
- without E4 and E6 established, the definitive release (§9.3 a) is not reachable, however many absences are recorded;
- reconciliation health:
  - a failing sweep writes a not-`ok` record and the health command reports `STALE_SWEEP` after the bound, while the
    catalog-sync heartbeat stays healthy;
  - an overdue work item reports `ORDER_UNOBSERVED`;
- fair scheduling:
  - with a backlog of `3N` orders that never resolve, every order is observed within 3 ticks and again within 6;
  - an observation that could not run keeps its `nextDueAt` and is taken first on the next tick;
  - due watch entries get their reserved share while unreleased orders are also due, and vice versa;
- pagination:
  - a multi-page, no-match search under offset paging is `AMBIGUOUS(UNSTABLE_PAGINATION)` and never counts toward
    absence-confirmed;
  - a single-page filtered result with total 0 is `ABSENT`;
  - with an E4-proven cursor or keyset, a multi-page no-match is `ABSENT`;
- carrier modes:
  - in `STAFF_EDITABLE` mode an order can become absence-confirmed and the manual override is reachable;
  - in that mode the definitive release is unreachable.
  - an open release incident reports `RELEASE_INCIDENT`.

**Database:**

- `FOUND` → `CONFIRMED`, `acceptedAt` set, and exactly one confirmation event when the sweep and a buyer race;
- a later catalog sync hands the reconciled hold off;
- path B reads detail by the stored id, and a `404` stays `SYNC_UNKNOWN`;
- **one `ABSENT` changes nothing**: order state, hold, cart lock and tracking status are all unchanged;
- absence-confirmed with automatic release off → still held;
- operator `--release` on an order that is not absence-confirmed is refused;
- operator `--release` without the structured verification fields is refused;
- **operator `--release` whose recorded verification outcome is `MATCHING_ORDER_FOUND` is refused**, releases nothing,
  and points to `--link` or incident handling; `INCONCLUSIVE` is refused too;
- operator `--release` with no authenticated, authorized actor fails closed, and a caller-supplied `--operator` value
  is ignored for attribution. It neither satisfies nor replaces the actor;
- an authenticated user without the operator role is refused;
- an overridden order stays under observation beyond `S`, and a later `FOUND` for it is recorded as an incident;
- release → every capacity read path stops counting the resource (the parity test extended);
- `FOUND` after release is recorded as an incident and re-takes nothing;
- the sweep never sends a create request.

**Integration:** the marker is written in the `POS_SUBMITTING` transaction before the gateway is called (the gateway fake
reads the database, as `pancake-order-capacity.test.ts` already does), and it never appears in delivery fields of the
request.

**Deploy:** the sweep inherits `catalog-sync` quiescing (the existing `vps-deploy-sequence` tests stay green, no new
writer), and a deploy whose first sweep fails reports "order reconciliation has not succeeded".

## 14. Slicing

| Slice | Content | Depends on |
| --- | --- | --- |
| **R0** — evidence | E1–E5 artifacts and docs only, and E6 if Pancake can supply it. Live verification is human-gated. | owner approval of this spec |
| **R1** — path B | Keep the returned id; detail-read reconciliation; `FOUND` → `CONFIRMED` + `acceptedAt`; the observation ledger; the sweep record and reconciliation health (§11.1), including deploy; the report command. | none (reviewed detail contract) |
| **R2** — marker write | Additive `reconciliationMarker` and `submitAttemptedAt`; written in the claim transaction; carrier per E1/E2. | R0 |
| **R3** — search and `FOUND` | The reviewed list gateway; §8 classification; the sweep in `catalog-sync`; `FOUND`-only transitions. | R0, R2 |
| **R4** — absence evidence and manual override | The §9.2 investigation status; `releasedAt` across every capacity read path; §9.4 observation of released orders; the operator `--release` override. | R3 (§15 Q4 approved) |
| **R5** — definitive release (optional) | §9.3 (a) behind a flag that defaults off. | R4 + E4 **and E6** established + carrier rule 1 + owner decision §15 Q1. **Blocked until E6 exists.** |

Each slice is its own pull request. R1 can ship before any new Pancake evidence exists.

## 15. Owner decisions

1. **Automatic release (§9.3 a).** It can only ever be the definitive release, and it is blocked until E6 exists.
   Recommendation: do not plan R5 unless Pancake supplies an authoritative processing deadline.
2. **Carrier (§5).** Accept `custom_id` if E1–E4 pass. If only `note` works, accept that automatic release is permanently
   off.
3. **Buyer message while `CHECKING`.** Should tracking say more than it does today, for example "we are confirming your
   order with the shop"? This is copy only, and optional.
4. **Manual risk override (§9.3 b). Decided: approved by the owner.** Hardening §5.4.1 is amended to admit an audited
   operator override with recorded independent verification, exactly as §9.3 (b) specifies. The override is explicitly
   not proof of no-sale. It stays operator-only, never automated, and the overridden order stays under indefinite
   observation (§9.4).

## 16. Boundaries

**Always**

- One marker per order, persisted before the request leaves.
- Search coverage is proven, or the result is `AMBIGUOUS`.
- Transitions are compare-and-sets on `state = SYNC_UNKNOWN`.
- Every observation and decision is recorded.
- Holds are released only through §9.3, and every release records which of the two it was.
- A manual release records a server-established, authorized actor, never a caller-supplied name.
- Reconciliation liveness is monitored separately from catalog-sync health.

**Ask first**

- Changing a §9.2 default downward.
- Enabling automatic release (and only after E4 and E6).
- Truncating the search window (only with E6).
- Adding a carrier field.
- Running a live create-order verification.

**Never**

- A second create request for an order.
- Treating the marker (or `custom_id`) as an idempotency key.
- Putting the marker in a delivery or customer-facing field.
- Releasing or rejecting on one miss, a transport error, incomplete coverage, or elapsed time.
- Calling repeated absence "definitive no-sale proof" without E4 and E6.
- Re-taking a released hold silently.
- Changing Lana.
