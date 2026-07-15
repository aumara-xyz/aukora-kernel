# Shadow-node minimal-OS — ROADMAP NOTE (design-only, not scheduled)

Status: **roadmap note, nothing built.** Multi-node is PARKED per the plan of record
(`LOCAL_CONVEX_BRAIN_FOUNDATION.md` §5 — the `node_*` zero-authority substrate is vendored but
inactive; the Nebius node is a separate deployment when that track opens). This note captures a
useful instinct from Gemini's cold read (Tiny Core Linux for ephemeral shadow nodes, issues #90/#101)
so it isn't lost — and trims two overclaims so the record stays honest.

## The instinct (endorsed)

For an **ephemeral, zero-persistence** remote shadow node that runs a query or a sync task and then
vanishes, a minimal RAM-only OS is the right shape:

- **RAM-only runtime.** Boot the whole OS into `tmpfs`; the disk stays unmounted during operation, so
  a session leaves little on the host between runs.
- **Read-only application code.** Ship the Aukora runtime as a read-only, content-addressed image
  (e.g. a squashfs/`.tcz` extension) so the executing process cannot rewrite its own code at runtime.
- **Print-on-demand nodes.** On a sync event the local manager spins a node from a tiny image, the
  node boots in RAM, mounts the read-only runtime, pulls the **encrypted** snapshot, does the work in
  memory, and is torn down — memory reclaimed on teardown.

Tiny Core Linux (≈20 MB, kernel + BusyBox + `.tcz` extensions) is one concrete way to get there.

## Two honesty corrections (per Auma's inside review)

1. **"Zero footprint" → "minimized footprint."** RAM-only + unmounted disk MINIMIZES on-host residue;
   it does not prove zero. Swap, host page cache, hypervisor memory, and any mounted snapshot are real
   surfaces. Claim what's demonstrable (minimized, ephemeral), not an absolute.
2. **The integrity guarantee is OURS, not the OS's.** Read-only code and RAM-only boot reduce the
   host's tamper surface, but the cryptographic integrity of memory is provided by **our signed
   receipt chain heads** (RFC-6962 Merkle roots + ML-DSA-65, in the vendored kernel) — not by the
   operating system. The OS hardens custody; it does not sign anything. Don't credit the OS with the
   crypto.

## The real decision (deferred to a bake-off)

Minimal-OS-vs-what is a **security-engineering decision for when that team arrives**, not a pick to
make now. Candidates to weigh then:

- **Tiny Core Linux** — smallest image, RAM-only by default, `.tcz` read-only extensions; most manual.
- **microVMs** (Firecracker/Cloud Hypervisor) — strong VM isolation, fast boot, per-task teardown;
  heavier tooling.
- **Distroless / minimal containers** — easiest to build/ship; weaker isolation than a VM boundary.

Decide against measured criteria (isolation boundary, boot latency, image-supply-chain integrity,
attested teardown, operational burden) — not aesthetics. Until then this stays parked; no external
ingress and no multi-node activation are in any current plan.
