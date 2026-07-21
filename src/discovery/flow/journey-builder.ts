import type { GraphNode, TransitionEdge, TransitionGraph } from '../probes/types.js';

export interface JourneyStep {
  from: string;
  fromLabel: string;
  action: string;
  to: string;
  toLabel: string;
  changes: string[];
}

export interface Journey {
  id: string;
  steps: JourneyStep[];
  description: string;
  length: number;
}

export type FlowGraph = TransitionGraph;

const MAX_JOURNEYS = 10;
const MAX_DEPTH = 8;

/**
 * Extract complete user journeys from the transition graph.
 *
 * A journey is a simple path (no repeated nodes) from a root state (no
 * incoming edges) to a leaf state (no outgoing edges). Each step carries the
 * action label and the observed changes. Caps at MAX_JOURNEYS / MAX_DEPTH.
 */
export function buildJourneys(graph: FlowGraph): Journey[] {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodeMap.set(n.stateId, n);

  const edgesBySource = new Map<string, TransitionEdge[]>();
  for (const e of graph.edges) {
    const arr = edgesBySource.get(e.from) ?? [];
    arr.push(e);
    edgesBySource.set(e.from, arr);
  }

  const hasIncoming = new Set(graph.edges.map((e) => e.to));
  const roots = graph.nodes.filter((n) => !hasIncoming.has(n.stateId));
  const startNodes = roots.length > 0 ? roots : graph.nodes;

  const journeys: Journey[] = [];

  function dfs(nodeId: string, path: TransitionEdge[], visited: Set<string>): void {
    if (journeys.length >= MAX_JOURNEYS) return;
    if (path.length >= MAX_DEPTH) return;

    const outEdges = edgesBySource.get(nodeId) ?? [];
    if (outEdges.length === 0 && path.length > 0) {
      journeys.push(toJourney(path, nodeMap));
      return;
    }
    let extended = false;
    for (const edge of outEdges) {
      if (visited.has(edge.to)) continue;
      extended = true;
      dfs(edge.to, [...path, edge], new Set([...visited, edge.to]));
    }
    if (!extended && path.length > 0) {
      journeys.push(toJourney(path, nodeMap));
    }
  }

  for (const root of startNodes) {
    dfs(root.stateId, [], new Set([root.stateId]));
  }

  return journeys;
}

function toJourney(edges: TransitionEdge[], nodeMap: Map<string, GraphNode>): Journey {
  const steps: JourneyStep[] = edges.map((e) => ({
    from: e.from,
    fromLabel: nodeMap.get(e.from)?.label ?? e.from,
    action: e.action,
    to: e.to,
    toLabel: nodeMap.get(e.to)?.label ?? e.to,
    changes: e.changes ?? [],
  }));

  // One-line description
  const parts: string[] = [];
  for (const s of steps) {
    if (parts.length === 0) parts.push(s.fromLabel);
    parts.push(s.action, s.toLabel);
  }

  return {
    id: `journey-${journeys_counter++}`,
    steps,
    description: parts.join(' → '),
    length: steps.length,
  };
}

let journeys_counter = 0;
