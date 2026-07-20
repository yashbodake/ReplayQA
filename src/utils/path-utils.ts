export function sanitizeFileName(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9\-_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function relativePath(from: string, to: string): string {
  const fromParts = from.replace(/\\/g, '/').split('/').filter(Boolean);
  const toParts = to.replace(/\\/g, '/').split('/').filter(Boolean);

  const commonLength = fromParts.reduce((count, part, index) => {
    return part === toParts[index] ? count + 1 : count;
  }, 0);

  const up = fromParts.length - commonLength;
  const down = toParts.slice(commonLength);

  return [...Array(up).fill('..'), ...down].join('/') || '.';
}
