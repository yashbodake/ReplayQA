import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The structured-observation payload sent to the LLM. Built ONLY from existing
 * ReplayQA artifacts — never from raw HTML, screenshots, or Playwright objects.
 *
 * Heavy fingerprint materials (DOM/a11y trees, full snapshots) are deliberately
 * excluded: the experiment tests whether the SEMANTIC observations suffice,
 * not whether the model can parse raw structure.
 */
export interface Observations {
  application: { url: string };
  discoveredPages: unknown[];
  exploredStates: Array<{ stateId: string; url: string; capturedAt?: string }>;
  findings: unknown[];
  /** Observed state transitions with changes — NEW in v0.5 (flow discovery). */
  flowGraph?: { nodes: unknown[]; edges: unknown[]; skipped: unknown[] };
  /** Complete user journeys extracted from the flow graph — NEW in v0.5. */
  journeys?: unknown[];
}

/**
 * Load ReplayQA's discovery artifacts and project them into the lean semantic
 * payload the LLM receives.
 *
 *   artifactsDir/
 *     discovery.json     → application + discoveredPages
 *     states/*.json      → exploredStates (metadata only — id, url, capturedAt)
 *     findings/*.json    → findings (type, confidence, payload — the detector output)
 */
export async function loadObservations(artifactsDir: string): Promise<Observations> {
  const discovery = JSON.parse(
    await readFile(join(artifactsDir, 'discovery.json'), 'utf-8')
  ) as {
    application: { url: string };
    pages: unknown[];
  };

  // States: carry metadata only. The full snapshot is already reflected in the
  // discoveredPages above; the heavy fingerprint materials are intentionally
  // NOT sent.
  const statesDir = join(artifactsDir, 'states');
  const stateFiles = (await readdirSafe(statesDir)).filter((f) => f.endsWith('.json'));
  const exploredStates: Observations['exploredStates'] = [];
  for (const file of stateFiles) {
    const s = JSON.parse(await readFile(join(statesDir, file), 'utf-8')) as {
      id?: string;
      url?: string;
      metadata?: { capturedAt?: string };
    };
    exploredStates.push({
      stateId: s.id ?? file.replace(/\.json$/, ''),
      url: s.url ?? '',
      capturedAt: s.metadata?.capturedAt,
    });
  }

  // Findings: the detector output. Keep the semantic fields; drop nothing the
  // model needs. These are the observations future real detectors will enrich.
  const findingsDir = join(artifactsDir, 'findings');
  const findingFiles = (await readdirSafe(findingsDir)).filter((f) => f.endsWith('.json'));
  const findings: unknown[] = [];
  for (const file of findingFiles) {
    const doc = JSON.parse(await readFile(join(findingsDir, file), 'utf-8')) as {
      findings?: unknown[];
    };
    if (Array.isArray(doc.findings)) findings.push(...doc.findings);
  }

  return {
    application: discovery.application ?? { url: '' },
    discoveredPages: discovery.pages ?? [],
    exploredStates,
    findings,
    flowGraph: (await loadJsonSafe(join(artifactsDir, 'flow-graph.json'))) as Observations['flowGraph'],
    journeys: ((await loadJsonSafe(join(artifactsDir, 'journeys.json'))) as unknown[]) ?? undefined,
  };
}

async function loadJsonSafe(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
