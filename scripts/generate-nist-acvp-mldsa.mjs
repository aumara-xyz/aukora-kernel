// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_COMMIT = "15c0f3deeefbfa8cb6cd32a99e1ca3b738c66bf0";
const SOURCE_BASE = `https://raw.githubusercontent.com/usnistgov/ACVP-Server/${SOURCE_COMMIT}/gen-val/json-files/ML-DSA-sigVer-FIPS204`;
const SOURCES = {
  prompt: {
    url: `${SOURCE_BASE}/prompt.json`,
    sha256: "2a9b7fcbefdd8e69dd6fbe6b4abb7130d855e8429aaa6f4904385e68b7e63d3a",
  },
  expected: {
    url: `${SOURCE_BASE}/expectedResults.json`,
    sha256: "33e0ea7dd9c3b0206712da50286ad746864371433977225ab77e8aae76358842",
  },
};
const SELECTED_TEST_CASES = [31, 32];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchPinnedJson(source) {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`nist_acvp_fetch_failed:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== source.sha256) throw new Error(`nist_acvp_source_hash_mismatch:${actual}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

const prompt = await fetchPinnedJson(SOURCES.prompt);
const expected = await fetchPinnedJson(SOURCES.expected);
const promptGroup = prompt.testGroups.find((group) => group.tgId === 3);
const expectedGroup = expected.testGroups.find((group) => group.tgId === 3);
if (
  prompt.algorithm !== "ML-DSA" ||
  prompt.mode !== "sigVer" ||
  prompt.revision !== "FIPS204" ||
  promptGroup?.parameterSet !== "ML-DSA-65" ||
  promptGroup?.signatureInterface !== "external" ||
  promptGroup?.preHash !== "pure" ||
  !expectedGroup
) {
  throw new Error("nist_acvp_source_shape_changed");
}

const cases = SELECTED_TEST_CASES.map((tcId) => {
  const input = promptGroup.tests.find((test) => test.tcId === tcId);
  const verdict = expectedGroup.tests.find((test) => test.tcId === tcId);
  if (!input || !verdict) throw new Error(`nist_acvp_case_missing:${tcId}`);
  return {
    tgId: promptGroup.tgId,
    tcId,
    pk: input.pk,
    message: input.message,
    context: input.context,
    signature: input.signature,
    testPassed: verdict.testPassed,
  };
});
if (!cases.some((test) => test.testPassed) || !cases.some((test) => !test.testPassed)) {
  throw new Error("nist_acvp_subset_must_cover_accept_and_refuse");
}

const output = {
  schema: "aukora.nist-acvp-ml-dsa-65-sigver.v1",
  source: {
    repository: "https://github.com/usnistgov/ACVP-Server",
    commit: SOURCE_COMMIT,
    algorithm: "ML-DSA",
    mode: "sigVer",
    revision: "FIPS204",
    sourceFiles: SOURCES,
    notice: "NIST-ACVP-NOTICE.md",
  },
  selection: {
    testGroup: 3,
    parameterSet: "ML-DSA-65",
    signatureInterface: "external",
    preHash: "pure",
    testCases: SELECTED_TEST_CASES,
  },
  cases,
};

const target = fileURLToPath(new URL("../tests/vectors/nist-acvp-ml-dsa-65-sigver.json", import.meta.url));
await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${target} (${cases.length} pinned NIST ACVP cases)`);
