#!/usr/bin/env node

import { Command } from 'commander';
import { ChromiumAPI } from './api.js';
import { formatOutput, OutputFormat } from './formatter.js';
import { loadConfig } from './config.js';
import { getAIUsageGuide } from './ai-guide.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), '..');
const packageJsonPath = path.join(packageRoot, 'package.json');

let packageInfo: { version: string; name: string };
try {
  packageInfo = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
} catch (error) {
  packageInfo = { version: "1.0.0", name: "chromium-helper" };
}

const program = new Command();

async function main() {
  const config = await loadConfig();
  const api = new ChromiumAPI(config.apiKey);

  program
    .name('chromium-helper')
    .alias('cr')
    .description('CLI tool for searching and exploring Chromium source code')
    .version(packageInfo.version)
    .option('-f, --format <type>', 'output format (json|table|plain)', 'plain')
    .option('--no-color', 'disable colored output')
    .option('--debug', 'enable debug logging')
    .option('--ai', 'show comprehensive usage guide for AI systems');

  // Handle --ai flag
  if (process.argv.includes('--ai')) {
    console.log(getAIUsageGuide());
    process.exit(0);
  }

  // Search commands
  program
    .command('search')
    .alias('s')
    .description('Search Chromium source code')
    .argument('<query>', 'search query')
    .option('-c, --case-sensitive', 'case sensitive search')
    .option('-l, --language <lang>', 'filter by programming language')
    .option('-p, --file-pattern <pattern>', 'file pattern filter')
    .option('-t, --type <type>', 'search type (content|function|class|symbol|comment)')
    .option('--exclude-comments', 'exclude comments from search')
    .option('--limit <number>', 'maximum number of results', '20')
    .action(async (query, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.searchCode({
          query,
          caseSensitive: options.caseSensitive,
          language: options.language,
          filePattern: options.filePattern,
          searchType: options.type,
          excludeComments: options.excludeComments,
          limit: parseInt(options.limit)
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'search'));
      } catch (error) {
        console.error('Search failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Symbol lookup command
  program
    .command('symbol')
    .alias('sym')
    .description('Find symbol definitions and usage')
    .argument('<symbol>', 'symbol to find')
    .option('-f, --file <path>', 'file path context for symbol resolution')
    .action(async (symbol, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.findSymbol(symbol, options.file);
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'symbol'));
      } catch (error) {
        console.error('Symbol lookup failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // File content command
  program
    .command('file')
    .alias('f')
    .description('Get file content from Chromium source')
    .argument('<path>', 'file path in Chromium source')
    .option('-s, --start <line>', 'starting line number')
    .option('-e, --end <line>', 'ending line number')
    .action(async (filePath, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getFile({
          filePath,
          lineStart: options.start ? parseInt(options.start) : undefined,
          lineEnd: options.end ? parseInt(options.end) : undefined
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'file'));
      } catch (error) {
        console.error('File fetch failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Gerrit CL commands
  const gerrit = program
    .command('gerrit')
    .alias('gr')
    .description('Gerrit code review operations');

  gerrit
    .command('status')
    .description('Get CL status and test results')
    .argument('<cl>', 'CL number or URL')
    .action(async (cl) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getGerritCLStatus(cl);
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-status'));
      } catch (error) {
        console.error('Gerrit status failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  gerrit
    .command('comments')
    .description('Get CL review comments')
    .argument('<cl>', 'CL number or URL')
    .option('-p, --patchset <number>', 'specific patchset number')
    .option('--no-resolved', 'exclude resolved comments')
    .action(async (cl, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getGerritCLComments({
          clNumber: cl,
          patchset: options.patchset ? parseInt(options.patchset) : undefined,
          includeResolved: options.resolved !== false
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-comments'));
      } catch (error) {
        console.error('Gerrit comments failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  gerrit
    .command('diff')
    .description('Get CL diff/changes')
    .argument('<cl>', 'CL number or URL')
    .option('-p, --patchset <number>', 'specific patchset number')
    .option('-f, --file <path>', 'specific file path to get diff for')
    .action(async (cl, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getGerritCLDiff({
          clNumber: cl,
          patchset: options.patchset ? parseInt(options.patchset) : undefined,
          filePath: options.file
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-diff'));
      } catch (error) {
        console.error('Gerrit diff failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  gerrit
    .command('file')
    .description('Get file content from CL patchset')
    .argument('<cl>', 'CL number or URL')
    .argument('<path>', 'file path to get content for')
    .option('-p, --patchset <number>', 'specific patchset number')
    .action(async (cl, filePath, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getGerritPatchsetFile({
          clNumber: cl,
          filePath,
          patchset: options.patchset ? parseInt(options.patchset) : undefined
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-file'));
      } catch (error) {
        console.error('Gerrit file failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Owners command
  program
    .command('owners')
    .alias('own')
    .description('Find OWNERS files for a file path')
    .argument('<path>', 'file path to find owners for')
    .action(async (filePath) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.findOwners(filePath);
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'owners'));
      } catch (error) {
        console.error('Owners lookup failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Commits search command
  program
    .command('commits')
    .alias('cm')
    .description('Search commit history')
    .argument('<query>', 'search query for commits')
    .option('-a, --author <author>', 'filter by author')
    .option('--since <date>', 'commits after date (YYYY-MM-DD)')
    .option('--until <date>', 'commits before date (YYYY-MM-DD)')
    .option('--limit <number>', 'maximum number of results', '20')
    .action(async (query, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.searchCommits({
          query,
          author: options.author,
          since: options.since,
          until: options.until,
          limit: parseInt(options.limit)
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'commits'));
      } catch (error) {
        console.error('Commit search failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Issue commands
  const issues = program
    .command('issues')
    .alias('bugs')
    .description('Chromium issue operations');

  issues
    .command('get')
    .alias('show')
    .description('Get Chromium issue details')
    .argument('<id>', 'issue ID or URL')
    .action(async (issueId) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getIssue(issueId);
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'issue'));
      } catch (error) {
        console.error('Issue lookup failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  issues
    .command('search')
    .alias('find')
    .description('Search Chromium issues')
    .argument('<query>', 'search query')
    .option('--limit <number>', 'maximum number of results', '50')
    .option('--start <number>', 'starting index for pagination', '0')
    .action(async (query, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.searchIssues(query, {
          limit: parseInt(options.limit),
          startIndex: parseInt(options.start)
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'issue-search'));
      } catch (error) {
        console.error('Issue search failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Legacy issue command for backward compatibility
  program
    .command('issue')
    .alias('bug')
    .description('Get Chromium issue details')
    .argument('<id>', 'issue ID or URL')
    .action(async (issueId) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getIssue(issueId);
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'issue'));
      } catch (error) {
        console.error('Issue lookup failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Direct issue search command for convenience
  program
    .command('issue-search')
    .alias('isearch')
    .description('Search Chromium issues (shortcut for issues search)')
    .argument('<query>', 'search query')
    .option('--limit <number>', 'maximum number of results', '50')
    .option('--start <number>', 'starting index for pagination', '0')
    .action(async (query, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.searchIssues(query, {
          limit: parseInt(options.limit),
          startIndex: parseInt(options.start)
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'issue-search'));
      } catch (error) {
        console.error('Issue search failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // PDFium Gerrit commands
  const pdfium = program
    .command('pdfium')
    .alias('pdf')
    .description('PDFium Gerrit operations');

  pdfium
    .command('status')
    .description('Get PDFium CL status and test results')
    .argument('<cl>', 'CL number or URL')
    .action(async (cl) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getPdfiumGerritCLStatus(cl);
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-status'));
      } catch (error) {
        console.error('PDFium Gerrit status failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  pdfium
    .command('comments')
    .description('Get PDFium CL review comments')
    .argument('<cl>', 'CL number or URL')
    .option('-p, --patchset <number>', 'specific patchset number')
    .option('--no-resolved', 'exclude resolved comments')
    .action(async (cl, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getPdfiumGerritCLComments({
          clNumber: cl,
          patchset: options.patchset ? parseInt(options.patchset) : undefined,
          includeResolved: options.resolved !== false
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-comments'));
      } catch (error) {
        console.error('PDFium Gerrit comments failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  pdfium
    .command('diff')
    .description('Get PDFium CL diff/changes')
    .argument('<cl>', 'CL number or URL')
    .option('-p, --patchset <number>', 'specific patchset number')
    .option('-f, --file <path>', 'specific file path to get diff for')
    .action(async (cl, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getPdfiumGerritCLDiff({
          clNumber: cl,
          patchset: options.patchset ? parseInt(options.patchset) : undefined,
          filePath: options.file
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-diff'));
      } catch (error) {
        console.error('PDFium Gerrit diff failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  pdfium
    .command('file')
    .description('Get file content from PDFium CL patchset')
    .argument('<cl>', 'CL number or URL')
    .argument('<path>', 'file path to get content for')
    .option('-p, --patchset <number>', 'specific patchset number')
    .action(async (cl, filePath, options) => {
      try {
        const globalOptions = program.opts();
        api.setDebugMode(globalOptions.debug);
        
        const results = await api.getPdfiumGerritPatchsetFile({
          clNumber: cl,
          filePath,
          patchset: options.patchset ? parseInt(options.patchset) : undefined
        });
        
        const format = program.opts().format as OutputFormat;
        console.log(formatOutput(results, format, 'gerrit-file'));
      } catch (error) {
        console.error('PDFium Gerrit file failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Config command
  program
    .command('config')
    .description('Configuration management')
    .option('--set-api-key <key>', 'set API key')
    .option('--show', 'show current configuration')
    .action(async (options) => {
      if (options.setApiKey) {
        // TODO: Implement config setting
        console.log('API key configuration not yet implemented');
      } else if (options.show) {
        console.log('Current configuration:');
        console.log(`API Key: ${config.apiKey ? '***set***' : 'not set'}`);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});