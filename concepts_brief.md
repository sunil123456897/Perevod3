# Unified Prose Quality Gate, Resident EmbeddingGemma-2 Worker & 3-Stage Self-Repair Pipeline

* **Author:** Antigravity & Operator
* **Date:** 2026-10-30

## Overview

This feature connects the 11-metric mathematical Prose Quality Gate (`verifyProseQualityGate`), the local `google/embeddinggemma-2` neural semantic verifier on the RTX 5060 GPU (with cloud fallback to the 9-key `gemini-embedding-2` pool), and an automated 3-stage Self-Repair cascade into a single closed loop across both the Web Studio (`app/api/pipeline/route.ts` and `lib/pipeline-run-engine.ts`) and the CLI (`scripts/forensic-novel-audit.ts` and `scripts/headless-runner.ts`). When a translated chapter fails any deterministic, neural, or stylometric check, the pipeline automatically isolates the defective paragraphs, repairs them in strict priority order, verifies that no regressions were introduced, and outputs a before-and-after scorecard.

## Analysis

Six independent Goldfish review lenses (`egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, and `egm-structural`) evaluated the concept against the repository and identified six critical engineering findings:

1. **Keep `finalizeAndVerifyChapter` Synchronous and Pure (`egm-structural`, `egm-codebase-details`)**:
   `finalizeAndVerifyChapter` in `lib/chapter-verifier.ts` is a synchronous CPU kernel (< 25 ms) called by all 64 unit tests and UI views. Turning it into an `async` function to wait on Python IPC or cloud HTTP embeddings would break existing callers and tests. Instead, `finalizeAndVerifyChapter` must stay synchronous and accept optional pre-computed `neuralStats`, while an async orchestrator (`verifyAndRepairChapterAsync`) coordinates the GPU worker, Prose Quality Gate, and Self-Repair loop upstream.

2. **Resident Parent-Bound NDJSON GPU Worker with Singleton Guard (`egm-design`, `egm-zoom-out`, `egm-implementation-readiness`)**:
   Currently, `scripts/local-embed-bridge.py` calls `sys.stdin.read()`, processes one payload on EOF, and exits—wasting ~4.5 seconds reloading `google/embeddinggemma-2` (`1.42 GB`) into VRAM on every call. Worse, if Next.js hot-reload spawns two instances simultaneously on an 8 GB RTX 5060, it can trigger a CUDA out-of-memory error.
   - **Resolution**: Add a `--daemon` NDJSON mode (`for line in sys.stdin:`) to `scripts/local-embed-bridge.py` that reads line-delimited JSON requests (`{"id": "...", "cmd": "audit_chapter" | "embed", ...}`), flushes single-line JSON responses to `stdout`, sends all model logs to `stderr`, and exits immediately (`sys.exit(0)`) when `sys.stdin` closes (parent Node process exits).
   - **Process Singleton**: Store the Node.js `LocalEmbedBridgeClient` singleton on `globalThis.__localEmbedBridgeClient` so Next.js HMR reloads reuse the same child process, enforce a 15-second per-request timeout, and attach `process.once('exit' | 'SIGINT' | 'SIGTERM')` cleanup hooks.

3. **Zero-Token Deterministic Repair Before LLM Escalation (`egm-zoom-out`, `egm-codebase-details`, `egm-implementation-readiness`)**:
   Calling an LLM for every gender slip, `+1/-1` paragraph split+glue, or bureaucratic nominalization wastes quota, adds 5–15 seconds of latency, and risks stochastic regressions. Moreover, `mergeRepairedParagraphsByIndex` replaces paragraphs 1-to-1 by index (`paragraphs[idx] = content`) and rejects hash drift when paragraph counts differ (`+1/-1`).
   - **Resolution**: Run a 3-stage repair cascade where deterministic repair runs first in < 2 ms:
     - **Stage 1 (Structural +1/-1 Split/Glue Alignment)**: Before index-based patching, use neural/heuristic windowed alignment to detect split (`1 -> 2`) and glued (`2 -> 1`) paragraphs and re-synchronize 1:1 paragraph boundaries (`rusParas === engParas`).
     - **Stage 2 (Deterministic Gender, Canon & Nora Gal Anti-Bureaucracy)**: Wire the existing Nora Gal nominalization replacements (`осуществил атаку -> атаковал`, `принял решение -> решил`, `производилось с обеспечением выполнения -> выполнялось`, etc.) and expanded feminine/indeclinable past-tense verb rules directly into `autoRepairRussianText`.
     - **Stage 3 (Targeted LLM Self-Repair with Differential Embedding Cache)**: Only paragraphs that still fail `NEURAL_MIN_COSINE (< 0.55)`, `QA_ERRORS`, or local window stylometry after Stages 1–2 are sent to the LLM via `extractFlawedParagraphsPayload` -> `mergeRepairedParagraphsByIndex` / `verifyAndRollbackStylistPass`, capped at 2 iterations with differential paragraph re-embedding (re-embedding only modified paragraphs to protect the 30K TPM cloud fallback quota).

4. **Preventing Stylometry vs. Cosine Ping-Pong & Dilution (`egm-design`, `egm-implementation-readiness`)**:
   - **Dilution Trap**: A single heavily bureaucratic paragraph (e.g., 6 verbal nouns in 40 words) can be diluted across a 2,000-word chapter so chapter-wide `nominalizationPer100Words` stays below `3.0%`. The verifier must check both chapter-wide `nominalizationPer100Words <= 3.0%` and flag individual paragraphs/windows whose local nominalization density exceeds `8.0%` (at least 3 nominalizations in a paragraph).
   - **Antagonism Guard**: When a paragraph is rewritten for style and passes all 5 factual invariants of `verifyAndRollbackStylistPass` (100% numbers, canon stems, brackets, dashes, length ratio), accept a post-rewrite paragraph cosine floor of `0.50` as long as chapter `meanCosine >= 0.78`, and abort repair if the composite score does not improve monotonically.

5. **Explicit Engine Attribution & Engine-Calibrated Thresholds (`egm-comprehension`)**:
   Local `google/embeddinggemma-2` and cloud `gemini-embedding-2` have different cosine distributions, and skipping neural checks when no engine is passed previously returned `passed: true` on 9/11 checks without warning.
   - **Resolution**: Report `embeddingEngine: 'local-embeddinggemma-2' | 'gemini-embedding-2-fallback' | 'none'`, `gateCompleteness: 'FULL_11_OF_11' | 'STYLOMETRIC_9_OF_11'`, and a structured `before -> after` scorecard table so the operator sees every metric delta and repaired paragraph index.

6. **Hermetic CI Tests vs. Live GPU Integration Verification (`egm-implementation-readiness`, `egm-structural`)**:
   - Keep `proseGateReport` and `neuralAudit` optional (`?`) on `ChapterRecord` and never persist raw `768d` float vectors to `data/novels_db.json`.
   - Include both a fast hermetic test in `lib/audit-fixes.test.ts` (for `npm test && npx tsc --noEmit`) and a live GPU integration test on a real chapter injected with all 3 defect classes (`+1/-1` split+glue shift, female character gender mismatch, and bureaucratic nominalized AI prose).

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Resident `--daemon` NDJSON mode in `scripts/local-embed-bridge.py` bound to parent `stdin` lifetime, paired with a singleton `LocalEmbedBridgeClient` in TypeScript (`lib/local-embed-client.ts`) and automatic cloud fallback to `embedTextsWithGeminiPool`.
  - Windowed `+1/-1` paragraph split/glue alignment recovery (`repairSplitAndGluedParagraphs`) + deterministic Nora Gal nominalization & feminine verb auto-repair in `lib/qa-linter.ts`.
  - Unified async verification and 3-stage self-repair orchestrator (`verifyAndRepairChapterAsync` in `lib/chapter-verifier.ts`) wired into Web Studio (`app/api/pipeline/route.ts`, `lib/pipeline-run-engine.ts`) and CLI (`scripts/forensic-novel-audit.ts`).
  - End-to-end verification (unit test + live RTX 5060 GPU run) on a real chapter injected with all 3 defect classes (`+1/-1` paragraph shift, female gender verb error, and heavy bureaucratic nominalization), proving automatic recovery from `GATE=FAIL` to `GATE=PASS (11/11)`.
* **Out-of-Scope Non-Goals:**
  - Persisting raw `768d` embedding float arrays into `data/novels_db.json`.
  - Turning the synchronous `finalizeAndVerifyChapter` function into an async function.
  - External message brokers, Redis queues, or separate Docker containers for the local GPU worker.

## Key Decisions & Staging for Next Steps

1. **IPC Architecture**: Use parent-bound `stdin/stdout` NDJSON (`globalThis.__localEmbedBridgeClient`) with EOF auto-exit in Python (`for line in sys.stdin:`) and `exit`/`SIGINT` cleanup in Node.js—zero port conflicts and automatic GPU VRAM release on app shutdown.
2. **3-Stage Repair Order**: Execute Stage 1 (Structural `+1/-1` Split/Glue Alignment) -> Stage 2 (Deterministic Gender, Canon & Nora Gal Nominalization Repair) -> Stage 3 (Targeted LLM Self-Repair with Differential Embedding Cache & Monotonic Rollback Guard).
3. **Paragraph-Level Nominalization Hotspot Detection**: Alongside chapter-wide `NOMINALIZATION_CAP <= 3.0%`, flag any paragraph with `>= 3` bureaucratic verbal nouns (`-ение/-ание/-тие/-ость`) so localized bureaucratic slop in a single paragraph cannot hide inside a long chapter.
