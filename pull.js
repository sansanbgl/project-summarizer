#!/usr/bin/env node
/**
 * project-summarizer: Git pull all configured projects
 *
 * Usage:
 *   node pull.js                          # pull all projects from projects.json
 *   node pull.js --projects projects.json # custom config file
 *   node pull.js --rebase                 # run git pull --rebase
 *   node pull.js --ff-only                # run git pull --ff-only
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    projectsFile: join(__dirname, 'projects.json'),
    pullMode: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--projects':
        opts.projectsFile = args[++i];
        break;
      case '--rebase':
        if (opts.pullMode === '--ff-only') {
          console.error('❌ Use only one mode: --rebase or --ff-only');
          process.exit(1);
        }
        opts.pullMode = '--rebase';
        break;
      case '--ff-only':
        if (opts.pullMode === '--rebase') {
          console.error('❌ Use only one mode: --rebase or --ff-only');
          process.exit(1);
        }
        opts.pullMode = '--ff-only';
        break;
      case '--help':
        console.log(`
Usage: node pull.js [options]

Options:
  --projects <file>    Path to projects config JSON (default: projects.json)
  --rebase             Run git pull --rebase
  --ff-only            Run git pull --ff-only
  --help               Show this help

Examples:
  node pull.js
  node pull.js --projects ./projects.json
  node pull.js --ff-only
`);
        process.exit(0);
      default:
        console.error(`❌ Unknown argument: ${args[i]}`);
        console.error('Run with --help to see available options.');
        process.exit(1);
    }
  }

  return opts;
}

function resolvePath(p) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return resolve(p);
}

function getCurrentBranch(projectPath) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      stdio: 'pipe',
    }).toString().trim();
  } catch {
    return '(unknown branch)';
  }
}

function pullProject(project, pullMode) {
  const absPath = resolvePath(project.path);

  if (!existsSync(absPath)) {
    return { error: `Path not found: ${absPath}` };
  }

  try {
    execSync('git rev-parse --git-dir', { cwd: absPath, stdio: 'pipe' });
  } catch {
    return { error: `Not a git repository: ${absPath}` };
  }

  const branch = getCurrentBranch(absPath);
  const cmd = pullMode ? `git pull ${pullMode}` : 'git pull';

  try {
    const output = execSync(cmd, {
      cwd: absPath,
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim();

    const isUpToDate = /Already up[ -]to[ -]date\.?/i.test(output);
    return {
      branch,
      status: isUpToDate ? 'up-to-date' : 'updated',
      output: output || '(no output)',
    };
  } catch (err) {
    const stderr = err.stderr?.toString?.().trim();
    const stdout = err.stdout?.toString?.().trim();
    const message = stderr || stdout || err.message;
    return { branch, error: `git pull failed: ${message}` };
  }
}

async function main() {
  const opts = parseArgs();
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

  const modeLabel = opts.pullMode ? ` (${opts.pullMode})` : '';
  console.log(`\n🔄 Git Pull All${modeLabel}`);
  console.log(`📁 Projects: ${projects.length}`);
  console.log('─'.repeat(60));

  const results = [];

  for (const project of projects) {
    process.stdout.write(`\n📦 ${project.name}... `);
    const result = pullProject(project, opts.pullMode);

    if (result.error) {
      console.log(`⚠️  ${result.error}`);
      results.push({ name: project.name, ...result });
      continue;
    }

    if (result.status === 'up-to-date') {
      console.log(`✅ up to date (${result.branch})`);
    } else {
      console.log(`✅ updated (${result.branch})`);
    }

    results.push({ name: project.name, ...result });
  }

  const updated = results.filter(r => r.status === 'updated').length;
  const upToDate = results.filter(r => r.status === 'up-to-date').length;
  const errors = results.filter(r => r.error).length;

  console.log('\n' + '═'.repeat(60));
  console.log(`✅ Done — ${updated} updated, ${upToDate} up to date, ${errors} errors`);

  if (errors > 0) {
    console.log('\n⚠️ Projects with errors:');
    for (const r of results.filter(x => x.error)) {
      console.log(`- ${r.name}: ${r.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
