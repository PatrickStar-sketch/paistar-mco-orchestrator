#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

const workbuddyCommand = process.env.WORKBUDDY_CLI || '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
const workbuddyHelp = run(workbuddyCommand, ['--help']);
const grokHelp = run(process.env.GROK_CLI || 'grok', ['--help']);

const workbuddyModels = workbuddyHelp.match(/Currently supported:\s*\(([^)]+)\)/)?.[1]?.split(/,\s*/) || [];
const workbuddyEfforts = workbuddyHelp.match(/--effort <level>[\s\S]{0,160}?\(([^)]+)\)/)?.[1]?.split(/,\s*/) || ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const grokEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];

console.log(JSON.stringify({
  workbuddy: {
    command: workbuddyCommand,
    available: workbuddyHelp.includes('--model'),
    models: workbuddyModels,
    effortLevels: workbuddyEfforts,
  },
  grok: {
    command: process.env.GROK_CLI || 'grok',
    available: grokHelp.includes('--model'),
    models: [process.env.PAISTAR_GROK_MODEL || 'grok-4.6'],
    reasoningLevels: grokEfforts,
  },
}, null, 2));
