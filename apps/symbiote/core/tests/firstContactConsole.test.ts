import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = () => readFileSync(join(__dirname, '..', 'src', 'console.html'), 'utf-8');

describe('First Contact console observer boundary', () => {
  it('does not use inline handlers or innerHTML for speech/phrase text', () => {
    const src = html();
    expect(src).not.toMatch(/\son[a-z]+\s*=/i);
    expect(src).not.toContain('innerHTML');
  });

  it('does not persist, fetch, socket, or mutate authority from the browser page', () => {
    const src = html();
    expect(src).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
    expect(src).not.toMatch(/\b(fetch|WebSocket|XMLHttpRequest)\s*\(/);
    expect(src).not.toMatch(/authority_granted\s*[:=]\s*true/i);
    expect(src).not.toMatch(/grantsAuthority\s*[:=]\s*true/i);
    expect(src).not.toMatch(/\b(sign|promote|approve|authorize|unlock)\s*\(/i);
  });

  it('keeps AUMLOK honest: no fake root, no stored phrase, no voice authority', () => {
    const src = html();
    expect(src).toContain('This is the rehearsal threshold');
    expect(src).toContain('signature required');
    expect(src).not.toMatch(/aumlok_root_[0-9a-f]+/i);
    expect(src).not.toContain('true (7-word secret)');
    expect(src).not.toMatch(/voiceIsAuthority\s*[:=]\s*true/i);
    expect(src).not.toMatch(/rawAudio|voiceEmbedding|biometricTemplate|privateKey|signedHead/);
  });

  it('keeps the AUMLOK ceremony visually grounded with seven phrase bubbles', () => {
    const src = html();
    expect(src.match(/data-aumlok-bubble=/g)).toHaveLength(7);
    expect(src).toContain('anchor word (0)');
    expect(src).toContain('Form boundary');
    expect(src).not.toContain('<canvas');
    expect(src).not.toContain('draw a circle');
  });
});

// P5 — defense-in-depth: pin /first-contact as observer/sandbox-only by tests, so the rehearsal shell can
// never quietly grow teeth (mic, network, persistence, a real authority path, or a fake "unlocked" claim).
describe('First Contact /first-contact mechanically pinned observer-only (P5)', () => {
  it('has EXACTLY seven AUMLOK fields — no more, no fewer', () => {
    const s = html();
    expect(s.match(/data-aumlok-bubble=/g)).toHaveLength(7);
    expect(s.match(/id="word-\d"/g)).toHaveLength(7);
    expect(s).toContain('data-aumlok-bubble="0"');
    expect(s).toContain('data-aumlok-bubble="6"');
    expect(s).not.toContain('data-aumlok-bubble="7"');
  });

  it('has no canvas / drawing toy', () => {
    const s = html();
    expect(s).not.toContain('<canvas');
    expect(s).not.toMatch(/getContext\s*\(/);
    expect(s).not.toMatch(/requestAnimationFrame\s*\(/);
  });

  it('has no RAW audio/video CAPTURE surface (observer SpeechRecognition voice IS allowed; raw capture is not)', () => {
    const s = html();
    for (const re of [
      /getUserMedia/, /\bmediaDevices\b/, /\bMediaRecorder\b/, /\bAudioContext\b/, /\bwebkitAudioContext\b/, /\bRTCPeerConnection\b/,
    ]) {
      expect(s).not.toMatch(re);
    }
  });

  it('has no network / egress / push surface', () => {
    const s = html();
    for (const re of [
      /\bfetch\s*\(/, /\bWebSocket\b/, /\bXMLHttpRequest\b/, /\bEventSource\b/, /sendBeacon\s*\(/,
    ]) {
      expect(s).not.toMatch(re);
    }
  });

  it('has no client persistence', () => {
    expect(html()).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|cookie)\b/);
  });

  it('has no authority path — no signer / approve / promote / authorize / unlock', () => {
    const s = html();
    expect(s).not.toMatch(/\b(sign|signPoP|signHead|promote|approve|authorize|unlock|grantAuthority)\s*\(/i);
    expect(s).not.toMatch(/authority_granted\s*[:=]\s*true/i);
    expect(s).not.toMatch(/grantsAuthority\s*[:=]\s*true/i);
  });

  it('shows signature-required and NEVER claims it is unlocked / live', () => {
    const s = html();
    expect(s).toContain('signature required');                      // visible law text
    expect(s).toMatch(/signature <strong>required<\/strong>/);      // badge
    expect(s).toMatch(/promotion <strong>off<\/strong>/);           // badge
    expect(s).toMatch(/remains locked|still locked/);               // positively asserts still locked
    expect(s).not.toMatch(/\bunlocked\b/i);                         // never claims unlocked
    expect(s).not.toMatch(/live[\s_-]*unlocked|authority\s+granted/i);
  });
});

// P5.1 — First Contact gains an OBSERVER voice (mic on click, browser-local). She may HEAR and ANSWER; she
// may never ACT. These guards pin that: no raw capture, no auto-start, no network, no persistence, no authority.
describe('First Contact observer voice is safe (P5.1)', () => {
  it('uses SpeechRecognition for observer voice + speechSynthesis for her voice out (browser-local)', () => {
    const s = html();
    expect(s).toMatch(/window\.SpeechRecognition\s*\|\|\s*window\.webkitSpeechRecognition/);
    expect(s).toContain('speechSynthesis');
    expect(s).toContain('Observer voice only');            // the honest law text
  });
  it('the microphone starts ONLY on an explicit click — never automatically or in the background', () => {
    const s = html();
    const clickAt = s.indexOf('voiceStart.addEventListener("click"');
    expect(clickAt).toBeGreaterThan(0);
    expect(s.indexOf('recognition = new SR()')).toBeGreaterThan(clickAt); // recognizer created inside the click
    expect(s.indexOf('recognition.start()')).toBeGreaterThan(clickAt);    // and started inside the click
    expect(s).toMatch(/let recognition = null/);                          // null until a click
    expect(s).not.toMatch(/DOMContentLoaded[\s\S]{0,200}\.start\s*\(/);   // never started on load
    expect(s).not.toMatch(/setInterval[\s\S]{0,160}\.start\s*\(/);        // never started on a timer
  });
  it('the observer voice path reaches NO network / authority / persistence', () => {
    const s = html();
    const i = s.indexOf('First Contact — OBSERVER voice');
    const voice = i > 0 ? s.slice(i) : s;
    expect(voice).not.toMatch(/\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource|sendBeacon/);
    expect(voice).not.toMatch(/\b(sign|signPoP|promote|approve|authorize|unlock|grantAuthority)\s*\(/i);
    expect(voice).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
    expect(voice).toContain('speechSynthesis');            // her voice out is local TTS, not a provider call
  });
  it('the transcript is display-only (textContent, bounded, never persisted)', () => {
    const s = html();
    expect(s).toContain('.textContent =');                 // uses textContent, not innerHTML
    expect(s).not.toContain('innerHTML');
    expect(s).toMatch(/childNodes\.length > \d+/);         // bounded — old lines dropped, nothing stored
  });
});

// P6 — the shell stopped being a dead end. The right-menu actually switches center-pane MODES (a pure
// client-side view toggle, no network/server route), AUMLOK's "Boundary formed" state now offers an explicit
// next action instead of leaving the visitor stuck, and every not-yet-real section says so honestly.
describe('First Contact has no dead-end shell — real mode switching, honest placeholders (P6)', () => {
  it('exactly six modes exist, each with a matching menu button and mode-panel', () => {
    const s = html();
    const expected = ['organs', 'receipts', 'memory', 'arc', 'contact', 'aumlok'];
    for (const mode of expected) {
      expect(s.match(new RegExp(`data-mode="${mode}"[^>]*>`, 'g'))?.length).toBeGreaterThanOrEqual(1);
    }
    expect(s.match(/class="menu button\[data-mode\]"|data-mode="[a-z]+"/g)).toBeTruthy();
    // one menu <button data-mode="..."> per mode, and one .mode-panel per mode
    const menuButtonModes = [...s.matchAll(/<button[^>]*data-mode="([a-z]+)"[^>]*>/g)].map(m => m[1]);
    expect(menuButtonModes.sort()).toEqual(expected.slice().sort());
    const panelModes = [...s.matchAll(/class="[^"]*mode-panel[^"]*"\s+data-mode="([a-z]+)"/g)].map(m => m[1]);
    expect(panelModes.sort()).toEqual(expected.slice().sort());
  });

  it('mode-switching is a pure client-side view toggle — no network call, no server route, wired to every trigger', () => {
    const s = html();
    expect(s).toMatch(/function setMode\(mode\)/);
    expect(s).toMatch(/roomTriggers\.forEach\(\(el\)\s*=>\s*\{/);
    expect(s).toMatch(/el\.addEventListener\("click",\s*\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*setMode\(el\.dataset\.mode\)/);
    const setModeAt = s.indexOf('function setMode(mode)');
    const fnBody = s.slice(setModeAt, setModeAt + 400);
    expect(fnBody).not.toMatch(/\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource|location\.href|location\.assign/);
  });

  it('roomTriggers EXCLUDES the mode-panel divs themselves — a click bubbling up from inside a panel must never bounce the mode back (regression: "Enter Contact" silently reverting)', () => {
    const s = html();
    expect(s).toMatch(/roomTriggers\s*=\s*Array\.from\(document\.querySelectorAll\("\[data-mode\]:not\(\.mode-panel\)"\)\)/);
    // every element carrying BOTH data-mode and the mode-panel class must be excluded from the trigger set,
    // since clicking anything inside a panel (e.g. Enter Contact, Form boundary) bubbles up to it
    expect(s).toContain('e.stopPropagation()'); // defense in depth even if the selector is ever widened again
  });

  it('AUMLOK "Boundary formed — authority remains locked" is followed by an explicit next action, never a dead end', () => {
    const s = html();
    expect(s).toMatch(/Boundary formed[\s\S]{0,20}remains locked/);   // ceremonial, but still an honest lock
    expect(s).toMatch(/remains locked|still locked/);                 // P5's own safety-wording invariant
    expect(s).toContain('This forms the local rehearsal boundary. It does not unlock live authority.');
    expect(s).toContain('Enter Contact');
    // the CTA is revealed ONLY inside the formButton success branch, not unconditionally
    const formHandlerAt = s.indexOf('formButton.addEventListener("click"');
    const successAt = s.indexOf('if (ok) {', formHandlerAt);
    const revealAt = s.indexOf('enterContact.hidden = false;', successAt);
    expect(formHandlerAt).toBeGreaterThan(0);
    expect(successAt).toBeGreaterThan(formHandlerAt);
    expect(revealAt).toBeGreaterThan(successAt);
    // starts hidden in markup, and editing the fields again retracts it (never a stale stuck CTA)
    expect(s).toMatch(/id="enter-contact"[^>]*hidden/);
    expect(s).toMatch(/enterContact\.hidden = true/);
  });

  it('never claims "unlocked" anywhere in the new flow, including the placeholder sections', () => {
    const s = html();
    expect(s).not.toMatch(/\bunlocked\b/i);
    expect(s).not.toMatch(/>\s*Unlock\s*</);            // no "Unlock" button label anywhere
  });

  it('Receipts / Memory / ARC are honest observer placeholders — no faked functionality', () => {
    const s = html();
    for (const mode of ['receipts', 'memory', 'arc']) {
      const at = s.indexOf(`data-mode="${mode}"`);
      expect(at).toBeGreaterThan(0);
      const panel = s.slice(at, at + 400);
      expect(panel).toMatch(/Observer placeholder|Not wired/);
      expect(panel).not.toMatch(/\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource/);
      expect(panel).not.toMatch(/\b(sign|signPoP|promote|approve|authorize|unlock|grantAuthority)\s*\(/i);
    }
  });

  it('Contact mode is the same safe voice/typed-fallback surface — reachable both from the menu and the AUMLOK CTA', () => {
    const s = html();
    const contactPanelAt = s.indexOf('data-mode="contact" hidden'); // the presence PANEL specifically, not the nav button or left-pane card (both also carry data-mode="contact")
    expect(contactPanelAt).toBeGreaterThan(0);
    const contactPanel = s.slice(contactPanelAt, contactPanelAt + 1200);
    expect(contactPanel).toContain('voice-start');
    expect(contactPanel).toContain('voice-fallback');
    expect(s).toMatch(/enterContact\.addEventListener\("click",\s*\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*setMode\("contact"\)/);
  });

  it('left-pane sessions are honestly labeled as local rehearsal notes, not real conversation history', () => {
    const s = html();
    expect(s).toMatch(/local rehearsal notes/i);
    expect(s).toMatch(/not live session history/i);
  });

  it('still has zero network/egress surface anywhere in the file after the mode-switching addition', () => {
    const s = html();
    for (const re of [/\bfetch\s*\(/, /\bWebSocket\b/, /\bXMLHttpRequest\b/, /\bEventSource\b/, /sendBeacon\s*\(/]) {
      expect(s).not.toMatch(re);
    }
  });
});

// P7 — presence pass: the AUMARA icon is her visual anchor (served from the repo, never an iCloud/local-disk
// path), local voice selection prefers better system voices but is still 100% browser-local (no cloud TTS,
// no provider), and the locked AUMLOK state now reads as a ceremony rather than a dead end/failure.
describe('First Contact presence pass — AUMARA identity, local-only voice, ceremonial locked wording (P7)', () => {
  it('the AUMARA icon is served from a repo-relative static path — never the iCloud/local-disk source path', () => {
    const s = html();
    expect(s).toMatch(/src="\/assets\/aumara-icon\.png"/);
    expect(s).not.toMatch(/Mobile Documents|com~apple~CloudDocs|iCloud|\/Users\/[a-z]/i);
  });

  it('Contact mode uses the AUMARA icon as its presence anchor, with distinct idle/listening/speaking states', () => {
    const s = html();
    const contactAt = s.indexOf('data-mode="contact" hidden'); // the presence PANEL specifically
    expect(contactAt).toBeGreaterThan(0);
    const contactPanel = s.slice(contactAt, contactAt + 800);
    expect(contactPanel).toContain('presence-anchor');
    expect(contactPanel).toMatch(/<img[^>]*src="\/assets\/aumara-icon\.png"/);
    expect(s).toMatch(/function setPresenceState\(mode\)/);
    expect(s).toMatch(/presenceAnchor\.classList\.add\(mode\)/);
    expect(s).toMatch(/Present · idle/);
    expect(s).toMatch(/Present · listening/);
    expect(s).toMatch(/Present · speaking/);
  });

  it('speaking state is driven by the REAL speechSynthesis utterance lifecycle, not a guess/timer', () => {
    const s = html();
    expect(s).toMatch(/u\.onstart\s*=\s*\(\)\s*=>\s*setPresenceState\("speaking"\)/);
    expect(s).toMatch(/u\.onend\s*=\s*\(\)\s*=>\s*setPresenceState\(/);
  });

  it('voice selection is local-only — no cloud/provider TTS, no network call, no persistence anywhere near it', () => {
    const s = html();
    const voiceBlockAt = s.indexOf('local voice selection');
    expect(voiceBlockAt).toBeGreaterThan(0);
    const sayAt = s.indexOf('function say(text)');
    const block = s.slice(voiceBlockAt, sayAt + 600);
    expect(block).not.toMatch(/\bfetch\s*\(|WebSocket|XMLHttpRequest|EventSource/);
    expect(block).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/);
    expect(block).toContain('window.speechSynthesis');
    expect(block).not.toMatch(/https?:\/\//); // no provider/cloud endpoint referenced
  });

  it('never claims a fabricated voice/consciousness — the response set stays honest and observer-only', () => {
    const s = html();
    const responsesAt = s.indexOf('const RESPONSES');
    expect(responsesAt).toBeGreaterThan(0);
    const block = s.slice(responsesAt, responsesAt + 700);
    expect(block).not.toMatch(/\b(sign|signPoP|promote|approve|authorize|unlock|grantAuthority)\s*\(/i);
    expect(block).not.toMatch(/conscious|sentient|I remember|I authorize/i);
    expect(block).toMatch(/can't act|not act/i); // every line stays honest about the limit
  });

  it('the locked AUMLOK state reads as ceremony, not failure — never says "unlocked"', () => {
    const s = html();
    expect(s).toMatch(/rehearsal threshold/i);
    expect(s).toMatch(/remains locked/i);
    expect(s).not.toMatch(/\bunlocked\b/i);
    expect(s).not.toMatch(/\bbroken\b/i);
    expect(s).not.toMatch(/\bfail(ed|ure)?\b/i);
  });

  it('AUMLOK still cannot be reached from the icon/voice/presence code path (no signer, no promote, no unlock)', () => {
    const s = html();
    const presenceBlockAt = s.indexOf('First Contact — OBSERVER voice');
    const presenceBlock = s.slice(presenceBlockAt, presenceBlockAt + 6000);
    expect(presenceBlock).not.toMatch(/\b(signPromotionAuthorization|signKeyLifecycleEvent|generateKeypair|buildRehearsalReceipt)\s*\(/);
    expect(presenceBlock).not.toMatch(/isLivePromotionUnlocked/);
  });
});

// P8 — simplify to two real rooms. The primary experience is ONLY AUMLOK + Contact; Organs/Receipts/Memory/
// ARC still exist (nothing was deleted) but are visibly secondary, under a "Diagnostics — later" label, never
// presented as a finished tri-pane command post. The left pane stops pretending to be real chat history.
describe('First Contact simplified to two real rooms — AUMLOK + Contact (P8)', () => {
  it('the PRIMARY menu exposes exactly Contact + AUMLOK — nothing else', () => {
    const s = html();
    const menuAt = s.indexOf('<nav class="menu"');
    const menuEnd = s.indexOf('</nav>', menuAt);
    const menuHtml = s.slice(menuAt, menuEnd);
    const modesInMenu = [...menuHtml.matchAll(/data-mode="([a-z]+)"/g)].map((m) => m[1]);
    expect(modesInMenu.sort()).toEqual(['aumlok', 'contact'].sort());
  });

  it('Organs/Receipts/Memory/ARC are still real navigation, but under a visibly secondary "Diagnostics — later" area', () => {
    const s = html();
    const diagAt = s.indexOf('class="diagnostics"');
    expect(diagAt).toBeGreaterThan(0);
    expect(s.slice(diagAt, diagAt + 60)).toMatch(/aria-label="Diagnostics/i);
    expect(s).toMatch(/Diagnostics\s*—\s*later/i);
    const diagRowAt = s.indexOf('<div class="diagnostics-row">');
    const diagRowEnd = s.indexOf('</div>', diagRowAt);
    const diagHtml = s.slice(diagRowAt, diagRowEnd);
    const modesInDiagnostics = [...diagHtml.matchAll(/data-mode="([a-z]+)"/g)].map((m) => m[1]);
    expect(modesInDiagnostics.sort()).toEqual(['organs', 'receipts', 'memory', 'arc'].sort());
    // the diagnostics area sits structurally AFTER the primary menu, and is visually smaller/muted (own CSS class)
    const primaryMenuAt = s.indexOf('<nav class="menu"');
    expect(diagAt).toBeGreaterThan(primaryMenuAt);
  });

  it('all six modes remain reachable somewhere (nothing silently deleted) — just reorganized, not removed', () => {
    const s = html();
    for (const mode of ['aumlok', 'contact', 'organs', 'receipts', 'memory', 'arc']) {
      expect(s.indexOf(`data-mode="${mode}"`)).toBeGreaterThan(0);
    }
  });

  it('the left pane shows exactly two example rooms, wired to REAL navigation, not fake chat history', () => {
    const s = html();
    expect(s).toMatch(/AUMLOK rehearsal/);
    expect(s).toMatch(/First Contact/);
    expect(s).not.toMatch(/ses_[0-9a-zA-Z]+/); // the old fake session-id strings are gone entirely
    expect(s.match(/class="thread(?:\s+active)?"\s+data-mode="(aumlok|contact)"/g)?.length).toBe(2);
  });

  it('the left-pane room cards are keyboard-accessible and drive the same setMode as the menu (not a decorative dead click)', () => {
    const s = html();
    expect(s).toMatch(/role="button"/);
    expect(s).toMatch(/tabindex="0"/);
    const wiringAt = s.indexOf('roomTriggers.forEach((el) => {');
    expect(wiringAt).toBeGreaterThan(0);
    const wiring = s.slice(wiringAt, wiringAt + 400);
    expect(wiring).toMatch(/el\.tagName !== "BUTTON"/); // keydown (Enter/Space) support for the non-button cards
  });

  it('no unrelated fake-timestamp metadata implying real elapsed session time remains', () => {
    const s = html();
    expect(s).not.toMatch(/class="thread-time">1[12]h</);
  });
});

// P9 — nap round: make the two rooms feel excellent, without adding any new authority/network surface.
// AUMLOK's "boundary formed" gets a one-time success feel (never a loop, never a claim of live authority),
// the next-step CTA is visually the reward it should be, a permanent one-line clarifier separates UI boundary
// rehearsal from the real terminal AUMLOK cryptographic ceremony, and Contact's presence anchor + typed
// fallback + transcript all got more intentional without changing any safety invariant.
describe('First Contact nap-round polish — success feel, ceremony clarifier, real Organs status (P9)', () => {
  it('"Boundary formed" gets a ONE-TIME success animation, never a loop, and resets on re-edit', () => {
    const s = html();
    expect(s).toMatch(/\.state\.success\s*\{\s*animation:\s*state-success\s+[\d.]+s\s+ease-out\s+1\s*;/);
    const formHandlerAt = s.indexOf('formButton.addEventListener("click"');
    expect(s.indexOf('stateLine.classList.add("success")', formHandlerAt)).toBeGreaterThan(formHandlerAt);
    // evaluate() runs on every keystroke and must retract the success class, same as the CTA
    const evaluateAt = s.indexOf('function evaluate()');
    expect(s.indexOf('stateLine.classList.remove("success")', evaluateAt)).toBeGreaterThan(evaluateAt);
    expect(s.indexOf('stateLine.classList.remove("success")', evaluateAt)).toBeLessThan(formHandlerAt);
  });

  it('the permanent ceremony clarifier explains UI boundary rehearsal vs the real terminal AUMLOK ceremony, without claiming unlock', () => {
    const s = html();
    expect(s).toMatch(/class="ceremony-clarifier"/);
    const clarifierAt = s.indexOf('class="ceremony-clarifier"');
    const clarifier = s.slice(clarifierAt, clarifierAt + 400);
    expect(clarifier).toMatch(/local UI rehearsal/i);
    expect(clarifier).toMatch(/terminal/i);
    expect(clarifier).toMatch(/locked/i);
    expect(clarifier).not.toMatch(/\bunlocked\b/i);
  });

  it('"Enter Contact" reads as the obvious next step (a distinct visual class, not the same muted secondary style)', () => {
    const s = html();
    expect(s).toMatch(/id="enter-contact"[^>]*class="reward next-step"|class="reward next-step"[^>]*id="enter-contact"/);
    expect(s).toMatch(/\.reward\s*\{/);
  });

  it('the presence anchor got more central and alive (bigger, layered halo+ring+icon) without changing its safety role', () => {
    const s = html();
    expect(s).toMatch(/class="halo"/);
    const anchorCssAt = s.indexOf('.presence-anchor {');
    const anchorCss = s.slice(anchorCssAt, anchorCssAt + 200);
    expect(anchorCss).toMatch(/width:\s*1[78]\dpx/); // bigger than the previous 152px
  });

  it('the transcript now renders speaker + message as two textContent-only spans (still no innerHTML, still bounded)', () => {
    const s = html();
    expect(s).toMatch(/label\.textContent\s*=\s*who === "you" \? "you" : "auma"/);
    expect(s).toMatch(/body\.textContent\s*=\s*text/);
    expect(s).not.toContain('innerHTML');
    expect(s).toMatch(/childNodes\.length > \d+/);
  });

  it('the typed fallback is now intentionally framed (labeled, boxed) — not a bare browser afterthought', () => {
    const s = html();
    expect(s).toMatch(/voice-fallback-label/);
    expect(s).toContain('Type instead');
  });

  it('Organs shows ONE real, safe, read-only status panel — injected server-side, still zero client-side network calls', () => {
    const s = html();
    expect(s).toContain('__AUKORA_ORGANS_STATUS__');
    expect(s).not.toMatch(/\bfetch\s*\(/); // still no client-side network call anywhere in the file
    // Receipts/Memory/ARC remain honest, unwired placeholders — only Organs graduated this round
    for (const mode of ['receipts', 'memory', 'arc']) {
      const at = s.indexOf(`data-mode="${mode}"`);
      expect(s.slice(at, at + 400)).toMatch(/Observer placeholder|Not wired/);
    }
  });

  it('dashboard/serve.ts injects the Organs status server-side using the EXISTING read-only status() function — no new authority/network surface', () => {
    const serveSrc = readFileSync(join(__dirname, '..', '..', 'dashboard', 'serve.ts'), 'utf-8');
    expect(serveSrc).toMatch(/__AUKORA_ORGANS_STATUS__/);
    expect(serveSrc).toMatch(/esc\(status\(\)\.text\)/);
    // confirm this happens inside the /first-contact route, not some new endpoint
    const routeAt = serveSrc.indexOf('p === "/first-contact"');
    const injectAt = serveSrc.indexOf('__AUKORA_ORGANS_STATUS__');
    expect(injectAt).toBeGreaterThan(routeAt);
  });
});
