import type {
  GraphNode,
  TransitionEdge,
  TransitionGraph,
} from './types.js';
import type { State } from '../models/state.js';

/**
 * In-memory transition graph accumulator. Records every successful probe edge
 * and every skipped action (with its reason), then persists to `graph.json`.
 *
 * The graph is the durable record of "which state produced which observation
 * via which action" — exactly what downstream planning needs to reason about
 * flows. Skipped actions make the safety policy auditable.
 */
export class TransitionGraphBuilder {
  private readonly nodeIds = new Set<string>();
  private readonly _nodes: GraphNode[] = [];
  private readonly _edges: TransitionEdge[] = [];
  private readonly _skipped: { from: string; action: string; classification: string; reason: string }[] = [];

  get graph(): TransitionGraph {
    return {
      nodes: this._nodes,
      edges: this._edges,
      skipped: this._skipped as TransitionGraph['skipped'],
    };
  }

  /** Register a state as a graph node (deduped by stateId). */
  addNode(state: State, label: string): void {
    if (this.nodeIds.has(state.id)) return;
    this.nodeIds.add(state.id);
    this._nodes.push({ stateId: state.id, url: state.url, label });
  }

  /** Record a successful probe: from --action--> to. */
  addEdge(from: string, action: string, to: string, changes: string[] = []): void {
    this._edges.push({ from, action, to, via: 'probe', changes });
  }

  /** Record an action that was considered and skipped (destructive / unknown). */
  addSkipped(
    from: string,
    action: string,
    classification: 'destructive' | 'unknown',
    reason: string
  ): void {
    this._skipped.push({ from, action, classification, reason });
  }

  edgeCount(): number {
    return this._edges.length;
  }

  skippedCount(): number {
    return this._skipped.length;
  }
}
