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

function snapshot(repo, paths) {
  const rows = [];
  for (const path of paths) {
    const resolved = safePath(repo, path);
    for (const file of filesUnder(resolved.target)) {
      const content = readFileSync(file);
      const relativePath = relative(resolve(repo), file);
      rows.push({
        path: relativePath,
        sha256: createHash('sha256').update(content).digest('hex').slice(0, 16),
        content: content.includes(0) ? null : content.toString('utf8'),
      });
    }
  }
  return rows;
}

function withProjectContext(repo, paths) {
  const context = ['MCO_CONTEXT.md'];
  return [...new Set([...context.filter((path) => existsSync(resolve(repo, path))), ...paths])];
}

function manifest(rows) {
  return rows.map(({ path, sha256 }) => ({ path, sha256 }));
}

function boundedContents(rows) {
  const perFileLimit = 12000;
  const totalLimit = 60000;
  let remaining = totalLimit;
  const sections = [];
  for (const row of rows) {
    if (!row.content || remaining <= 0) continue;
    const text = row.content.slice(0, Math.min(perFileLimit, remaining));
    const truncated = text.length < row.content.length;
    const numbered = text.split(/\r?\n/).map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`).join('\n');
    sections.push(`--- ${row.path}${truncated ? ' (truncated)' : ''} ---\n${numbered}`);
    remaining -= text.length;
  }
  return sections.join('\n\n') || '(no readable text files in snapshot)';
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
  const evidence = manifest(rows).map((row) => `${row.path}#${row.sha256}`).join(', ');
  return `${header}\nRepository snapshot manifest: ${evidence || '(empty)'}\nRepository snapshot contents (authoritative; line numbers are included):\n${boundedContents(rows)}\n${options.prompt}\nOnly inspect the supplied snapshot contents. Do not call tools or infer absent files. Return evidence-backed findings with repository-relative paths and line numbers. Do not modify files, install dependencies, start services, or access production.`;
}

function validateResult(result, options, rows) {
  if (!result.ok) return result;
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    return { ...result, ok: false, validation_error: 'mco returned non-JSON output' };
  }
  const outputs = Array.isArray(envelope?.outputs) ? envelope.outputs : [];
  const successful = outputs.filter((output) => output && output.status === 'success');
  if (!successful.length) {
    return { ...result, ok: false, validation_error: 'provider completed without a successful output' };
  }
  const gateEvidence = !/健康检查|health\s*check|只输出一行|one line/i.test(options.prompt);
  const manifestPaths = rows.map((row) => row.path);
  for (const output of successful) {
    const text = typeof output.output === 'string' ? output.output.trim() : '';
    if (!text) return { ...result, ok: false, validation_error: 'provider exited successfully but returned empty output' };
    const progressOnly = text.split(/\r?\n/).length <= 2
      && /^(收到|我先|我将|我会|正在|先读取|开始|已收到|I(?:'|’)ll|I will|Let me|I’m going|I've received)/i.test(text);
    if (progressOnly) return { ...result, ok: false, validation_error: 'provider returned progress text without a final answer' };
    if (gateEvidence) {
      const hasPath = manifestPaths.some((path) => text.includes(path));
      const hasLine = /(?:\bline|\b行(?:号)?)\s*[/：:#-]?\s*\d+|\bL\s*\d+|[A-Za-z0-9_.\/-]+:\d+/i.test(text);
      if (!hasPath || !hasLine) {
        return { ...result, ok: false, validation_error: 'provider output lacks snapshot path and line evidence' };
      }
    }
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (!options.paths.length) throw new Error('--paths is required');
  if (!options.prompt) throw new Error('--prompt is required');
  const repo = resolve(options.repo);
  if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`repository is not a directory: ${repo}`);
  const rows = snapshot(repo, withProjectContext(repo, options.paths));
  const routes = routeFor(options);
  // Grok can spend several minutes in a single read-only review before it
  // emits the final answer. Keep the defaults generous, while allowing a
  // caller to tighten them for smoke tests without editing this dispatcher.
  const invocationHardTimeout = process.env.PAISTAR_MCO_INVOCATION_HARD_TIMEOUT || '600';
  const stallTimeout = process.env.PAISTAR_MCO_STALL_TIMEOUT || '600';
  const baseArgs = [
    '@tt-a1i/mco@latest', 'run', '--repo', repo,
    '--target-paths', options.paths.join(','), '--allow-paths', options.paths.join(','),
    '--execution-mode', 'read_only', '--invocation-hard-timeout', invocationHardTimeout, '--stall-timeout', stallTimeout, '--json',
  ];
  if (options.dryRun) baseArgs.push('--dry-run');
  const jobs = routes.map((route) => ({ route, args: [...baseArgs, '--providers', route.provider, '--prompt', buildPrompt(options, route, rows)] }));
  const rawResults = options.parallel || routes.length > 1
    ? await Promise.all(jobs.map((job) => run('npx', jobsToArgs(job), repo)))
    : [await run('npx', jobsToArgs(jobs[0]), repo)];
  const results = rawResults.map((result) => validateResult(result, options, rows));
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), repo, task: options.task, manifest: manifest(rows), routes, results }, null, 2));
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
