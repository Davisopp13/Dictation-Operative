# P3 local rendered-flow evidence

November 27, 2026. Codex/GPT implementation verification, not independent review.
Built Worker served only at `http://localhost:5173`, isolated local D1/R2, synthetic
accounts and files. No production data, deployment or remote migrations.

Evidence directory: `/Users/davis/.codex/worktrees/catch-all-desk-p3`.
Browser screenshots were captured and inspected inline in the implementation
conversation; they are not standalone image files in this checkout. This checklist
records observations and does not substitute for the independent reviewer's own
rendered checks.

## Observed in Chrome

- Captured the authenticated integrated-base Clipboard before editing.
- At 1280px, created a note, uploaded a synthetic screenshot and a valid receipt
  PDF, and saved a general HTTPS shop link. Selected those four references and
  created a Mint pile atomically. Covers show mixed content; PDF preview renders
  the synthetic receipt's text. Rename/recolor to Sky persisted.
- Used the explicit order controls, including keyboard activation. Position text
  changed with the order; focused order control survived refresh. Reload restored
  the pile detail. A fresh sign-in to account A showed the same four references
  and order. The browser tabs shared one cookie jar; independent session-cookie
  verification and byte/quota checks are in `test:built-shared-items`.
- Removed a reference, closed the membership workflow, and used its persistent
  receipt-backed Undo. The source and order were restored. The final focus check
  is recorded in `browser-final-results.json` beside the review manifest.
- At 390px, inspected Daylight pile detail and Midnight Desk, centered mobile +,
  full-screen catch flow, and progress. No horizontal page overflow was observed.
  At 1280px, inspected Daylight piles and Midnight capacity-pending cards.
  Reduced-motion media emulation was enabled for the mobile Midnight inspection,
  then reset. These are viewport checks, not physical-device acceptance.
- Text capture restored focus to the emptied input. Page-level paste stages text
  for Save. Generic link title/host display and existing Clipboard/Documents
  navigation remained available. UI sign-out/sign-in to B cleared account A's
  view/selection state.
- Seeded B locally with 100 empty mapped piles and 500 retained inactive slots in
  one pile. Pinned pending text still displayed “Collection pending.” Another
  source displayed member-slot capacity despite zero visible members. Progress
  separated pile/member limits and disabled Continue at ready=0; no retry loop.
- Opened the legacy editor on a pending source. Pending status is visible outside
  collapsed Collection/tags. Clearing Collection used the default-focused
  “Save and keep pinned” confirmation, then displayed the authoritative pin and
  cleared pending state. This did not release the old slots.
- Seeded one ready source for an existing free mapped pile. Explicit Continue
  sent exactly one POST, followed by status/list GETs: pending 2/ready 1 became
  pending 1/ready 0. Continue disabled and explained the remaining block.
- Opened mapped-pile deletion confirmation without deleting: it explained source
  preservation, no Undo, zero new pins when cleanup is off, and permanent exact-key
  suppression. Cancel returned to the pile.
- Simulated loss of the **200 response after membership committed**, with CDP
  interception scoped to the local membership Fetch response. UI said the source
  was saved and offered Add again. Retry sent the identical operation ID and body,
  with no second source POST. The pile contained the source once. Interception
  was cleared immediately after the simulation.
- Network inspection during shop-link save/pile rendering showed local requests
  only, with no destination metadata/preview request. The synthetic `.test` shop
  was not opened. Explicit Open's `noopener noreferrer` behavior is inspected in
  code; successful navigation to an external shop was not asserted.

## Automated local evidence

All eight requested commands and their final results are recorded in the handoff
and external manifest. The suite includes real local D1 fixtures and built Worker
auth/session routes, not only mocked JSX. Focused UI-controller tests use the same
`Intent`, `MembershipBatch`, selection and start-page helpers as the UI.

- Mixed ready sources, exact references/order and quota preservation across two
  separately authenticated sessions; account B denial; auth/Origin/bearer behavior.
- Pin/manual-pile priority cannot hide per-item pending state. Both capacity
  limits, sequential backup restore at capacity, cleanup holds, recovery and
  suppressed pending versus settled suppression.
- Exact historical collection keys, tag-only changes, replay receipts and stale
  workspace/source/pile guards; atomic Collection-change pin and remove-and-pin.
- Real membership Undo, both pile-deletion modes, stale tokens, default-off and
  enabled scheduled cleanup, source deletion queues and complete account erasure.
- HTTPS validation and Google recognition; link edit revision/owner checks on
  both API surfaces. Immutable retries, partial membership success, conflict
  reconfirmation, stopping between requests and account-local start-page notice.

## Independent reviewer: repeat and extend

- [ ] Verify the exact manifest HEAD/patch, then repeat all eight commands.
- [ ] Repeat four-type Mint pile creation, order, keyboard, reload, second session,
  rename/recolor and remove/Undo at 1280/390px in both themes.
- [ ] Check Space/range/Select all loaded/Clear/Escape and truthful mixed state;
  partially successful membership/pin writes; no bulk delete.
- [ ] Trigger another-session edits/deletion during removal, Undo, link editing
  and paging; confirm stale choices require explicit fresh confirmation.
- [ ] Inspect pending cards/editor while pinned or manually piled; both retained
  capacity limits; bounded backfill; explicit Collection clear/change and suppressed
  keys. No implicit slot release, mass clear or migration-on-read.
- [ ] Reproduce committed-response loss and retry; preserve unsaved input on
  network/auth failure; close/navigate/account-switch around an in-flight request.
- [ ] Check safe focus on cleanup exposure, focus after removed invokers, persistent
  Undo and reduced motion; inspect loading/error/empty states and preview bounds.
- [ ] Verify existing upload/scanner/PDF/print affordances and generic-link edit/
  deletion copy. Inspect network before explicit Open.

Unverified here: real iPhone/Android/PWA lifecycle, Safari/Firefox, assistive
technology, physical touch/camera/scanning/printing and an actual external shop
navigation. Browser late-race coverage is supplemented by automated server and
controller tests; not every concurrency/capacity permutation was manually driven.
The independent phone-print-fix branch is absent from this base. No physical print
job or camera permission was requested.
