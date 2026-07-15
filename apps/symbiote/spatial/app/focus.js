// Aukora Spatial — PROPRIOCEPTION channel (L0: DOM-first).
//
// The browser publishes "what the owner is looking at right now" so other lanes
// on THIS page (e.g. the chat lane) can know it. For anything rendered inside the
// app the DOM already IS the ground truth — exact, instant, free — so this layer
// needs no vision model at all. (Local VLM/OCR is a later layer, only for pixels
// the DOM can't express: a WebGL canvas, or another app's window.)
//
// Two halves, matching the existing window-CustomEvent convention used across the
// shell (`aura-changed`, `open-organ`, `lane-settled`):
//   window.__aukoraFocus   — a synchronous snapshot, so an on-demand reader can
//                            ask "what's on screen right now" at any moment.
//   'aukora:focus' event   — a live push, for reactive affordances.
//
// IMPORTANT: publishing here sends NOTHING anywhere. Nothing leaves the browser.
// The snapshot only mirrors what is already visible in this same-origin page. A
// reader that wants to hand focus to a model must do so EXPLICITLY, and — per
// governance — behind a visible indicator the owner sees first. See
// docs/PROPRIOCEPTION.md.
//
// TRUST: treat window.__aukoraFocus as UNTRUSTED at READ time. Any same-origin
// script can overwrite it, so a poisoned snapshot is an injection vector the moment
// it rides a model request. A consumer that forwards focus to a model MUST frame/
// escape it — the #53 frameGuard treatment, exactly like recalled memory — never
// pass it raw into a prompt. (The explicit "Ask Auma to read this" button sidesteps
// this entirely: it reads the organ's own in-closure reading state, not this global.)

export function publishFocus(snapshot) {
  try {
    const snap = snapshot ? { ...snapshot, ts: Date.now() } : null;
    window.__aukoraFocus = snap;
    window.dispatchEvent(new CustomEvent('aukora:focus', { detail: snap }));
  } catch { /* focus is best-effort; never break the organ over it */ }
}

// Clear back to "nothing focused" (still on this page, just no specific content).
export function clearFocus() { publishFocus(null); }

// On-demand read for a late reader (e.g. chat's send()): what is on screen now.
export function currentFocus() {
  try { return window.__aukoraFocus || null; } catch { return null; }
}
