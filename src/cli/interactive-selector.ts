import readline from 'node:readline';

export interface SelectableItem {
  label: string;
  value: string;
  hint?: string;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
  cursorHide: '\x1b[?25l',
  cursorShow: '\x1b[?25h',
  clearScreen: '\x1b[2J',
  clearLine: '\x1b[2K',
  moveUp: (n: number) => `\x1b[${n}A`,
  moveDown: (n: number) => `\x1b[${n}B`,
};

export async function interactiveCheckboxSelect(
  items: SelectableItem[],
  options: { title?: string } = {}
): Promise<string[]> {
  const { title = 'Select tests to run' } = options;

  if (items.length === 0) {
    return [];
  }

  const selected = new Set<number>();
  let cursor = 0;
  let confirmed = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf-8');

  function render(): void {
    const lines: string[] = [];

    lines.push(`${ANSI.bold}${ANSI.cyan}ReplayQA${ANSI.reset} ${ANSI.dim}— ${title}${ANSI.reset}`);
    lines.push(`${ANSI.dim}  ↑/↓ navigate  ·  space toggle  ·  a select all  ·  n select none  ·  enter confirm${ANSI.reset}`);
    lines.push('');

    const maxLabelWidth = Math.min(
      Math.max(...items.map((i) => i.label.length)),
      60
    );

    items.forEach((item, index) => {
      const isSelected = selected.has(index);
      const isCursor = index === cursor;
      const checkbox = isSelected ? `${ANSI.green}[x]${ANSI.reset}` : `${ANSI.dim}[ ]${ANSI.reset}`;
      const cursorMarker = isCursor ? `${ANSI.bgBlue} ${ANSI.reset}` : ' ';
      const label = isCursor
        ? `${ANSI.bold}${item.label}${ANSI.reset}`
        : item.label;
      const hint = item.hint ? `${ANSI.dim} ${item.hint}${ANSI.reset}` : '';

      const paddedLabel = label.padEnd(maxLabelWidth + (item.hint?.length ?? 0));
      lines.push(`${cursorMarker} ${checkbox} ${paddedLabel}${hint}`);
    });

    lines.push('');
    const count = selected.size;
    const summary = count === 0
      ? `${ANSI.yellow}No tests selected${ANSI.reset}`
      : `${ANSI.green}${count} test${count !== 1 ? 's' : ''} selected${ANSI.reset}`;
    lines.push(`  ${summary}`);

    const output = lines.join('\n');
    process.stdout.write(ANSI.clearScreen + output + '\n');
  }

  function moveCursor(direction: number): void {
    cursor = (cursor + direction + items.length) % items.length;
    render();
  }

  function toggle(): void {
    if (selected.has(cursor)) {
      selected.delete(cursor);
    } else {
      selected.add(cursor);
    }
    render();
  }

  function selectAll(): void {
    items.forEach((_, index) => selected.add(index));
    render();
  }

  function selectNone(): void {
    selected.clear();
    render();
  }

  return new Promise<string[]>((resolvePromise) => {
    render();

    stdin.on('data', (data: Buffer) => {
      const key = data.toString();

      switch (key) {
        case '\r':
        case '\n':
          confirmed = true;
          break;
        case ' ':
          toggle();
          return;
        case 'a':
        case 'A':
          selectAll();
          return;
        case 'n':
        case 'N':
          selectNone();
          return;
        case '\x1b[A':
          moveCursor(-1);
          return;
        case '\x1b[B':
          moveCursor(1);
          return;
        case '\x03':
        case 'q':
        case 'Q':
          stdin.setRawMode(false);
          rl.close();
          process.stdout.write(ANSI.cursorShow);
          resolvePromise([]);
          return;
      }

      if (confirmed) {
        stdin.setRawMode(false);
        rl.close();
        process.stdout.write(ANSI.cursorShow + ANSI.clearScreen);
        const result = Array.from(selected).map((index) => items[index].value);
        resolvePromise(result);
      }
    });
  });
}
