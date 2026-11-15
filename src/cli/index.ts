#!/usr/bin/env node
import { Command } from 'commander';
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { run } from 'probot';
import { RuleDatabase } from '../db/database.js';
import { createLLMProvider } from '../llm/factory.js';
import { ConventionMiner } from '../miner/index.js';
import { PRReviewEngine } from '../reviewer/index.js';
import { gitlawApp } from '../github/app.js';
import { GitHubReviewPublisher } from '../github/publisher.js';

dotenv.config();

const program = new Command();

program
  .name('gitlaw')
  .description('PR reviewer that learns team conventions by mining past review comments')
  .version('1.0.0');

// Command: mine
program
  .command('mine')
  .description('Mine past PR reviews from a GitHub repository to extract team conventions')
  .requiredOption('-r, --repo <owner/repo>', 'GitHub repository in format owner/repo')
  .option('-l, --limit <number>', 'Maximum number of past PRs to scan', '30')
  .option('-t, --token <token>', 'GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)')
  .option('-p, --provider <name>', 'LLM provider (gemini, openai, anthropic, mock)')
  .action(async (opts) => {
    const [owner, repo] = opts.repo.split('/');
    if (!owner || !repo) {
      console.error('Error: repo must be in format owner/repo (e.g. facebook/react)');
      process.exit(1);
    }

    const token = opts.token || process.env.GITHUB_TOKEN;
    if (!token && opts.provider !== 'mock') {
      console.warn('Notice: GITHUB_TOKEN not provided. Rate limits for public repositories will apply.');
    }

    const octokit = new Octokit({ auth: token });
    const db = new RuleDatabase();
    const llm = createLLMProvider({ provider: opts.provider });
    const miner = new ConventionMiner(octokit, db, llm);

    try {
      const { stats, rules } = await miner.mineRepository({
        owner,
        repo,
        prLimit: parseInt(opts.limit, 10),
      });

      console.log('\n================ Mining Summary ================');
      console.log(`Scanned PRs:              ${stats.scannedPRs}`);
      console.log(`Scanned Comments:         ${stats.scannedComments}`);
      console.log(`Filtered Noise:           ${stats.filteredNoiseComments}`);
      console.log(`Raw Extracted Rules:      ${stats.extractedRawRules}`);
      console.log(`Synthesized Team Rules:   ${stats.synthesizedRulesCount}`);
      console.log(`Duration:                 ${(stats.durationMs / 1000).toFixed(1)}s`);
      console.log('================================================\n');

      for (const r of rules) {
        console.log(`[${r.category.toUpperCase()}] ${r.title}`);
        console.log(`  Confidence: ${(r.confidence * 100).toFixed(0)}% | Evidence: ${r.evidence.length} comments`);
        console.log(`  Globs: ${r.applicableGlobs.join(', ') || 'all files'}\n`);
      }
    } catch (err: any) {
      console.error('Mining failed:', err.message);
      process.exit(1);
    }
  });

// Command: review
program
  .command('review')
  .description('Audit a PR or local git diff against learned conventions')
  .option('-r, --repo <owner/repo>', 'GitHub repository in format owner/repo')
  .option('-p, --pr <number>', 'PR number to review')
  .option('-d, --diff <path>', 'Path to local unified diff file to review')
  .option('-t, --token <token>', 'GitHub Personal Access Token')
  .option('--publish', 'Post inline comments and review to GitHub PR')
  .action(async (opts) => {
    const token = opts.token || process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    const db = new RuleDatabase();
    const llm = createLLMProvider();
    const reviewer = new PRReviewEngine(octokit, db, llm);

    let rawDiff: string | undefined;
    let owner = 'local';
    let repo = 'diff';
    let pullNumber = 0;

    if (opts.diff) {
      if (!fs.existsSync(opts.diff)) {
        console.error(`Diff file not found: ${opts.diff}`);
        process.exit(1);
      }
      rawDiff = fs.readFileSync(opts.diff, 'utf-8');
    } else if (opts.repo && opts.pr) {
      const parts = opts.repo.split('/');
      owner = parts[0];
      repo = parts[1];
      pullNumber = parseInt(opts.pr, 10);
    } else {
      console.error('Error: specify either --diff <file> OR --repo <owner/repo> and --pr <number>');
      process.exit(1);
    }

    try {
      const summary = await reviewer.reviewPullRequest({
        owner,
        repo,
        pullNumber,
        rawDiff,
      });

      console.log('\n' + summary.summaryComment + '\n');

      if (opts.publish && opts.repo && opts.pr) {
        const prData = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
        const publisher = new GitHubReviewPublisher(octokit);
        await publisher.publishReview({
          owner,
          repo,
          pullNumber,
          commitId: prData.data.head.sha,
          reviewSummary: summary,
        });
      }

      if (summary.violations.some(v => v.severity === 'error')) {
        process.exit(1);
      }
    } catch (err: any) {
      console.error('Review failed:', err.message);
      process.exit(1);
    }
  });

// Command: rules
const rulesCmd = program.command('rules').description('Manage and inspect learned conventions');

rulesCmd
  .command('list')
  .description('List all learned team conventions')
  .action(() => {
    const db = new RuleDatabase();
    const rules = db.getAllRules();

    if (rules.length === 0) {
      console.log('No rules found in database. Run "gitlaw mine" first or "gitlaw rules import".');
      return;
    }

    console.log(`\nFound ${rules.length} active team conventions:\n`);
    for (const r of rules) {
      const icon = r.severity === 'error' ? '🔴' : r.severity === 'warning' ? '🟡' : 'ℹ️';
      console.log(`${icon} [${r.category.toUpperCase()}] ${r.title} (ID: ${r.id})`);
      console.log(`   Confidence: ${(r.confidence * 100).toFixed(0)}% | Occurrences: ${r.occurrenceCount}`);
      console.log(`   Description: ${r.description}`);
      if (r.applicableGlobs.length > 0) {
        console.log(`   Globs: ${r.applicableGlobs.join(', ')}`);
      }
      console.log('');
    }
  });

rulesCmd
  .command('import')
  .description('Import conventions from a JSON file')
  .requiredOption('-i, --input <path>', 'Path to JSON rules file')
  .action(async (opts) => {
    if (!fs.existsSync(opts.input)) {
      console.error(`File not found: ${opts.input}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(opts.input, 'utf-8');
    const rules = JSON.parse(raw);
    const db = new RuleDatabase();
    const llm = createLLMProvider();

    let count = 0;
    for (const rule of rules) {
      const vec = await llm.embed(`${rule.title} ${rule.category} ${rule.description}`);
      db.saveRule(rule, vec);
      count++;
    }
    console.log(`Successfully imported ${count} convention(s) into database.`);
  });

rulesCmd
  .command('export')
  .description('Export conventions to Markdown or JSON')
  .option('-f, --format <format>', 'Export format (markdown or json)', 'markdown')
  .option('-o, --out <path>', 'Output file path (defaults to stdout)')
  .action((opts) => {
    const db = new RuleDatabase();
    const output = opts.format === 'json' ? db.exportToJson() : db.exportToMarkdown();

    if (opts.out) {
      const dir = path.dirname(opts.out);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(opts.out, output, 'utf-8');
      console.log(`Conventions exported to ${opts.out}`);
    } else {
      console.log(output);
    }
  });

// Command: serve (Probot GitHub App)
program
  .command('serve')
  .description('Start the Probot GitHub App webhook server')
  .action(async () => {
    console.log('Starting GitLaw GitHub App webhook listener...');
    run(gitlawApp);
  });

program.parse(process.argv);
