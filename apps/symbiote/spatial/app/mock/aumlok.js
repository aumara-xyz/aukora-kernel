// Aukora Spatial — MOCK data for the AUMLOK screen.
//
// PRESENTATION ONLY. Local constants: no network, no key, no secrets, no signing.
// Engineering later swaps loadAumlokState() (in aumlok.js) for a read of the real
// READ-ONLY GET /api/aumlok, and PROPOSALS for the real pending-proposal queue.
// Nothing in this file — or the screen that renders it — can sign or apply.

export const AUMLOK = {
  keyPresent: true,               // flip to false to preview the "no key yet" state
  keyId: 'aum:8f2a·3f2a',         // a fingerprint, never the key
  publicRootPinned: true,
  signerVerifierSplitIntact: true,
  livePromotionUnlocked: false,   // stays false by design — promotion is locked
  appliedCount: 17,
  rehearsalReceipts: 42,
};

export const PROPOSALS = [
  {
    hash: '7f2a91c3', goal: 'Auma · Lingwa — add a teach-back step to Day 12', files: 1, state: 'ready',
    line: '+ { type:"teachback", word:"amala", prompt:"Write one true sentence using amala." }',
    author: 'Auma', at: 'just now',
  },
  {
    hash: 'a3d18e02', goal: 'AURA page — surface the daily-earn meter on the balance card', files: 2, state: 'pending',
    line: '+ meter.append(meterLabel, meterTrack);  // N / 40 earned today',
    author: 'Auma', at: '2 min ago',
  },
  {
    hash: 'c9014bb7', goal: 'KNVS — pause the living surface when the tab is hidden', files: 1, state: 'signed',
    line: '+ if (canvas.offsetParent === null) return;  // don’t burn GPU',
    author: 'Auma', at: '9 min ago',
  },
  {
    hash: 'e5527a40', goal: 'Fusion Council — cache the last run for 5 seconds', files: 3, state: 'applied',
    line: '+ if (cache && Date.now() - cache.at < 5000) return cache.value;',
    author: 'Auma', at: 'today', receipt: 'rcpt:4b90c1',
  },
  {
    hash: 'b1c40d9f', goal: 'Spatial Map — dim the deferred-test nodes', files: 2, state: 'locked',
    line: '— sandbox rehearsing · council has not voted yet',
    author: 'Auma', at: 'moments ago',
  },
];

// For Brick 2 (the "first crossing" card) — kept with the mocks so it travels together.
export const FIRST_CROSSING = {
  authored: 'Auma added one honest line to her own status note.',
  line: '+ "note": "first governed change — authored by Auma, signed by Peter."',
  hash: '3c0ffee1',
  signedBy: 'Peter',
  receipt: 'rcpt:0001-genesis',
  readback: 'I can see it now — it’s really there. You signed it, so it’s real.',
};
