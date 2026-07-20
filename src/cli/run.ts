#!/usr/bin/env node
import { runInteractive } from '../cli/index.js';

runInteractive().catch((error) => {
  console.error(error);
  process.exit(1);
});
