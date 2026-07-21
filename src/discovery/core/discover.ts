import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { findConfigSync } from '../../config/index.js';
import type { DiscoveredPage, DiscoveryResult, State } from '../models/index.js';
import { toDiscoveredPage } from '../collector/index.js';
import { isLogoutLabel } from '../collector/index.js';
import { hasLoginForm, loginAndVerify, LoginFailedError } from '../login/index.js';
import { buildContext } from './context.js';
import { runProbes, TransitionGraphBuilder } from '../probes/index.js';
import { buildJourneys, renderFlowReport } from '../flow/index.js';
import type { DiscoveryOptions } from './phases.js';

const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MAX_PROBES_PER_STATE = 5;

/**
 * Discovery run.
 *
 * Flow:
 *   1. Open the target URL and capture the landing page.
 *   2. If a login form is visible and credentials were supplied, log in and
 *      capture the authenticated landing page.
 *   3. From every captured "base" state, follow visible same-origin nav links
 *      one hop deep AND run ACTION PROBES — safe clicks that open
 *      modals / forms / drawers / tabs for observation (never destructive
 *      actions). Each probed state is captured and registered like any page.
 *
 * State handling:
 *   - Every state is fingerprinted (Strategy E) and deduped by stateId.
 *   - The transition graph (base --action--> probed-state, plus every skipped
 *     action and why) is persisted to `artifacts/discovery/graph.json`.
 */
export async function runDiscovery(
  targetUrl: string,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const config = findConfigSync();
  const ctx = buildContext({
    targetUrl,
    outputDir: options.outputDir ?? resolve(config.outputDir, 'discovery'),
    config,
    logger: options.logger,
    headed: options.headed,
  });

  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxProbesPerState = options.maxProbesPerState ?? DEFAULT_MAX_PROBES_PER_STATE;
  const pages: DiscoveredPage[] = [];
  const exploredStates = new Set<string>();
  const probedStates = new Set<string>();
  const graph = new TransitionGraphBuilder();
  const phase = options.onPhase;

  /**
   * Capture the current page; register it in the output (and run detectors)
   * iff its stateId is new. Also register it as a graph node. Always returns
   * the captured state + whether it was newly registered.
   */
  const captureAndAdd = async (): Promise<{ state: State; isNew: boolean }> => {
    const state = await ctx.stateManager.capture();
    const label = state.snapshot.heading || state.url.split('/').pop() || state.url;
    graph.addNode(state, label);
    if (exploredStates.has(state.id)) return { state, isNew: false };
    exploredStates.add(state.id);
    pages.push(toDiscoveredPage(state, pages.length + 1));
    await ctx.detectorManager.runAll(state);
    return { state, isNew: true };
  };

  /** Probe safe action buttons from a base state (only once per state). */
  const probeFrom = async (baseState: State, baseUrl: string): Promise<void> => {
    if (pages.length >= maxPages) return;
    if (probedStates.has(baseState.id)) return; // already probed — skip duplicates
    probedStates.add(baseState.id);
    try {
      await runProbes({
        controller: ctx.controller,
        stateManager: ctx.stateManager,
        baseState,
        baseUrl,
        graph,
        hooks: { captureAndAdd },
        logger: ctx.logger,
        options: { maxProbesPerState },
      });
    } catch (error) {
      ctx.logger.warn(
        `probes from ${baseState.id} failed — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  phase?.('opening');
  await ctx.controller.open();

  try {
    await ctx.controller.goto(ctx.targetUrl, { timeout: 30000 });
    await ctx.controller.waitForStable();

    const { state: landingState } = await captureAndAdd();

    const loginVisible = await hasLoginForm(ctx.controller);
    const haveCredentials = Boolean(
      options.credentials?.username && options.credentials?.password
    );

    let loggedIn = false;
    let authedBaseUrl = ctx.targetUrl;
    if (loginVisible && haveCredentials && options.credentials) {
      phase?.('login-start');
      const verification = await loginAndVerify(ctx.controller, options.credentials);
      if (!verification.success) {
        phase?.('login-failed');
        // Preserve partial artifacts (the landing state) before stopping.
        persistPartial(ctx.outputDir, targetUrl, pages, graph.graph);
        throw new LoginFailedError(verification);
      }
      loggedIn = true;
      await ctx.controller.waitForStable();
      const { state: authedState } = await captureAndAdd();
      authedBaseUrl = ctx.controller.currentUrl();
      // Probe the authenticated landing page.
      await probeFrom(authedState, authedBaseUrl);
    } else if (!loginVisible) {
      // No login wall — probe the landing page directly.
      await probeFrom(landingState, ctx.targetUrl);
    }

    phase?.('discovering');

    // Only follow nav links once authenticated (or when there was no login
    // wall to begin with). Without credentials, CRUD pages are gated anyway.
    if (loggedIn || !loginVisible) {
      const navLinks = await ctx.controller.currentNavLinks();
      for (const link of navLinks) {
        if (isLogoutLabel(link.text)) continue; // exploration policy
        if (pages.length >= maxPages) break;
        try {
          await ctx.controller.goto(link.href, { timeout: 20000 });
          await ctx.controller.waitForStable();
        } catch {
          continue;
        }
        const { state: navState } = await captureAndAdd();
        // Probe safe actions from the nav-reached page.
        await probeFrom(navState, link.href);
      }
    }
  } finally {
    await ctx.controller.close();
  }

  // Persist the transition graph (edges with observed changes + skipped actions).
  const graphFile = resolve(ctx.outputDir, 'graph.json');
  writeFileSync(graphFile, JSON.stringify(graph.graph, null, 2) + '\n', 'utf-8');

  // Build + persist journeys and the flow report.
  const journeys = buildJourneys(graph.graph);
  writeFileSync(resolve(ctx.outputDir, 'flow-graph.json'), JSON.stringify(graph.graph, null, 2) + '\n', 'utf-8');
  writeFileSync(resolve(ctx.outputDir, 'journeys.json'), JSON.stringify(journeys, null, 2) + '\n', 'utf-8');
  const flowHtml = renderFlowReport(graph.graph, journeys, targetUrl);
  writeFileSync(resolve(ctx.outputDir, 'flow-report.html'), flowHtml, 'utf-8');

  return {
    application: { url: targetUrl },
    pages,
  };
}

/** Write the partial discovery output when the run stops early (e.g. login failure). */
function persistPartial(
  outputDir: string,
  targetUrl: string,
  pages: DiscoveredPage[],
  graph: unknown
): void {
  try {
    writeFileSync(
      resolve(outputDir, 'discovery.json'),
      JSON.stringify({ application: { url: targetUrl }, pages }, null, 2) + '\n',
      'utf-8'
    );
    writeFileSync(resolve(outputDir, 'graph.json'), JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  } catch {
    /* best-effort preservation */
  }
}
