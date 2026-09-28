#!/usr/bin/env node
/**
 * project-summarizer: Summarize git changes across multiple projects using AI
 *
 * Supported providers (set ONE of these env vars):
 *   GOOGLE_API_KEY        → Google Gemini
 *   ANTHROPIC_API_KEY     → Anthropic Claude
 *   OPENAI_API_KEY        → OpenAI GPT
 *   OPENROUTER_API_KEY    → OpenRouter
 *   GROQ_API_KEY          → Groq
 *
 * Usage:
 *   node summarize.js                        # last 7 days (default)
 *   node summarize.js --days 14              # last 14 days
 *   node summarize.js --since 2025-04-01     # since a specific date
 *   node summarize.js --author "John"        # filter by author
 *   node summarize.js --provider google      # force a specific provider
 *   node summarize.js --single-summary       # one AI request for all projects
 *   node summarize.js --single-summary-max-commits 12  # per project in single mode
 *   node summarize.js --projects projects.json  # custom config file
 *   node summarize.js --raw-only             # collect git data only, skip AI
 *   node summarize.js --ai-only              # summarize from reports_raw only (skip git collection)
 *   node summarize.js --raw-date 2026-04-19  # use reports_raw/<date> as AI input in --ai-only mode
 *   node summarize.js --delay 3000           # ms delay between AI calls (default: 2000)
 *   node summarize.js --google-delay 9000    # minimum delay when provider is google
 *   node summarize.js --max-retries 3        # retry on 429/rate-limit errors
 *   node summarize.js --retry-delay 5000     # base retry delay in ms
 *   node summarize.js --provider ollama      # local summarization with Ollama
 *   node summarize.js --ollama-model qwen2.5:7b-instruct
 *   node summarize.js --provider openrouter  # summarize using OpenRouter
 *   node summarize.js --provider groq        # summarize using Groq
 *   node summarize.js --groq-model llama-3.1-8b-instant
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    days: 7,
    since: null,
    author: null,
    provider: null,   // auto-detect if null
    projectsFile: join(__dirname, 'projects.json'),
    output: 'text',
    rawOnly: false,
    aiOnly: false,
    rawDate: null,
    singleSummary: false,
    singleSummaryMaxCommits: 12,
    allBranches: false,
    delay: 2000,      // ms between AI calls to avoid rate limits
    googleDelay: 9000, // minimum delay when provider is google
    maxRetries: 3,
    retryDelay: 5000,
    ollamaModel: 'qwen2.5:7b-instruct',
    ollamaFallback: true,
    openrouterModel: 'openrouter/auto',
    groqModel: 'llama-3.3-70b-versatile',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--days':      opts.days = parseInt(args[++i], 10); break;
      case '--since':     opts.since = args[++i]; break;
      case '--author':    opts.author = args[++i]; break;
      case '--provider':  opts.provider = args[++i]; break;
      case '--projects':  opts.projectsFile = args[++i]; break;
      case '--json':      opts.output = 'json'; break;
      case '--raw-only':  opts.rawOnly = true; break;
      case '--ai-only':   opts.aiOnly = true; break;
      case '--raw-date':  opts.rawDate = args[++i]; break;
      case '--single-summary': opts.singleSummary = true; break;
      case '--single-summary-max-commits': opts.singleSummaryMaxCommits = parseInt(args[++i], 10); break;
      case '--all-branches': opts.allBranches = true; break;
      case '--delay':     opts.delay = parseInt(args[++i], 10); break;
      case '--google-delay': opts.googleDelay = parseInt(args[++i], 10); break;
      case '--max-retries': opts.maxRetries = parseInt(args[++i], 10); break;
      case '--retry-delay': opts.retryDelay = parseInt(args[++i], 10); break;
      case '--ollama-model': opts.ollamaModel = args[++i]; break;
      case '--no-ollama-fallback': opts.ollamaFallback = false; break;
      case '--openrouter-model': opts.openrouterModel = args[++i]; break;
      case '--groq-model': opts.groqModel = args[++i]; break;
      case '--help':
        console.log(`
Usage: node summarize.js [options]

Options:
  --days <n>           Look back N days (default: 7)
  --since <date>       Look back since date (e.g. 2025-04-01)
  --author <name>      Filter commits by author name/email
  --provider <name>    Force AI provider: google | anthropic | openai | openrouter | groq | ollama
  --projects <file>    Path to projects config JSON (default: projects.json)
  --raw-only           Collect git data only, skip AI summarization
  --ai-only            Summarize from reports_raw only, skip git collection
  --raw-date <date>    Raw input date folder for --ai-only (YYYY-MM-DD)
  --single-summary     Make one combined AI summary for all projects
  --single-summary-max-commits <n>
                       Max commits per project included in single-summary (default: 12)
  --all-branches       Include commits from all branches (read-only)
  --delay <ms>         Delay between AI calls in ms (default: 2000)
  --google-delay <ms>  Minimum delay when provider is google (default: 9000)
  --max-retries <n>    Retries on rate-limit errors (default: 3)
  --retry-delay <ms>   Base retry delay in ms (default: 5000)
  --ollama-model <id>  Ollama model name (default: qwen2.5:7b-instruct)
  --openrouter-model <id> OpenRouter model id (default: openrouter/auto)
  --groq-model <id>    Groq model id (default: llama-3.1-8b-instant)
  --no-ollama-fallback Disable fallback to Ollama when cloud API fails
  --json               Output raw JSON
  --help               Show this help

Providers — set one of these environment variables:
  GOOGLE_API_KEY       → Google Gemini  (get free key at aistudio.google.com)
  ANTHROPIC_API_KEY    → Anthropic Claude
  OPENAI_API_KEY       → OpenAI GPT-4o
  OPENROUTER_API_KEY   → OpenRouter
  GROQ_API_KEY         → Groq
  Ollama (local)       → no API key required (requires running Ollama)

Output:
  reports_raw/YYYY-MM-DD/<project>.txt   Raw git log with file changes
  reports/YYYY-MM-DD-<provider>/<project>.md   AI-generated summary per project
  reports/YYYY-MM-DD-<provider>/README.md      Combined summary of all projects
`);
        process.exit(0);
    }
  }

  return opts;
}

// ── Provider setup ────────────────────────────────────────────────────────────

const PROVIDERS = {
  google: {
    envKey: 'GOOGLE_API_KEY',
    label: 'Google Gemini',
    async build() {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
      return genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
    },
    async summarize(client, prompt) {
      const result = await client.generateContent(prompt);
      return result.response.text();
    },
  },
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    label: 'Anthropic Claude',
    async build() {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      return new Anthropic();
    },
    async summarize(client, prompt) {
      const res = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.content.find(b => b.type === 'text')?.text ?? '';
    },
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    label: 'OpenAI GPT-4o',
    async build() {
      const { default: OpenAI } = await import('openai');
      return new OpenAI();
    },
    async summarize(client, prompt) {
      const res = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.choices[0]?.message?.content ?? '';
    },
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    async build() {
      const { default: OpenAI } = await import('openai');
      return new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
      });
    },
    async summarize(client, prompt, opts) {
      const res = await client.chat.completions.create({
        model: opts.openrouterModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        extra_headers: {
          ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
          ...(process.env.OPENROUTER_APP_NAME ? { 'X-Title': process.env.OPENROUTER_APP_NAME } : {}),
        },
      });
      return res.choices[0]?.message?.content ?? '';
    },
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    label: 'Groq',
    async build() {
      const { default: OpenAI } = await import('openai');
      return new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    },
    async summarize(client, prompt, opts) {
      const res = await client.chat.completions.create({
        model: opts.groqModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.choices[0]?.message?.content ?? '';
    },
  },
  ollama: {
    envKey: null,
    label: 'Ollama (local)',
    async build(opts) {
      return { model: opts.ollamaModel };
    },
    async summarize(client, prompt) {
      const res = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: client.model,
          prompt,
          stream: false,
          options: { temperature: 0.2 },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama request failed (${res.status}): ${body || 'unknown error'}`);
      }

      const data = await res.json();
      return (data.response || '').trim();
    },
  },
};

function detectProvider(forced) {
  if (forced) {
    if (!PROVIDERS[forced]) {
      console.error(`❌ Unknown provider "${forced}". Choose: google | anthropic | openai | openrouter | groq | ollama`);
      process.exit(1);
    }
    const p = PROVIDERS[forced];
    if (p.envKey && !process.env[p.envKey]) {
      console.error(`❌ ${p.envKey} is not set (required for --provider ${forced})`);
      process.exit(1);
    }
    return forced;
  }

  if (process.env.OPENROUTER_API_KEY) {
    return 'openrouter';
  }

  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (name === 'openrouter') continue;
    if (p.envKey && process.env[p.envKey]) return name;
  }

  return 'ollama';
}

function loadOpenRouterKeyFromFile() {
  if (process.env.OPENROUTER_API_KEY) return;

  const keyFilePath = join(__dirname, 'open-router.key');
  if (!existsSync(keyFilePath)) return;

  const key = readFileSync(keyFilePath, 'utf8').trim();
  if (key) {
    process.env.OPENROUTER_API_KEY = key;
  }
}

function loadGroqKeyFromFile() {
  if (process.env.GROQ_API_KEY) return;

  const keyFilePath = join(__dirname, 'groq.key');
  if (!existsSync(keyFilePath)) return;

  const key = readFileSync(keyFilePath, 'utf8').trim();
  if (key) {
    process.env.GROQ_API_KEY = key;
  }
}

async function checkOllamaReady(model) {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) {
      return { ok: false, reason: `Ollama /api/tags failed with HTTP ${res.status}` };
    }

    const data = await res.json();
    const models = data.models ?? [];
    const hasModel = models.some(m => m.name === model || m.name.startsWith(`${model}:`));
    if (!hasModel) {
      return { ok: false, reason: `Model "${model}" not found. Run: ollama pull ${model}` };
    }

    return { ok: true, reason: '' };
  } catch {
    return {
      ok: false,
      reason: 'Cannot reach Ollama at http://127.0.0.1:11434 (is `ollama serve` running?)',
    };
  }
}

// ── Git log ───────────────────────────────────────────────────────────────────

function resolvePath(p) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return resolve(p);
}

function getGitLog(projectPath, opts) {
  const absPath = resolvePath(projectPath);

  if (!existsSync(absPath)) {
    return { error: `Path not found: ${absPath}` };
  }

  try {
    execSync('git rev-parse --git-dir', { cwd: absPath, stdio: 'pipe' });
  } catch {
    return { error: `Not a git repository: ${absPath}` };
  }

  const sinceFlag = opts.since
    ? `--since="${opts.since}"`
    : `--since="${opts.days} days ago"`;
  const authorFlag = opts.author ? `--author="${opts.author}"` : '';
  const allFlag = opts.allBranches ? '--all' : '';

  try {
    // Compact commit list for AI prompt
    const commitRaw = execSync(
      `git log --date=short --format="%h|%an|%ad|%s" ${sinceFlag} ${authorFlag} ${allFlag}`,
      { cwd: absPath, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
    ).toString().trim();

    if (!commitRaw) return { commits: [], total: 0, statRaw: '' };

    const commits = commitRaw.split('\n').map(line => {
      const [shortHash, author, date, ...rest] = line.split('|');
      return { shortHash, author, date, subject: rest.join('|') };
    });

    // Detailed log with file stats for raw report
    const statRaw = execSync(
      `git log --date=short --format="%n[%ad] %h  %an: %s" --stat ${sinceFlag} ${authorFlag} ${allFlag}`,
      { cwd: absPath, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 }
    ).toString().trim();

    return { commits, total: commits.length, statRaw };
  } catch (err) {
    return { error: `git log failed: ${err.message}` };
  }
}

// ── Report helpers ─────────────────────────────────────────────────────────────

function getDateStr() {
  return new Date().toISOString().split('T')[0]; // yyyy-mm-dd
}

function isDateFolderName(name) {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

function parseRawReport(projectName, rawContent) {
  const errorMatch = rawContent.match(/^Error\s*:\s*(.+)$/m);
  if (errorMatch) {
    return { name: projectName, error: errorMatch[1].trim() };
  }

  const commitsMatch = rawContent.match(/^Commits\s*:\s*(\d+)$/m);
  const declaredTotal = commitsMatch ? parseInt(commitsMatch[1], 10) : 0;

  const commitRegex = /^\[(\d{4}-\d{2}-\d{2})\]\s+([0-9a-f]+)\s+(.+?):\s(.+)$/gm;
  const commits = [];
  let match;

  while ((match = commitRegex.exec(rawContent)) !== null) {
    const [, date, shortHash, author, subject] = match;
    commits.push({ date, shortHash, author, subject });
  }

  const divider = '═'.repeat(72);
  let statRaw = '';
  const dividerIndex = rawContent.indexOf(divider);
  if (dividerIndex >= 0) {
    statRaw = rawContent.slice(dividerIndex + divider.length).trim();
  }
  if (statRaw === '(no commits)') {
    statRaw = '';
  }

  const total = Number.isFinite(declaredTotal) && declaredTotal >= 0
    ? declaredTotal
    : commits.length;

  return {
    name: projectName,
    commits: total,
    logResult: {
      commits,
      total,
      statRaw,
    },
  };
}

function detectLatestRawDate(baseRawDir) {
  if (!existsSync(baseRawDir)) return null;

  const dateDirs = readdirSync(baseRawDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && isDateFolderName(entry.name))
    .map(entry => entry.name)
    .sort();

  return dateDirs.length > 0 ? dateDirs[dateDirs.length - 1] : null;
}

function loadGitResultsFromRaw(projects, rawDir) {
  const results = [];

  for (const project of projects) {
    const rawPath = join(rawDir, `${project.name}.txt`);
    if (!existsSync(rawPath)) {
      results.push({
        name: project.name,
        path: project.path,
        error: `Raw report not found: ${rawPath}`,
      });
      continue;
    }

    const rawContent = readFileSync(rawPath, 'utf8');
    const parsed = parseRawReport(project.name, rawContent);
    results.push({
      ...parsed,
      path: project.path,
    });
  }

  return results;
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function buildRawReport(projectName, projectPath, logResult, opts, dateStr) {
  const period = opts.since
    ? `since ${opts.since}`
    : `last ${opts.days} day${opts.days !== 1 ? 's' : ''}`;

  const header = [
    `Project : ${projectName}`,
    `Path    : ${resolvePath(projectPath)}`,
    `Period  : ${period}`,
    `Date    : ${dateStr}`,
    `Commits : ${logResult.total}`,
    '═'.repeat(72),
    '',
  ].join('\n');

  return header + (logResult.statRaw || '(no commits)');
}

function buildPrompt(projectName, logResult) {
  const lines = logResult.commits
    .map(c => `[${c.date}] ${c.shortHash} ${c.author}: ${c.subject}`)
    .join('\n');

  return `You are a technical lead reviewing git activity for a project.

Below are recent git commits for the project "${projectName}". Please provide a concise summary that covers:
1. **Main changes** — what was added, fixed, or changed
2. **Key areas** — which parts of the codebase were touched
3. **Notable highlights** — anything important or worth attention

Keep the summary short (3–6 bullet points or 2–3 paragraphs). Be specific and technical.

---
${lines}
---`;
}

function buildProjectMarkdown(projectName, commits, summary, dateStr) {
  return [
    `# ${projectName}`,
    '',
    `**Date:** ${dateStr}  `,
    `**Commits:** ${commits}`,
    '',
    '## Summary',
    '',
    summary,
    '',
  ].join('\n');
}

function collectChangeMetrics(logResult) {
  if (!logResult) return null;

  const commits = Array.isArray(logResult.commits) ? logResult.commits : [];
  const commitCount = Number.isFinite(logResult.total) ? logResult.total : commits.length;

  const authorCounts = new Map();
  for (const c of commits) {
    if (!c?.author) continue;
    authorCounts.set(c.author, (authorCounts.get(c.author) || 0) + 1);
  }

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  const statRaw = logResult.statRaw || '';
  for (const line of statRaw.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+files? changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/);
    if (!match) continue;

    filesChanged += parseInt(match[1], 10) || 0;
    insertions += parseInt(match[2] || '0', 10) || 0;
    deletions += parseInt(match[3] || '0', 10) || 0;
  }

  const topAuthors = [...authorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return {
    commitCount,
    filesChanged,
    insertions,
    deletions,
    lineChanges: insertions + deletions,
    topAuthors,
  };
}

function formatTopAuthors(topAuthors) {
  if (!topAuthors || topAuthors.length === 0) return 'n/a';
  return topAuthors
    .map(([author, count]) => `${author} (${count})`)
    .join(', ');
}

function extractTopChangedFiles(statRaw, limit = 6) {
  if (!statRaw) return [];

  const fileCounts = new Map();
  const lines = statRaw.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const parts = line.split('|');
    if (parts.length < 2) continue;

    const rawPath = parts[0].trim();
    if (!rawPath || rawPath.startsWith('[') || rawPath.includes('files changed')) continue;

    const countMatch = parts[1].match(/\d+/);
    const count = countMatch ? parseInt(countMatch[0], 10) : 1;
    fileCounts.set(rawPath, (fileCounts.get(rawPath) || 0) + count);
  }

  return [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, count]) => `${path} (${count})`);
}

function buildCombinedPrompt(items, opts) {
  const sorted = [...items].sort((a, b) => b.commits - a.commits);

  const blocks = sorted
    .map(item => {
      const selectedCommits = item.logResult.commits.slice(0, opts.singleSummaryMaxCommits);
      const omitted = Math.max(item.logResult.commits.length - selectedCommits.length, 0);
      const lines = selectedCommits
        .map(c => `- [${c.date}] ${c.shortHash} ${c.author}: ${c.subject}`)
        .join('\n');
      const hotFiles = extractTopChangedFiles(item.logResult.statRaw, 6)
        .map(f => `- ${f}`)
        .join('\n');

      return [
        `Project: ${item.name}`,
        `Commits: ${item.commits}`,
        hotFiles ? `Top changed files:\n${hotFiles}` : 'Top changed files: (not available)',
        omitted > 0 ? `Additional commits omitted for brevity: ${omitted}` : null,
        'Recent commits:',
        lines,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n---\n\n');

  return `You are a technical lead reviewing git activity across multiple projects.

Output strict Markdown with these exact sections in order:
1. ## Executive Summary
2. ## Cross-Project Risks
3. ## Project Highlights
4. ## Recommended Next Actions

Quality requirements:
- Be specific: reference concrete modules/files from "Top changed files" where possible.
- In "Project Highlights", include every active project as bullet points, one line each.
- Mention high-risk projects first (largest changes, security, or finance-impacting changes).
- Keep concise but informative: around 15-30 bullets total.

---
${blocks}
---`;
}

function buildSingleSummaryReadme(dateStr, dateRange, results, combinedSummary) {
  const active = results.filter(r => r.commits > 0 && !r.error);
  const quiet = results.filter(r => r.commits === 0 && !r.error);
  const errors = results.filter(r => r.error);

  const lines = [
    `# Project Summary — ${dateStr}`,
    '',
    `**Period:** ${dateRange}  `,
    `**Mode:** single-summary (one AI request)  `,
    `**Projects:** ${results.length} total — ${active.length} active, ${quiet.length} quiet, ${errors.length} errors`,
    '',
    '## Combined Summary',
    '',
    combinedSummary || '_No summary available_',
    '',
    '---',
    '',
    '## Activity By Project',
    '',
  ];

  for (const r of active) {
    const metrics = collectChangeMetrics(r.logResult);
    if (!metrics) {
      lines.push(`- ${r.name}: ${r.commits} commit${r.commits !== 1 ? 's' : ''}`);
      continue;
    }

    lines.push(`- ${r.name}: ${metrics.commitCount} commit${metrics.commitCount !== 1 ? 's' : ''}, ${metrics.filesChanged} file${metrics.filesChanged !== 1 ? 's' : ''} changed, +${metrics.insertions}/-${metrics.deletions} lines (${metrics.lineChanges} total), by ${formatTopAuthors(metrics.topAuthors)}`);
  }

  if (quiet.length > 0) {
    lines.push('');
    lines.push('## No activity');
    lines.push('');
    lines.push(quiet.map(r => `- ${r.name}`).join('\n'));
  }

  if (errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    lines.push('');
    lines.push(errors.map(r => `- **${r.name}**: ${r.error}`).join('\n'));
  }

  lines.push('');
  return lines.join('\n');
}

function buildReadme(dateStr, dateRange, results) {
  const active = results.filter(r => r.commits > 0 && !r.error);
  const quiet  = results.filter(r => r.commits === 0 && !r.error);
  const errors = results.filter(r => r.error);

  const lines = [
    `# Project Summary — ${dateStr}`,
    '',
    `**Period:** ${dateRange}  `,
    `**Projects:** ${results.length} total — ${active.length} active, ${quiet.length} quiet, ${errors.length} errors`,
    '',
    '---',
    '',
  ];

  for (const r of active) {
    const metrics = collectChangeMetrics(r.logResult);

    lines.push(`## 📦 ${r.name}  (${r.commits} commit${r.commits !== 1 ? 's' : ''})`);
    lines.push('');
    if (metrics) {
      lines.push(`**Contributors:** ${formatTopAuthors(metrics.topAuthors)}  `);
      lines.push(`**Change stats:** ${metrics.filesChanged} file${metrics.filesChanged !== 1 ? 's' : ''} changed, +${metrics.insertions}/-${metrics.deletions} lines (${metrics.lineChanges} total)`);
      lines.push('');
    }
    lines.push(r.summary || '_No summary available_');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (quiet.length > 0) {
    lines.push('## 😴 No activity');
    lines.push('');
    lines.push(quiet.map(r => `- ${r.name}`).join('\n'));
    lines.push('');
  }

  if (errors.length > 0) {
    lines.push('## ⚠️ Errors');
    lines.push('');
    lines.push(errors.map(r => `- **${r.name}**: ${r.error}`).join('\n'));
    lines.push('');
  }

  return lines.join('\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource exhausted')
  );
}

async function summarizeWithRetry(provider, client, prompt, opts, providerLabel) {
  let attempt = 0;
  let lastErr = null;

  while (attempt <= opts.maxRetries) {
    try {
      return await provider.summarize(client, prompt, opts);
    } catch (err) {
      lastErr = err;
      const canRetry = isRateLimitError(err) && attempt < opts.maxRetries;
      if (!canRetry) throw err;

      const backoff = opts.retryDelay * (2 ** attempt);
      const jitter = Math.floor(Math.random() * 500);
      const waitMs = backoff + jitter;
      process.stdout.write(`\n   ⏳ ${providerLabel} rate-limited, retry ${attempt + 1}/${opts.maxRetries} in ${waitMs}ms...`);
      await sleep(waitMs);
      attempt += 1;
    }
  }

  throw lastErr;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadOpenRouterKeyFromFile();
  loadGroqKeyFromFile();

  const opts = parseArgs();
  if (opts.rawOnly && opts.aiOnly) {
    console.error('❌ --raw-only and --ai-only cannot be used together');
    process.exit(1);
  }

  if (opts.rawDate && !isDateFolderName(opts.rawDate)) {
    console.error('❌ --raw-date must be in YYYY-MM-DD format');
    process.exit(1);
  }

  const configPath = resolvePath(opts.projectsFile);
  if (!existsSync(configPath)) {
    console.error(`❌ Projects config not found: ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const projects = config.projects ?? [];
  if (projects.length === 0) {
    console.error('❌ No projects defined in config');
    process.exit(1);
  }

  const today = getDateStr();
  let rawDate = today;
  if (opts.aiOnly) {
    const baseRawDir = join(__dirname, 'reports_raw');
    rawDate = opts.rawDate || detectLatestRawDate(baseRawDir);
    if (!rawDate) {
      console.error('❌ No reports_raw date folders found. Run raw collection first.');
      process.exit(1);
    }
  }

  const dateStr = rawDate;
  const dateRange = opts.since
    ? `since ${opts.since}`
    : (opts.aiOnly
      ? `from raw reports (${rawDate})`
      : `last ${opts.days} day${opts.days !== 1 ? 's' : ''}`);

  // Prepare output directories
  const rawDir = join(__dirname, 'reports_raw', rawDate);
  if (!opts.aiOnly) {
    ensureDir(rawDir);
  }

  // ── Phase 1: collect git logs OR load raw reports ────────────────────────
  console.log(`\n🔍 Project Summarizer — ${dateRange}`);
  if (!opts.aiOnly && opts.author) console.log(`👤 Author filter: ${opts.author}`);
  console.log('─'.repeat(60));

  let gitResults = [];

  if (opts.aiOnly) {
    if (!existsSync(rawDir)) {
      console.error(`❌ Raw reports directory not found: ${rawDir}`);
      process.exit(1);
    }

    console.log(`📁 Loading raw logs from reports_raw/${rawDate}/ for ${projects.length} projects…`);
    gitResults = loadGitResultsFromRaw(projects, rawDir);
  } else {
    console.log(`📁 Collecting git logs for ${projects.length} projects…\n`);

    for (const project of projects) {
      process.stdout.write(`\n📦 ${project.name}… `);
      const logResult = getGitLog(project.path, opts);

      if (logResult.error) {
        console.log(`⚠️  ${logResult.error}`);
        gitResults.push({ name: project.name, path: project.path, error: logResult.error });
        // Still write an error raw file
        const content = `Project : ${project.name}\nError   : ${logResult.error}\n`;
        writeFileSync(join(rawDir, `${project.name}.txt`), content, 'utf8');
        continue;
      }

      if (logResult.total === 0) {
        console.log('no commits');
        gitResults.push({ name: project.name, path: project.path, commits: 0, logResult });
        writeFileSync(
          join(rawDir, `${project.name}.txt`),
          buildRawReport(project.name, project.path, logResult, opts, dateStr),
          'utf8'
        );
        continue;
      }

      console.log(`${logResult.total} commit${logResult.total !== 1 ? 's' : ''}`);
      gitResults.push({ name: project.name, path: project.path, commits: logResult.total, logResult });

      writeFileSync(
        join(rawDir, `${project.name}.txt`),
        buildRawReport(project.name, project.path, logResult, opts, dateStr),
        'utf8'
      );
    }

    console.log(`\n✅ Raw logs saved → reports_raw/${rawDate}/`);
  }

  if (opts.rawOnly) {
    const active = gitResults.filter(r => r.commits > 0).length;
    const quiet  = gitResults.filter(r => r.commits === 0 && !r.error).length;
    const errors = gitResults.filter(r => r.error).length;
    console.log(`   ${active} active, ${quiet} quiet, ${errors} errors`);
    return;
  }

  // ── Phase 2: AI summarization ────────────────────────────────────────────
  const providerName = detectProvider(opts.provider);
  const provider     = PROVIDERS[providerName];
  const aiClient     = await provider.build(opts);
  const effectiveDelay = providerName === 'google'
    ? Math.max(opts.delay, opts.googleDelay)
    : opts.delay;
  const reportTag = `${rawDate}-${providerName}`;
  const reportDir = join(__dirname, 'reports', reportTag);
  ensureDir(reportDir);

  // Check Ollama once so fallback errors are clear and early.
  const shouldCheckOllama = providerName === 'ollama' || opts.ollamaFallback;
  let ollamaReady = false;
  let ollamaIssue = '';

  if (shouldCheckOllama) {
    const ollamaStatus = await checkOllamaReady(opts.ollamaModel);
    ollamaReady = ollamaStatus.ok;
    ollamaIssue = ollamaStatus.reason;

    if (providerName === 'ollama' && !ollamaReady) {
      console.error(`❌ Ollama is required but not ready: ${ollamaIssue}`);
      process.exit(1);
    }

    if (providerName !== 'ollama' && opts.ollamaFallback && !ollamaReady) {
      console.log(`⚠️  Ollama fallback unavailable: ${ollamaIssue}`);
    }
  }

  console.log(`\n🤖 Summarizing with ${provider.label} (delay: ${effectiveDelay}ms between calls)…`);
  if (providerName !== 'ollama' && opts.ollamaFallback && ollamaReady) {
    console.log(`   Fallback enabled → Ollama (${opts.ollamaModel})`);
  }
  if (opts.singleSummary) {
    console.log('   Mode: single-summary (one AI request for all active projects)');
  }
  console.log('─'.repeat(60));

  const results = [];

  if (opts.singleSummary) {
    for (const item of gitResults) {
      if (item.error) {
        results.push({ name: item.name, error: item.error });
        continue;
      }
      if (item.commits === 0) {
        results.push({ name: item.name, commits: 0, summary: null });
        continue;
      }
      results.push({ name: item.name, commits: item.commits, summary: null, logResult: item.logResult });
    }

    const activeItems = results.filter(r => r.commits > 0 && r.logResult);
    let combinedSummary = '_No active projects to summarize._';

    if (activeItems.length > 0) {
      process.stdout.write(`\n📦 Combined summary (${activeItems.length} active projects) — summarizing… `);
      try {
        const prompt = buildCombinedPrompt(activeItems, opts);
        combinedSummary = await summarizeWithRetry(provider, aiClient, prompt, opts, provider.label);
        console.log('✓');
      } catch (err) {
        if (providerName !== 'ollama' && opts.ollamaFallback && ollamaReady) {
          try {
            const ollamaClient = await PROVIDERS.ollama.build(opts);
            const prompt = buildCombinedPrompt(activeItems, opts);
            combinedSummary = await summarizeWithRetry(PROVIDERS.ollama, ollamaClient, prompt, opts, PROVIDERS.ollama.label);
            console.log(`↺ cloud failed (${err.message}) → fallback ok`);
          } catch (ollamaErr) {
            combinedSummary = `[AI summary failed: ${err.message}] [Ollama fallback failed: ${ollamaErr.message}]`;
            console.log(`✗ ${err.message} | fallback failed: ${ollamaErr.message}`);
          }
        } else {
          combinedSummary = `[AI summary failed: ${err.message}]`;
          console.log(`✗ ${err.message}`);
        }
      }
    }

    writeFileSync(
      join(reportDir, 'README.md'),
      buildSingleSummaryReadme(dateStr, dateRange, results, combinedSummary),
      'utf8'
    );

    if (opts.output === 'text') {
      console.log('\n' + '─'.repeat(60));
      console.log('📦 Combined Summary');
      console.log('─'.repeat(60));
      console.log(combinedSummary);
    }

    const active = results.filter(r => r.commits > 0 && !r.error).length;
    const quiet  = results.filter(r => r.commits === 0 && !r.error).length;
    const errors = results.filter(r => r.error).length;

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Done — ${active} active, ${quiet} quiet, ${errors} errors`);
    console.log(`📄 Reports saved → reports/${reportTag}/`);
    console.log(`   reports/${reportTag}/README.md  (combined, single-summary mode)`);

    if (opts.output === 'json') {
      console.log('\n' + JSON.stringify(results, null, 2));
    }

    return;
  }

  for (const item of gitResults) {
    if (item.error) {
      results.push({ name: item.name, error: item.error });
      continue;
    }

    if (item.commits === 0) {
      results.push({ name: item.name, commits: 0, summary: null });
      continue;
    }

    process.stdout.write(`\n📦 ${item.name} (${item.commits} commits) — summarizing… `);

    let summary = '';
    try {
      const prompt = buildPrompt(item.name, item.logResult);
      summary = await summarizeWithRetry(provider, aiClient, prompt, opts, provider.label);
      console.log('✓');
    } catch (err) {
      if (providerName !== 'ollama' && opts.ollamaFallback && ollamaReady) {
        try {
          const ollamaClient = await PROVIDERS.ollama.build(opts);
          const prompt = buildPrompt(item.name, item.logResult);
          summary = await summarizeWithRetry(PROVIDERS.ollama, ollamaClient, prompt, opts, PROVIDERS.ollama.label);
          console.log(`↺ cloud failed (${err.message}) → fallback ok`);
        } catch (ollamaErr) {
          summary = `[AI summary failed: ${err.message}] [Ollama fallback failed: ${ollamaErr.message}]`;
          console.log(`✗ ${err.message} | fallback failed: ${ollamaErr.message}`);
        }
      } else {
        summary = `[AI summary failed: ${err.message}]`;
        console.log(`✗ ${err.message}`);
      }
    }

    results.push({ name: item.name, commits: item.commits, summary, logResult: item.logResult });

    // Save individual project report
    writeFileSync(
      join(reportDir, `${item.name}.md`),
      buildProjectMarkdown(item.name, item.commits, summary, dateStr),
      'utf8'
    );

    if (opts.output === 'text') {
      console.log('\n' + '─'.repeat(60));
      console.log(`📦 ${item.name}  (${item.commits} commits)`);
      console.log('─'.repeat(60));
      console.log(summary);
    }

    // Delay between AI calls to avoid rate limits
    await sleep(effectiveDelay);
  }

  // Save combined README
  writeFileSync(
    join(reportDir, 'README.md'),
    buildReadme(dateStr, dateRange, results),
    'utf8'
  );

  const active = results.filter(r => r.commits > 0 && !r.error).length;
  const quiet  = results.filter(r => r.commits === 0 && !r.error).length;
  const errors = results.filter(r => r.error).length;

  console.log('\n' + '═'.repeat(60));
  console.log(`✅ Done — ${active} active, ${quiet} quiet, ${errors} errors`);
  console.log(`📄 Reports saved → reports/${reportTag}/`);
  console.log(`   reports/${reportTag}/README.md  (combined)`);

  if (opts.output === 'json') {
    console.log('\n' + JSON.stringify(results, null, 2));
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
