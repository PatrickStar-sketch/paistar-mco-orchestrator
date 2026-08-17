#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

const ROUTES = {
  visual: [{ provider: 'workbuddy-safe', model: 'kimi-k3-1', levelKey: 'effort', level: 'xhigh' }],
  code: [{ provider: 'grok-safe', model: 'grok-4.6', levelKey: 'reasoning', level: 'high' }],
  architecture: [{ provider: 'workbuddy-safe', model: 'deepseek-v4-pro', levelKey: 'effort', level: 'xhigh' }],
  security: [{ provider: 'workbuddy-safe', model: 'glm-5.2', levelKey: 'effort', level: 'max' }],
  'copy-ia': [{ provider: 'workbuddy-safe', model: 'kimi-k3-1', levelKey: 'effort', level: 'xhigh' }],
  scout: [
    { provider: 'workbuddy-safe', model: 'hy3', levelKey: 'effort', level: 'low' },
    { provider: 'workbuddy-safe', model: 'minimax-m3', levelKey: 'effort', level: 'low' },
  ],
  'final-review': [
    { provider: 'workbuddy-safe', model: 'kimi-k3-1', levelKey: 'effort', level: 'max' },
    { provider: 'grok-safe', model: 'grok-4.6', levelKey: 'reasoning', level: 'max' },
  ],
};

const LEVELS = {
  reasoning: new Set(['low', 'medium', 'high', 'xhigh', 'max']),
  effort: new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
};

function fail(message) {
  console.error(`dispatch error: ${message}`);
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = { repo: '.', task: 'scout', paths: [], prompt: '', parallel: false, dryRun: false, agents: null, model: null, level: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--parallel') options.parallel = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--task') options.task = argv[++i];
    else if (arg === '--paths') options.paths = String(argv[++i] || '').split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--prompt') options.prompt = argv[++i] || '';
    else if (arg === '--agents') options.agents = String(argv[++i] || '').split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--model') options.model = argv[++i];
    else if (arg === '--effort' || arg === '--reasoning') options.level = argv[++i];
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage: dispatch.mjs --repo <path> --task <profile> --paths <p1,p2> --prompt <text> [--parallel] [--dry-run]\nProfiles: ${Object.keys(ROUTES).join(', ')}`;
}

function safePath(repo, candidate) {
  if (isAbsolute(candidate)) throw new Error(`absolute path is not allowed: ${candidate}`);
  const root = realpathSync(resolve(repo));
  const target = resolve(root, candidate);
  const targetReal = realpathSync(target);
  const rel = relative(root, targetReal);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes repository: ${candidate}`);
  if (!existsSync(targetReal)) throw new Error(`path does not exist: ${candidate}`);
  return { target: targetReal, relative: rel };
}

function filesUnder(target) {
  const info = statSync(target);
  if (info.isFile()) return [target];
  const files = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'dist-public', '.astro', '.wrangler'].includes(entry.name)) continue;
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) files.push(...filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function manifest(repo, paths) {
  const rows = [];
  for (const path of paths) {
    const resolved = safePath(repo, path);
    for (const file of filesUnder(resolved.target)) {
      const content = readFileSync(file);
      rows.push({ path: relative(resolve(repo), file), sha256: createHash('sha256').update(content).digest('hex').slice(0, 16) });
    }
  }
  return rows;
}

function routeFor(options) {
  const routes = options.agents?.length
    ? options.agents.map((provider) => ({ provider, model: options.model || 'auto', levelKey: provider.includes('grok') ? 'reasoning' : 'effort', level: options.level || 'low' }))
    : ROUTES[options.task];
  if (!routes) throw new Error(`unknown task profile: ${options.task}`);
  return routes.map((route) => {
    const level = options.level || route.level;
    const model = options.model || route.model;
    if (!LEVELS[route.levelKey].has(level)) throw new Error(`${route.levelKey} level is unsupported by the safe shim: ${level}`);
    return { ...route, model, level };
  });
}

function run(command, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolvePromise({ ok: false, code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolvePromise({ ok: code === 0, code, stdout, stderr }));
  });
}

function buildPrompt(options, route, rows) {
  const header = `__MCO_OPTIONS__ model=${route.model} ${route.levelKey}=${route.level}`;
  const evidence = rows.map((row) => `${row.path}#${row.sha256}`).join(', ');
  return `${header}\nRepository snapshot manifest: ${evidence || '(empty)'}\n${options.prompt}\nOnly inspect the supplied snapshot. Return evidence-backed findings with repository-relative paths. Do not modify files, install dependencies, start services, or access production.`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (!options.paths.length) throw new Error('--paths is required');
  if (!options.prompt) throw new Error('--prompt is required');
  const repo = resolve(options.repo);
  if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`repository is not a directory: ${repo}`);
  const rows = manifest(repo, options.paths);
  const routes = routeFor(options);
  const baseArgs = [
    '@tt-a1i/mco@latest', 'run', '--repo', repo,
    '--target-paths', options.paths.join(','), '--allow-paths', options.paths.join(','),
    '--execution-mode', 'read_only', '--invocation-hard-timeout', '300', '--stall-timeout', '240', '--json',
  ];
  if (options.dryRun) baseArgs.push('--dry-run');
  const jobs = routes.map((route) => ({ route, args: [...baseArgs, '--providers', route.provider, '--prompt', buildPrompt(options, route, rows)] }));
  const results = options.parallel || routes.length > 1
    ? await Promise.all(jobs.map((job) => run('npx', jobsToArgs(job), repo)))
    : [await run('npx', jobsToArgs(jobs[0]), repo)];
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), repo, task: options.task, manifest: rows, routes, results }, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

function jobsToArgs(job) {
  return [...job.args];
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
