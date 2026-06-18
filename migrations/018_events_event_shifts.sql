-- ============================================================
-- 018 — events.event_shifts  (special-event staffing exceptions, item 6)
-- ============================================================
-- A manager describes a special event in plain English; Soteria/Aegis work out
-- whether it's a brand-new one-off shift or a change to an existing shift, and
-- write a structured spec here. The schedule engine applies it ONLY on the
-- event's dates, so it expires on its own once the date passes — the recurring
-- weekly template is never touched.
--
-- Shape: an array of "shift exceptions" (see Aegis src/lib/engine/event-shifts.ts):
--   { "mode": "add",
--     "shift_name": "Swim Meet", "start_time": "07:00", "end_time": "14:00",
--     "roles": [{ "role": "Lifeguard", "count": 3 }],
--     "replaces_shift_name": "Afternoon"   -- optional; omit = additive (default)
--   }
--   { "mode": "stretch",
--     "shift_name": "Morning", "start_time": "06:00",   -- new hours (optional)
--     "roles": [{ "role": "Lifeguard", "count": 3 }]    -- count override (optional)
--   }
--
-- Default is ADDITIVE: an "add" shift runs alongside the normal schedule and is
-- staffed from the same roster. It removes a normal shift only when the manager
-- explicitly asked, via "replaces_shift_name".
-- ============================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_shifts jsonb;
