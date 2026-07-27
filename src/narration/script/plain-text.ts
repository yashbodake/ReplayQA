/**
 * Convert a narration markdown document into clean, speakable plain text.
 *
 * The script is persisted as markdown (`## Chapter`, `**bold**`, backticks,
 * list markers, etc.) for human review, but TTS must never read that markup —
 * hearing "hash hash Discovery" or "asterisk" is the bug this fixes.
 *
 * The transform is intentionally lossy and conservative: it only strips
 * structural/syntactic markdown, never rephrasing content, so the spoken text
 * is byte-for-byte the same prose a human would read.
 */
export function toSpeakableText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    // Drop the H1 title line entirely — it is a document label, not narration.
    .filter((line) => !/^#\s+/.test(line))
    .map((line) => {
      // Headings become a bare sentence (strip the leading "##").
      if (/^#{1,6}\s+/.test(line)) {
        return line.replace(/^#{1,6}\s+/, '').replace(/[.:]?\s*$/, '');
      }
      return line;
    })
    .map((line) => {
      if (!line) return '';
      // List bullets → plain sentences.
      const bullet = line.match(/^[-*+]\s+(.*)$/);
      if (bullet) return bullet[1];
      const numbered = line.match(/^\d+\.\s+(.*)$/);
      if (numbered) return numbered[1];
      return line;
    })
    .map((line) => stripInlineMarkdown(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+([.,;:!?])/g, '$1')   // tighten space before punctuation
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Strip inline markdown: bold/italic, code spans, links, stray symbols. */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/```[\s\S]*?```/g, '')              // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')                 // inline code → bare text
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // **bold**
    .replace(/__([^_]+)__/g, '$1')               // __bold__
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1$2') // *italic*
    .replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1$2')  // _italic_
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // [text](url) → text
    .replace(/^\s*>\s?/, '')                      // blockquote marker
    .replace(/---+/g, '')                         // horizontal rules
    .replace(/\|/g, ' ');                         // table pipes
}
