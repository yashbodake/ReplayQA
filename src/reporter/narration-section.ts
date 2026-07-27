import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { NarrationChapter } from '../narration/planner/types.js';
import type { Timeline } from '../narration/timeline/types.js';

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface NarrationMetadata {
  provider?: string;
  voice?: string;
  policy?: string;
  resolution?: string;
  fps?: number;
  source?: 'llm' | 'fallback';
}

export interface NarrationSectionData {
  /** Path of the summary mp4 relative to the report HTML (e.g. "ReplayQA-Summary.mp4"). */
  summarySrc: string;
  chapters: NarrationChapter[];
  timeline?: Timeline;
  durationMs?: number;
  source: 'llm' | 'fallback';
  /** Optional v0.9 metadata panel (TTS provider/voice, render policy, resolution, fps). */
  metadata?: NarrationMetadata;
}

/**
 * Render the narration block embedded at the top of the HTML report (v0.9):
 * a larger 16:9 player, clickable chapter list with current-chapter
 * highlighting, a download button, and a narration metadata panel.
 *
 * Styling reuses the report's CSS variables; the section degrades gracefully
 * when optional fields (timeline, metadata) are missing.
 */
export function renderNarrationSection(data: NarrationSectionData): string {
  const { summarySrc, chapters, timeline, durationMs, source, metadata } = data;
  const durationLabel = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '';

  const chapterRows = chapters
    .map(
      (ch, i) => `<li class="narration-chapter" data-index="${i}" data-start="${ch.start}" data-end="${ch.start + ch.duration}">
        <span class="narration-chapter-time">${formatSeconds(ch.start)}</span>
        <span class="narration-chapter-title">${escapeHtml(ch.title)}</span>
      </li>`
    )
    .join('');

  const timelineRows = timeline?.events?.length
    ? timeline.events
        .slice(0, 60)
        .map(
          (e) => `<div class="narration-tl-row">
            <span class="narration-tl-time">${formatMs(e.timestamp)}</span>
            <span class="narration-tl-type">${escapeHtml(e.type)}</span>
          </div>`
        )
        .join('')
    : '';

  const metaRows: string[] = [];
  if (metadata) {
    if (metadata.provider) metaRows.push(`<dt>TTS</dt><dd>${escapeHtml(metadata.provider)}</dd>`);
    if (metadata.voice) metaRows.push(`<dt>Voice</dt><dd>${escapeHtml(metadata.voice)}</dd>`);
    if (metadata.policy) metaRows.push(`<dt>Render</dt><dd>${escapeHtml(metadata.policy)}</dd>`);
    if (metadata.resolution) metaRows.push(`<dt>Resolution</dt><dd>${escapeHtml(metadata.resolution)}</dd>`);
    if (metadata.fps) metaRows.push(`<dt>Frame rate</dt><dd>${metadata.fps} fps</dd>`);
    metaRows.push(`<dt>Script</dt><dd>${escapeHtml(source)}</dd>`);
  }
  const metaPanel = metaRows.length
    ? `<dl class="narration-meta">${metaRows.join('')}</dl>`
    : '';

  return `<section class="narration-section">
    <div class="artifact-section">
      <h4>Narrated Summary <span class="count-badge">${escapeHtml(source)}</span>${
        durationLabel ? ` <span class="count-badge">${durationLabel}</span>` : ''
      }<a class="narration-download" href="${escapeHtml(summarySrc)}" download title="Download ReplayQA-Summary.mp4">⬇ Download</a></h4>
      <video controls class="video-player narration-video" id="replayqa-summary" preload="metadata">
        <source src="${escapeHtml(summarySrc)}" type="video/mp4">
      </video>
      <div class="narration-body">
        <div class="narration-chapters">
          <h5>Chapters</h5>
          <ul class="narration-chapter-list" id="narration-chapter-list">${chapterRows}</ul>
          ${metaPanel}
        </div>${
          timelineRows
            ? `<div class="narration-timeline">
          <h5>Timeline</h5>
          <div class="narration-tl-container">${timelineRows}</div>
        </div>`
            : ''
        }
      </div>
    </div>
  </section>
  <script>
    (function () {
      var v = document.getElementById('replayqa-summary');
      var list = document.getElementById('narration-chapter-list');
      if (!v || !list) return;
      var rows = Array.prototype.slice.call(list.querySelectorAll('.narration-chapter'));
      // Click a chapter → seek + play.
      rows.forEach(function (row) {
        row.addEventListener('click', function () {
          var s = parseFloat(row.getAttribute('data-start') || '0');
          try { v.currentTime = s; v.play(); } catch (e) {}
        });
      });
      // Highlight the current chapter as the video plays.
      v.addEventListener('timeupdate', function () {
        var t = v.currentTime;
        var active = null;
        rows.forEach(function (row) {
          var s = parseFloat(row.getAttribute('data-start') || '0');
          var e = parseFloat(row.getAttribute('data-end') || '9999');
          var on = (t >= s && t < e);
          row.classList.toggle('narration-chapter-active', on);
          if (on) active = row;
        });
        if (active && active.scrollIntoView) {
          // Only auto-scroll if the active row is out of view (gentle).
          var rect = active.getBoundingClientRect();
          var parentRect = list.getBoundingClientRect();
          if (rect.bottom > parentRect.bottom || rect.top < parentRect.top) {
            active.scrollIntoView({ block: 'nearest' });
          }
        }
      });
    })();
  </script>
  <style>
    .narration-section { margin-bottom: 1.5rem; }
    .narration-video { max-width: 100%; width: 100%; aspect-ratio: 16 / 9; }
    .narration-download {
      float: right; font-size: 0.75rem; color: var(--accent); text-decoration: none;
      background: var(--surface-2); padding: 0.2rem 0.6rem; border-radius: 0.375rem;
      border: 1px solid var(--border);
    }
    .narration-download:hover { background: var(--border); }
    .narration-body { display: flex; gap: 1.5rem; margin-top: 0.75rem; flex-wrap: wrap; }
    .narration-chapters { flex: 1 1 280px; min-width: 0; }
    .narration-chapters h5, .narration-timeline h5 {
      font-size: 0.8rem; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.5rem;
    }
    .narration-chapter-list {
      list-style: none; padding: 0; margin: 0 0 0.75rem 0;
      max-height: 320px; overflow-y: auto;
    }
    .narration-chapter {
      display: flex; gap: 0.75rem; padding: 0.35rem 0.5rem; cursor: pointer;
      border-radius: 0.25rem; font-size: 0.85rem; border-left: 3px solid transparent;
    }
    .narration-chapter:hover { background: var(--surface-2); }
    .narration-chapter-active {
      background: rgba(56,189,248,0.12); border-left-color: var(--accent);
    }
    .narration-chapter-active .narration-chapter-title { color: var(--accent); }
    .narration-chapter-time { color: var(--muted); font-family: 'SF Mono','Fira Code',monospace; min-width: 3rem; }
    .narration-chapter-title { color: var(--text); }
    .narration-meta {
      display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.75rem;
      font-size: 0.78rem; color: var(--muted); margin: 0;
    }
    .narration-meta dt { font-weight: 600; }
    .narration-meta dd { margin: 0; color: var(--text); }
    .narration-timeline { flex: 1 1 240px; min-width: 0; }
    .narration-tl-container {
      max-height: 320px; overflow-y: auto; background: #0d1117;
      border-radius: 0.5rem; border: 1px solid var(--border); padding: 0.4rem;
      font-family: 'SF Mono','Fira Code',monospace; font-size: 0.75rem;
    }
    .narration-tl-row { display: flex; gap: 0.5rem; padding: 0.15rem 0.25rem; }
    .narration-tl-time { color: var(--muted); white-space: nowrap; }
    .narration-tl-type { color: var(--text); }
  </style>`;
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatMs(ms: number): string {
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

/**
 * Inject the narration section into an existing `reports/index.html`, just
 * before `</main>`. Idempotent: if a previous narration section is present it
 * is replaced. If the report file does not exist yet, this is a no-op (the
 * section will be injected next time the report is (re)generated).
 */
export function injectNarrationIntoReport(htmlPath: string, sectionHtml: string): boolean {
  if (!existsSync(htmlPath)) return false;
  let html = readFileSync(htmlPath, 'utf-8');

  const START = '<!-- NARRATION-SECTION-START -->';
  const END = '<!-- NARRATION-SECTION-END -->';
  const wrapped = `${START}\n${sectionHtml}\n${END}`;

  // Remove any prior narration block (idempotent re-injection).
  const re = new RegExp(`${escapeReg(START)}[\\s\\S]*?${escapeReg(END)}`, 'g');
  html = html.replace(re, '');

  if (html.includes('</main>')) {
    html = html.replace('</main>', `${wrapped}\n</main>`);
  } else {
    // Fallback: append before </body>.
    html = html.replace('</body>', `${wrapped}\n</body>`);
  }
  writeFileSync(htmlPath, html, 'utf-8');
  return true;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
