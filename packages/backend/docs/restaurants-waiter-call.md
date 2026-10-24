# Guest WaiterCall persistence

Restaurants owns this V1 model in the existing Restaurants table. No index, TTL,
Scan, queue or event bus is involved. Client caches cannot enforce cross-device
uniqueness or cooldown; the coordination slot is durable server authority.

KeyFactory owns all physical keys (segments use existing validation):

- Slot: PK `ORG#org#OUT#outlet#TABLE#table`, SK `WAITER_CALL`.
- Call: PK `ORG#org#OUT#outlet#WC#call`, SK `META`.
- Activity: PK `ORG#org#OUT#outlet#ACTIVE#WC`, SK `ISO-requestedAt#call`.
- Acknowledgement audit: call PK, SK `ACK_AUDIT`.

Create/reuse strongly reads one table slot. Active calls return the current
REQUESTED timestamp; acknowledged slots return a bounded cooldown. Creation uses
three conditional Puts (slot CAS, new call, new activity), plus one Delete when
replacing an expired active entry. Old calls remain historical. Competing writes
cannot both pass the slot version/call identity condition. Conditional losers
strongly reread, with four bounded attempts. Other failures are not retried as
business races.

Acknowledgement strongly reads the call and its slot. Four writes update call and
slot by CAS, delete activity and create one deterministic audit. Existing staff
canonical authorization ConditionChecks join that transaction. A concurrent loser
rereads ACKNOWLEDGED without another audit. An expired or superseded call cannot
acknowledge a newer slot. Slot cooldown is sixty seconds from canonical ack time.

Outlet activity evaluates at most 100 items per Query/page in the last ten-minute
sort-key range, ascending, strongly consistent, excluding explicitly expired and
acknowledged rows. A scoped continuation cursor supports more pages. Stale physical
activity rows outside the range never require historical hydration. Expiry uses
explicit server timestamps, never asynchronous TTL deletion.

Guest verification precedes duplicate, cooldown and write handling. FREE creates
no session. OCCUPIED records only the canonical current session; later session
closure does not mutate a call. Public DTOs are explicit safe projections; staff
DTOs include only operational table identity, timestamps and opaque UUID action
identity. visitRef never selects or authorizes a call.
