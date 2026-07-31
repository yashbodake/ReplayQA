/**
 * NarrationStyle — a provider-agnostic abstraction for narration delivery (v1.0).
 *
 * A style describes *how* the narration should sound (pacing, register) without
 * referencing any specific TTS provider's voice IDs. Each provider maps the
 * style to its own voices internally, so adding a new TTS engine requires no
 * changes to the style definitions — only the engine's own `styleToParams()`.
 *
 * Styles influence pacing (speed/rate) and voice selection (register), not
 * artificial "emotions". The goal is a consistent, professional delivery.
 */

/** How fast the narration is delivered. */
export type PacingTier = 'slow' | 'normal' | 'fast';

/** The tonal character of the narration voice. */
export type VoiceRegister = 'neutral' | 'warm' | 'authoritative' | 'crisp';

export interface NarrationStyle {
  /** Stable id, e.g. 'professional', used in config/env. */
  readonly id: string;
  /** Human-readable label for metadata and UI. */
  readonly label: string;
  /** Delivery speed — providers translate to their own rate/speed values. */
  readonly pacing: PacingTier;
  /** Tonal register — providers map to a voice that fits. */
  readonly register: VoiceRegister;
  /** What this style is for. */
  readonly description: string;
}

/**
 * Built-in narration styles. Each is provider-agnostic — the pacing and
 * register are abstract; providers resolve them to concrete voice IDs.
 */
const STYLES: Record<string, NarrationStyle> = {
  professional: {
    id: 'professional',
    label: 'Professional',
    pacing: 'normal',
    register: 'neutral',
    description: 'Clear, measured, standard delivery — the default for QA reports.',
  },
  executive: {
    id: 'executive',
    label: 'Executive',
    pacing: 'slow',
    register: 'authoritative',
    description: 'Deliberate, confident, boardroom-style presentation.',
  },
  educational: {
    id: 'educational',
    label: 'Educational',
    pacing: 'normal',
    register: 'warm',
    description: 'Friendly, approachable — for onboarding and tutorials.',
  },
  developer: {
    id: 'developer',
    label: 'Developer',
    pacing: 'fast',
    register: 'crisp',
    description: 'Technical, efficient, brisk — for dev-oriented demos.',
  },
};

/**
 * Resolve a NarrationStyle by id (or env). Falls back to 'professional'.
 * Resolution order: explicit `id` → `NARRATION_STYLE` env → 'professional'.
 */
export function getStyle(id?: string): NarrationStyle {
  const requested = id ?? process.env.NARRATION_STYLE ?? 'professional';
  return STYLES[requested] ?? STYLES.professional;
}

/** List all available style ids (for documentation / help output). */
export function listStyles(): string[] {
  return Object.keys(STYLES);
}
