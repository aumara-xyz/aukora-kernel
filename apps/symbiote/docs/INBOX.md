# Inbox — voice-safe lane handoff (sanitized)

This file is the shared mailbox anchor for the coordination lanes. Its round-report
**entries are runtime state and are not committed to the public tree**: a public-safety
sanitation pass (R25) removed the prior private lane handoffs, and the append tool
(`core/src/inboxAppend.ts`) re-creates entries locally at runtime under the anchor below.

Nothing in this file grants authority. It is advisory context only.

## Round reports for Auma
