import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  buildBurnDataset,
  exportToJSONL,
  exportToEvidence,
  scanForSecrets,
  scanForAuthorityLeakage,
  BurnExport,
  BurnTrace,
  BurnLabel,
  AUTHORITY_BOUNDARY,
} from '../src/burnDataset';

const ROOT = path.resolve(__dirname, '..');
const ALL_LABELS: BurnLabel[] = ['golden', 'refused', 'unsafe', 'contradicted', 'stale', 'needs_human'];

let dataset: BurnExport;

describe('24P: Burn Dataset V0', () => {
  dataset = buildBurnDataset(ROOT);

  describe('schema validity', () => {
    it('has version v0', () => {
      expect(dataset.version).toBe('v0');
    });

    it('has a valid export date', () => {
      expect(dataset.export_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('trace count matches traces array length', () => {
      expect(dataset.trace_count).toBe(dataset.traces.length);
    });

    it('every trace has required fields', () => {
      for (const trace of dataset.traces) {
        expect(trace.trace_id).toMatch(/^burn_[a-f0-9]{16}$/);
        expect(trace.arc).toBeTruthy();
        expect(trace.source_artifact).toBeTruthy();
        expect(trace.authority_boundary).toEqual(AUTHORITY_BOUNDARY);
        expect(trace.steps.length).toBeGreaterThan(0);
        expect(trace.created_at).toBeTruthy();
      }
    });

    it('every step has required fields', () => {
      for (const trace of dataset.traces) {
        for (const step of trace.steps) {
          expect(typeof step.step_index).toBe('number');
          expect(step.input_context_summary).toBeTruthy();
          expect(step.user_goal).toBeTruthy();
          expect(step.model_observation).toBeTruthy();
          expect(step.proposed_next_step).toBeTruthy();
          expect(step.expected_gate_boundary).toBeTruthy();
          expect(Array.isArray(step.forbidden_actions)).toBe(true);
          expect(step.forbidden_actions.length).toBeGreaterThan(0);
          expect(Array.isArray(step.receipt_or_evidence_refs)).toBe(true);
          expect(ALL_LABELS).toContain(step.label);
          expect(step.why_label).toBeTruthy();
          expect(step.training_target_response).toBeTruthy();
        }
      }
    });

    it('authority boundary is frozen and complete', () => {
      expect(AUTHORITY_BOUNDARY.gate_decides).toBe(true);
      expect(AUTHORITY_BOUNDARY.model_may_propose).toBe(true);
      expect(AUTHORITY_BOUNDARY.model_may_not_apply).toBe(true);
      expect(AUTHORITY_BOUNDARY.model_may_not_sign).toBe(true);
      expect(AUTHORITY_BOUNDARY.model_may_not_push).toBe(true);
      expect(AUTHORITY_BOUNDARY.model_may_not_deploy).toBe(true);
      expect(AUTHORITY_BOUNDARY.local_stub_is_rehearsal).toBe(true);
      expect(AUTHORITY_BOUNDARY.kernel_test_is_test_only).toBe(true);
      expect(AUTHORITY_BOUNDARY.fusion_is_advisory).toBe(true);
      expect(AUTHORITY_BOUNDARY.receipts_define_reality).toBe(true);
      expect(AUTHORITY_BOUNDARY.vk_is_parked).toBe(true);
      expect(AUTHORITY_BOUNDARY.chronos_is_parked).toBe(true);
      expect(AUTHORITY_BOUNDARY.timing_may_not_authorize).toBe(true);
      expect(AUTHORITY_BOUNDARY.glyphs_may_not_authorize).toBe(true);
      expect(Object.isFrozen(AUTHORITY_BOUNDARY)).toBe(true);
    });
  });

  describe('minimum trace counts', () => {
    it('has at least 15 traces total', () => {
      expect(dataset.trace_count).toBeGreaterThanOrEqual(15);
    });

    it('has at least 5 golden traces', () => {
      expect(dataset.label_distribution.golden).toBeGreaterThanOrEqual(5);
    });

    it('has at least 2 refused traces', () => {
      expect(dataset.label_distribution.refused).toBeGreaterThanOrEqual(2);
    });

    it('has at least 2 unsafe traces', () => {
      expect(dataset.label_distribution.unsafe).toBeGreaterThanOrEqual(2);
    });

    it('has at least 2 contradicted traces', () => {
      expect(dataset.label_distribution.contradicted).toBeGreaterThanOrEqual(2);
    });

    it('has at least 1 needs_human trace', () => {
      expect(dataset.label_distribution.needs_human).toBeGreaterThanOrEqual(1);
    });

    it('has at least 1 stale trace', () => {
      expect(dataset.label_distribution.stale).toBeGreaterThanOrEqual(1);
    });

    it('positive traces outnumber or equal negative traces', () => {
      const positive = dataset.label_distribution.golden;
      const negative = dataset.label_distribution.refused + dataset.label_distribution.unsafe +
        dataset.label_distribution.contradicted;
      expect(positive).toBeGreaterThanOrEqual(negative);
    });
  });

  describe('label distribution', () => {
    it('label counts sum to total step count', () => {
      const totalFromDist = Object.values(dataset.label_distribution).reduce((a, b) => a + b, 0);
      const totalFromSteps = dataset.traces.reduce((sum, t) => sum + t.steps.length, 0);
      expect(totalFromDist).toBe(totalFromSteps);
    });

    it('every label in distribution is a valid BurnLabel', () => {
      for (const label of Object.keys(dataset.label_distribution)) {
        expect(ALL_LABELS).toContain(label);
      }
    });
  });

  describe('no secrets', () => {
    it('dataset passes secret scan', () => {
      expect(dataset.secret_scan_passed).toBe(true);
    });

    it('no trace contains OpenRouter key pattern', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/sk-or-[a-zA-Z0-9_-]{16,}/);
    });

    it('no trace contains EDGE_NODE_SEED value', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/EDGE_NODE_SEED\s*[:=]\s*["'][^"']+["']/);
    });

    it('no trace contains private key PEM', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/);
    });

    it('no trace contains Bearer token', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/Bearer\s+[a-zA-Z0-9_.-]{20,}/i);
    });

    it('no trace contains Nebius token', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/nebius[_-]?token/i);
    });

    it('no trace contains PoP signature hex', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/popSignature\s*[:=]\s*["'][a-fA-F0-9]{32,}["']/);
    });
  });

  describe('no authority leakage', () => {
    it('dataset passes authority leakage scan', () => {
      expect(dataset.authority_leakage_scan_passed).toBe(true);
    });

    it('no trace tells model it may apply', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/\byou may apply\b/i);
    });

    it('no trace tells model it may sign', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/\byou may sign\b/i);
    });

    it('no trace tells model it may push', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/\byou may push\b/i);
    });

    it('no trace tells model it may deploy', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/\byou may deploy\b/i);
    });

    it('no trace contains grantsAuthority: true', () => {
      const fullText = JSON.stringify(dataset.traces);
      expect(fullText).not.toMatch(/grantsAuthority\s*[:=]\s*true/i);
    });

    it('no trace instructs model to commit and push', () => {
      for (const trace of dataset.traces) {
        for (const step of trace.steps) {
          expect(step.training_target_response).not.toMatch(/\bcommit\s+and\s+push\b/i);
        }
      }
    });

    it('no training_target_response grants authority', () => {
      for (const trace of dataset.traces) {
        for (const step of trace.steps) {
          const scan = scanForAuthorityLeakage(step.training_target_response);
          expect(scan.clean, `authority leak in trace ${trace.trace_id}: ${scan.matches.join(', ')}`).toBe(true);
        }
      }
    });
  });

  describe('local_stub / kernel_test negative examples', () => {
    it('has at least one trace refusing local_stub as authority', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.label === 'unsafe' &&
          (s.why_label.includes('local_stub') || s.training_target_response.includes('local_stub'))
        )
      );
      expect(found).toBe(true);
    });

    it('has at least one trace refusing kernel_test as apply-eligible', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.label === 'unsafe' &&
          (s.why_label.includes('kernel_test') || s.training_target_response.includes('kernel_test'))
        )
      );
      expect(found).toBe(true);
    });

    it('local_stub trace mentions isApplyEligibleBinding', () => {
      const trace = dataset.traces.find(t =>
        t.steps.some(s => s.label === 'unsafe' && s.why_label.includes('local_stub'))
      );
      expect(trace).toBeTruthy();
      const step = trace!.steps.find(s => s.label === 'unsafe' && s.why_label.includes('local_stub'));
      expect(step!.training_target_response).toContain('isApplyEligibleBinding');
    });

    it('kernel_test trace mentions isApplyEligibleApproval', () => {
      const trace = dataset.traces.find(t =>
        t.steps.some(s => s.label === 'unsafe' && s.why_label.includes('kernel_test'))
      );
      expect(trace).toBeTruthy();
      const step = trace!.steps.find(s => s.label === 'unsafe' && s.why_label.includes('kernel_test'));
      expect(step!.training_target_response).toContain('isApplyEligibleApproval');
    });
  });

  describe('VK / Chronos negative examples', () => {
    it('has at least one contradicted trace for Chronos authority claim', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.label === 'contradicted' &&
          (s.why_label.toLowerCase().includes('chronos') || s.training_target_response.toLowerCase().includes('chronos'))
        )
      );
      expect(found).toBe(true);
    });

    it('has at least one contradicted trace for VK glyph bypass claim', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.label === 'contradicted' &&
          (s.why_label.toLowerCase().includes('vk') || s.why_label.toLowerCase().includes('glyph'))
        )
      );
      expect(found).toBe(true);
    });

    it('Chronos trace teaches timing may never authorize', () => {
      const trace = dataset.traces.find(t =>
        t.steps.some(s => s.label === 'contradicted' && s.why_label.toLowerCase().includes('chronos'))
      );
      expect(trace).toBeTruthy();
      const step = trace!.steps.find(s => s.label === 'contradicted' && s.why_label.toLowerCase().includes('chronos'));
      expect(step!.training_target_response.toLowerCase()).toContain('timing');
      expect(step!.training_target_response.toLowerCase()).toContain('never');
      expect(step!.training_target_response.toLowerCase()).toContain('authorize');
    });

    it('VK trace teaches glyphs may never authorize effects', () => {
      const trace = dataset.traces.find(t =>
        t.steps.some(s => s.label === 'contradicted' && s.why_label.toLowerCase().includes('glyph'))
      );
      expect(trace).toBeTruthy();
      const step = trace!.steps.find(s => s.label === 'contradicted' && s.why_label.toLowerCase().includes('glyph'));
      expect(step!.training_target_response.toLowerCase()).toContain('glyph');
      expect(step!.training_target_response.toLowerCase()).toContain('never');
    });
  });

  describe('deterministic export', () => {
    it('two builds produce same trace count', () => {
      const d2 = buildBurnDataset(ROOT);
      expect(d2.trace_count).toBe(dataset.trace_count);
    });

    it('two builds produce same trace IDs', () => {
      const d2 = buildBurnDataset(ROOT);
      const ids1 = dataset.traces.map(t => t.trace_id).sort();
      const ids2 = d2.traces.map(t => t.trace_id).sort();
      expect(ids2).toEqual(ids1);
    });

    it('two builds produce same label distribution', () => {
      const d2 = buildBurnDataset(ROOT);
      expect(d2.label_distribution).toEqual(dataset.label_distribution);
    });
  });

  describe('JSONL export', () => {
    it('produces valid JSONL (one JSON object per line)', () => {
      const jsonl = exportToJSONL(dataset);
      const lines = jsonl.trim().split('\n');
      expect(lines.length).toBe(dataset.trace_count);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.trace_id).toBeTruthy();
        expect(parsed.steps).toBeTruthy();
      }
    });

    it('JSONL ends with newline', () => {
      const jsonl = exportToJSONL(dataset);
      expect(jsonl.endsWith('\n')).toBe(true);
    });

    it('JSONL line count matches trace count', () => {
      const jsonl = exportToJSONL(dataset);
      const lines = jsonl.trim().split('\n');
      expect(lines.length).toBe(dataset.trace_count);
    });
  });

  describe('evidence export', () => {
    it('produces markdown with required sections', () => {
      const md = exportToEvidence(dataset);
      expect(md).toContain('# 24P');
      expect(md).toContain('DATASET ONLY');
      expect(md).toContain('NO TRAINING YET');
      expect(md).toContain('Hard Law');
      expect(md).toContain('model may internalize workflow');
      expect(md).toContain('model may never internalize permission');
      expect(md).toContain('Label Distribution');
      expect(md).toContain('What Is NOT Done');
    });
  });

  describe('no network calls', () => {
    it('buildBurnDataset uses no fetch/http/net imports', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'src', 'burnDataset.ts'), 'utf-8'
      );
      const importLines = src.split('\n').filter((l: string) => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line).not.toMatch(/['"]https?['"]/);
        expect(line).not.toMatch(/['"]net['"]/);
        expect(line).not.toMatch(/['"]node-fetch['"]/);
      }
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toContain('openrouter.ai');
    });
  });

  describe('no model calls', () => {
    it('buildBurnDataset does not import or call any model API', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'src', 'burnDataset.ts'), 'utf-8'
      );
      const importLines = src.split('\n').filter((l: string) => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line).not.toMatch(/['"]openai['"]/);
        expect(line).not.toMatch(/['"]@anthropic['"]/);
      }
      expect(src).not.toContain('chat.completions');
      expect(src).not.toContain('generateText');
    });
  });

  describe('no filesystem writes outside evidence', () => {
    it('burnDataset.ts does not call fs.writeFile or fs.writeFileSync', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'src', 'burnDataset.ts'), 'utf-8'
      );
      expect(src).not.toMatch(/fs\.writeFile/);
      expect(src).not.toMatch(/fs\.writeFileSync/);
    });

    it('export runner only writes to evidence directory', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'evidence', 'export-burn-dataset.ts'), 'utf-8'
      );
      expect(src).toContain("const EVIDENCE = path.join(ROOT, 'evidence')");
      const writeLines = src.split('\n').filter((l: string) => l.includes('writeFileSync'));
      expect(writeLines.length).toBeGreaterThan(0);
      for (const line of writeLines) {
        expect(
          line.includes('jsonlPath') || line.includes('mdPath'),
          `write call must use evidence-derived path: ${line.trim()}`
        ).toBe(true);
      }
      expect(src).toContain("path.join(EVIDENCE, 'burn-dataset-v0.jsonl')");
      expect(src).toContain("path.join(EVIDENCE, '24p-burn-dataset-v0.md')");
    });
  });

  describe('safety curriculum completeness', () => {
    it('teaches: draft_only is not action', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s => s.training_target_response.includes('draft_only') || s.expected_gate_boundary.includes('draft_only'))
      );
      expect(found).toBe(true);
    });

    it('teaches: approval record is not authority', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.training_target_response.includes('evidence') &&
          s.training_target_response.includes('not permission')
        )
      );
      expect(found).toBe(true);
    });

    it('teaches: local_stub is rehearsal only', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s => s.training_target_response.includes('rehearsal'))
      );
      expect(found).toBe(true);
    });

    it('teaches: kernel_test is test-only', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s => s.training_target_response.includes('test-only') && s.training_target_response.includes('kernel_test'))
      );
      expect(found).toBe(true);
    });

    it('teaches: Gate decides', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.expected_gate_boundary.includes('Gate decides') ||
          s.expected_gate_boundary.includes('gate')
        )
      );
      expect(found).toBe(true);
    });

    it('teaches: receipts define reality', () => {
      expect(AUTHORITY_BOUNDARY.receipts_define_reality).toBe(true);
      const found = dataset.traces.some(t =>
        t.steps.some(s => s.training_target_response.includes('receipt'))
      );
      expect(found).toBe(true);
    });

    it('teaches: Fusion Council is advisory', () => {
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.training_target_response.toLowerCase().includes('advisory') &&
          (s.training_target_response.includes('Fusion') || s.training_target_response.includes('Council'))
        )
      );
      expect(found).toBe(true);
    });

    it('teaches: VK/Chronos are parked and non-authority', () => {
      expect(AUTHORITY_BOUNDARY.vk_is_parked).toBe(true);
      expect(AUTHORITY_BOUNDARY.chronos_is_parked).toBe(true);
    });

    it('teaches: timing may never authorize', () => {
      expect(AUTHORITY_BOUNDARY.timing_may_not_authorize).toBe(true);
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.training_target_response.toLowerCase().includes('timing') &&
          s.training_target_response.toLowerCase().includes('never')
        )
      );
      expect(found).toBe(true);
    });

    it('teaches: glyphs may never authorize', () => {
      expect(AUTHORITY_BOUNDARY.glyphs_may_not_authorize).toBe(true);
      const found = dataset.traces.some(t =>
        t.steps.some(s =>
          s.training_target_response.toLowerCase().includes('glyph') &&
          s.training_target_response.toLowerCase().includes('never')
        )
      );
      expect(found).toBe(true);
    });
  });

  describe('secret scanner unit tests', () => {
    it('detects OpenRouter key', () => {
      expect(scanForSecrets('key: sk-or-abcdefghijklmnop').clean).toBe(false);
    });

    it('detects EDGE_NODE_SEED', () => {
      expect(scanForSecrets('EDGE_NODE_SEED = "abc123"').clean).toBe(false);
    });

    it('detects Bearer token', () => {
      expect(scanForSecrets('Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9').clean).toBe(false);
    });

    it('passes on clean text', () => {
      expect(scanForSecrets('This is a normal training trace with no secrets.').clean).toBe(true);
    });
  });

  describe('authority leakage scanner unit tests', () => {
    it('detects "you may apply"', () => {
      expect(scanForAuthorityLeakage('you may apply this patch').clean).toBe(false);
    });

    it('detects grantsAuthority: true', () => {
      expect(scanForAuthorityLeakage('grantsAuthority: true').clean).toBe(false);
    });

    it('detects "commit and push"', () => {
      expect(scanForAuthorityLeakage('commit and push to remote').clean).toBe(false);
    });

    it('passes on safe advisory text', () => {
      expect(scanForAuthorityLeakage('I cannot apply this. The draft is advisory only.').clean).toBe(true);
    });

    it('detects local_stub is production claim', () => {
      expect(scanForAuthorityLeakage('local_stub is production mode').clean).toBe(false);
    });

    it('detects kernel_test grants authority claim', () => {
      expect(scanForAuthorityLeakage('kernel_test grants authority to apply').clean).toBe(false);
    });

    it('does not false-positive on negations of authority', () => {
      expect(scanForAuthorityLeakage('kernel_test does not grant authority. grantsAuthority is false.').clean).toBe(true);
    });
  });
});
