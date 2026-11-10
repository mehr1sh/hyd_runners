# Coach and physiotherapist marketplace

The marketplace builds on the professional profiles and admin-only verification from workstream D ([coach-platform.md](coach-platform.md)).

## Who can be booked

A professional is bookable only when **all** of these hold (`private.professional_is_bookable`):

- their profile is `verified` (checked by an admin);
- they chose to be listed;
- they aren't suspended.

**Physiotherapy** services can only be created by profiles whose profession is physiotherapist, and only bookable once verified.

Unverified professionals can prepare services and open times, but nobody else sees them. The directory (`/professionals`) and profile pages show only bookable professionals, a "Verified" badge and the date the credentials were checked. Credentials are shown as listed by the professional.

## Services and availability

Professionals manage these at Coach → **Services and bookings** (`/coach/services`).

**Services:**

- types: training consultation, running form review, strength programme, mobility session, race preparation, physiotherapy;
- length, in person or online;
- an optional **indicative fee**, shown as "paid directly".

**Open times:** future slots of up to 4 hours, with an optional place.

## Booking workflow

1. **Request.** The runner picks a service and an open time and must confirm the professional boundaries; the checkbox is required in the form and re-checked by the database. `request_booking`:
   - holds the slot and refuses double booking;
   - refuses blocked users and self-booking;
   - checks the slot is long enough;
   - is rate-limited and audited, and notifies the professional.
2. **Confirm or decline.** Only the professional, and only while verified, through `update_booking`. The runner is notified.
3. **Cancel.** Either side, before the session. The slot reopens and the other side is notified.
4. **Complete.** The professional, after the session ends.

Every step is audited. Bookings are visible only to their two participants (`/bookings` for runners).

## Payments: disabled

- No payment is collected.
- `bookings.payment_status` can only be `not_collected`; a database check enforces it.
- No commission is taken, and nothing recurs.
- The code has a `PaymentProvider` boundary (`features/marketplace/logic.ts`) with only a disabled provider.

Enabling payments needs separate authorisation:

- choosing a provider, which means a merchant account and KYC;
- a sandbox integration;
- refund and cancellation terms;
- a migration that relaxes the `payment_status` check.

## Professional boundaries and reporting

Booking pages state that:

- coaches don't diagnose or treat;
- physiotherapy is only offered by verified physiotherapists and isn't emergency care;
- verification is a credential check, not an endorsement;
- fees are agreed directly.

Runners can raise a concern through Community → Feedback, which staff triage. Admins can suspend a profile from `/manager/professionals`; it then disappears from listings and can't accept bookings.
