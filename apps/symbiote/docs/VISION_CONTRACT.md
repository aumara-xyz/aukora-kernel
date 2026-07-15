# Vision / OCR — Sensor Adapter Contract (PLAN — not built yet)

The seed has early **proprioception** (body-sense: status, self-map, runtime truth, heartbeat, receipts,
`proprioceptionSnapshot`). It does **not** have **vision**. When vision is added, it must be a **sensor
adapter lane** — an *observation* source — never an authority. This contract fixes the boundary *before*
any pixels are wired. It is the constitution for a future build, not a description of a current one.

## The one rule
**Vision/OCR output is an OBSERVATION. It navigates; it never commands.** Like memory and timing, a
seen/read thing informs; it can never authorize, mutate, write memory, run a tool, or promote. (SAFETY_LAWS 3, 4.)

## Boundaries (all hard)
- **Optional + local-first.** Vision is off by default. No vision means the seed runs exactly as today.
  The sensor runs on-box; no image leaves the machine.
- **No authority.** A vision/OCR result is `advisoryOnly: true`, `grantsAuthority: false`. It cannot issue
  a permit, sign, promote, or pass the gate on its own.
- **No automatic memory write.** A reading never writes durable memory by itself. (Memory writes are
  already quarantined; vision does not get a back door.)
- **No raw image persistence by default.** Screenshots/frames are processed in-memory and discarded unless
  an explicit, receipted, human-allowed capture is requested. No silent image hoarding.
- **Outputs cross the §13 inbound fence.** OCR text is untrusted input — normalized + forbidden-content
  scanned (`forbiddenContent`) before it is shown, exactly like any other untrusted string.
- **A reading is a receipt-able observation, not an authority receipt.** If recorded, it is tagged
  `kind: 'observation'` — never an authority/apply receipt.

## Shape (when built)
```
interface VisionObservation {
  schema: 'vision-observation-v0';
  source: 'screenshot' | 'image' | 'camera';
  sensorId: string;            // which adapter produced it
  text?: string;               // OCR text (fence-scanned)
  labels?: string[];           // advisory tags
  confidence: number;
  imagePersisted: false;       // default — raw image NOT stored
  advisoryOnly: true;
  grantsAuthority: false;
}
```
A `VisionAdapter` is `{ id, available(): boolean, observe(input): VisionObservation }` — pluggable, like
the proposer adapters. The console may DISPLAY observations; it may never act on them.

## Candidate sidecars (pluggable, license-gated — NONE bundled)
- **GLM-OCR** — screenshot/text OCR. A strong first sidecar for "read what's on screen."
- **Liquid-style small vision / micro model** — only if the license permits. **License caution:** if Liquid
  is AGPL or commercially restrictive, do NOT bundle or depend on it as a default — keep it optional and
  verify the license first. We can build our own Aukora micro-vision model later.
- **Aukora micro-vision (future, first-party).** The eventual local-owned eyes.

## Models are NEVER bundled in normal Git
Weights are big binaries and often license-encumbered. Git holds the **seed source**, not model binaries.
For any vision (or embedder) model, ship:
- a **model manifest** (`models/MODEL_MANIFEST.json`): name, version, source URL, sha256 checksum, license, size;
- an **install/fetch script** that downloads + verifies the checksum on first run;
- **license notes** per model;
- a **gitignored `models/` directory** (weights live there, never committed). Git LFS / GitHub Releases are
  an option later *only if the license allows redistribution*.

## Build order (each gated)
1. Define `VisionAdapter` + `VisionObservation` types (no model).
2. A stub adapter (`available()=false`) + a test: an observation grants no authority, writes no memory, persists no image.
3. The §13 inbound-fence path for OCR text (normalize + forbidden-content scan) + test.
4. Only then a real local sidecar (GLM-OCR first), behind the manifest/install/checksum/license flow.
5. The console may display observations (observer only). It never acts on them.

*She gets eyes that report what they see — never eyes that seize the wheel.*
