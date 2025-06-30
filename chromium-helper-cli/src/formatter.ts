import chalk from 'chalk';
import { table } from 'table';
import { SearchResult } from './api.js';

export type OutputFormat = 'json' | 'table' | 'plain';

export function formatOutput(data: any, format: OutputFormat, context: string): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'table':
      return formatAsTable(data, context);
    case 'plain':
    default:
      return formatAsPlain(data, context);
  }
}

function formatAsTable(data: any, context: string): string {
  switch (context) {
    case 'search':
      return formatSearchResultsTable(data);
    case 'symbol':
      return formatSymbolResultsTable(data);
    case 'file':
      return formatFileTable(data);
    case 'gerrit-status':
      return formatGerritStatusTable(data);
    case 'gerrit-diff':
      return formatGerritDiffTable(data);
    case 'gerrit-file':
      return formatGerritFileTable(data);
    case 'gerrit-bots':
      return formatGerritBotsTable(data);
    case 'owners':
      return formatOwnersTable(data);
    case 'commits':
      return formatCommitsTable(data);
    case 'issue':
      return formatIssueTable(data);
    case 'issue-search':
      return formatIssueSearchTable(data);
    default:
      return JSON.stringify(data, null, 2);
  }
}

function formatAsPlain(data: any, context: string): string {
  switch (context) {
    case 'search':
      return formatSearchResultsPlain(data);
    case 'symbol':
      return formatSymbolResultsPlain(data);
    case 'file':
      return formatFilePlain(data);
    case 'gerrit-status':
      return formatGerritStatusPlain(data);
    case 'gerrit-diff':
      return formatGerritDiffPlain(data);
    case 'gerrit-file':
      return formatGerritFilePlain(data);
    case 'gerrit-bots':
      return formatGerritBotsPlain(data);
    case 'owners':
      return formatOwnersPlain(data);
    case 'commits':
      return formatCommitsPlain(data);
    case 'issue':
      return formatIssuePlain(data);
    case 'issue-search':
      return formatIssueSearchPlain(data);
    default:
      return JSON.stringify(data, null, 2);
  }
}

function formatSearchResultsTable(results: SearchResult[]): string {
  if (!results || results.length === 0) {
    return chalk.yellow('No results found');
  }

  const tableData = [
    ['File', 'Line', 'Content', 'URL']
  ];

  results.forEach(result => {
    tableData.push([
      result.file,
      result.line.toString(),
      result.content.replace(/\n/g, ' ').substring(0, 80) + '...',
      result.url
    ]);
  });

  return table(tableData, {
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼'
    }
  });
}

function formatSearchResultsPlain(results: SearchResult[]): string {
  if (!results || results.length === 0) {
    return chalk.yellow('No results found');
  }

  let output = chalk.cyan(`Found ${results.length} results:\n\n`);

  results.forEach((result, index) => {
    output += chalk.bold.green(`${index + 1}. ${result.file}:${result.line}\n`);
    output += chalk.gray('───────────────────────────────\n');
    output += `${result.content}\n`;
    output += chalk.blue(`🔗 ${result.url}\n\n`);
  });

  return output;
}

function formatSymbolResultsTable(data: any): string {
  const { symbol, symbolResults, classResults, functionResults, usageResults } = data;
  
  let output = chalk.bold.cyan(`Symbol: ${symbol}\n\n`);
  
  const sections = [
    { title: 'Symbol Definitions', results: symbolResults },
    { title: 'Class Definitions', results: classResults },
    { title: 'Function Definitions', results: functionResults },
    { title: 'Usage Examples', results: usageResults }
  ];
  
  sections.forEach(section => {
    if (section.results && section.results.length > 0) {
      output += chalk.bold.yellow(`${section.title}:\n`);
      const tableData = [['File', 'Line', 'Content']];
      
      section.results.forEach((result: SearchResult) => {
        tableData.push([
          result.file,
          result.line.toString(),
          result.content.replace(/\n/g, ' ').substring(0, 60) + '...'
        ]);
      });
      
      output += table(tableData) + '\n';
    }
  });
  
  return output;
}

function formatSymbolResultsPlain(data: any): string {
  const { symbol, symbolResults, classResults, functionResults, usageResults, estimatedUsageCount } = data;
  
  let output = chalk.bold.cyan(`Symbol: ${symbol}\n\n`);
  
  const sections = [
    { title: '🎯 Symbol Definitions', results: symbolResults, icon: '🎯' },
    { title: '🏗️ Class Definitions', results: classResults, icon: '🏗️' },
    { title: '⚙️ Function Definitions', results: functionResults, icon: '⚙️' },
    { title: '📚 Usage Examples', results: usageResults, icon: '📚' }
  ];
  
  sections.forEach(section => {
    if (section.results && section.results.length > 0) {
      output += chalk.bold.yellow(`${section.title}:\n`);
      
      if (section.title.includes('Usage') && estimatedUsageCount) {
        output += chalk.gray(`Found ${estimatedUsageCount} total usage matches across the codebase\n\n`);
      }
      
      section.results.forEach((result: SearchResult, index: number) => {
        output += chalk.green(`${index + 1}. ${result.file}:${result.line}\n`);
        output += `${result.content}\n`;
        output += chalk.blue(`🔗 ${result.url}\n\n`);
      });
    }
  });
  
  return output;
}

function formatFileTable(data: any): string {
  const { filePath, totalLines, displayedLines, lineStart, lineEnd, browserUrl } = data;
  
  let output = chalk.bold.cyan(`File: ${filePath}\n`);
  output += chalk.gray(`Total lines: ${totalLines} | Displayed: ${displayedLines}\n`);
  
  if (lineStart) {
    output += chalk.gray(`Lines: ${lineStart}${lineEnd ? `-${lineEnd}` : '+'}\n`);
  }
  
  output += chalk.blue(`🔗 ${browserUrl}\n\n`);
  output += chalk.gray('Content:\n');
  output += '─'.repeat(80) + '\n';
  output += data.content + '\n';
  output += '─'.repeat(80) + '\n';
  
  return output;
}

function formatFilePlain(data: any): string {
  return formatFileTable(data); // Same formatting for plain and table for files
}

function formatGerritStatusTable(data: any): string {
  if (!data) return chalk.red('No CL data found');
  
  let output = chalk.bold.cyan(`CL: ${data.subject || 'Unknown'}\n\n`);
  
  const infoData = [
    ['Property', 'Value'],
    ['Status', data.status || 'Unknown'],
    ['Owner', data.owner?.name || 'Unknown'],
    ['Created', data.created ? new Date(data.created).toLocaleDateString() : 'Unknown'],
    ['Updated', data.updated ? new Date(data.updated).toLocaleDateString() : 'Unknown']
  ];
  
  output += table(infoData) + '\n';
  
  // Extract and display commit message from current revision
  if (data.current_revision && data.revisions && data.revisions[data.current_revision]) {
    const currentRevision = data.revisions[data.current_revision];
    if (currentRevision.commit && currentRevision.commit.message) {
      output += chalk.bold.yellow('📝 Commit Message:\n');
      output += chalk.gray('─'.repeat(40)) + '\n';
      output += formatCommitMessage(currentRevision.commit.message) + '\n';
    }
  }
  
  return output;
}

function formatGerritStatusPlain(data: any): string {
  if (!data) return chalk.red('No CL data found');
  
  let output = chalk.bold.cyan(`CL: ${data.subject || 'Unknown'}\n\n`);
  output += chalk.yellow('Status: ') + (data.status || 'Unknown') + '\n';
  output += chalk.yellow('Owner: ') + (data.owner?.name || 'Unknown') + '\n';
  output += chalk.yellow('Created: ') + (data.created ? new Date(data.created).toLocaleDateString() : 'Unknown') + '\n';
  output += chalk.yellow('Updated: ') + (data.updated ? new Date(data.updated).toLocaleDateString() : 'Unknown') + '\n';
  
  // Extract and display commit message from current revision
  if (data.current_revision && data.revisions && data.revisions[data.current_revision]) {
    const currentRevision = data.revisions[data.current_revision];
    if (currentRevision.commit && currentRevision.commit.message) {
      output += '\n' + chalk.bold.yellow('📝 Commit Message:\n');
      output += chalk.gray('─'.repeat(40)) + '\n';
      output += formatCommitMessage(currentRevision.commit.message) + '\n';
    }
  }
  
  return output;
}

function formatOwnersTable(data: any): string {
  const { filePath, ownerFiles } = data;
  
  let output = chalk.bold.cyan(`OWNERS for: ${filePath}\n\n`);
  
  if (!ownerFiles || ownerFiles.length === 0) {
    return output + chalk.yellow('No OWNERS files found');
  }
  
  ownerFiles.forEach((owner: any, index: number) => {
    output += chalk.bold.green(`${index + 1}. ${owner.path}\n`);
    output += chalk.gray('───────────────────────────────\n');
    output += owner.content.split('\n').slice(0, 10).join('\n') + '\n';
    output += chalk.blue(`🔗 ${owner.browserUrl}\n\n`);
  });
  
  return output;
}

function formatOwnersPlain(data: any): string {
  return formatOwnersTable(data); // Same formatting
}

function formatCommitsTable(data: any): string {
  if (!data || !data.log || data.log.length === 0) {
    return chalk.yellow('No commits found');
  }
  
  let output = chalk.bold.cyan(`Found ${data.log.length} commits:\n\n`);
  
  const tableData = [
    ['Hash', 'Author', 'Date', 'Message']
  ];
  
  data.log.forEach((commit: any) => {
    tableData.push([
      commit.commit.substring(0, 8),
      commit.author.name,
      new Date(commit.author.time * 1000).toLocaleDateString(),
      commit.message.split('\n')[0].substring(0, 50) + '...'
    ]);
  });
  
  return output + table(tableData);
}

function formatCommitsPlain(data: any): string {
  if (!data || !data.log || data.log.length === 0) {
    return chalk.yellow('No commits found');
  }
  
  let output = chalk.bold.cyan(`Found ${data.log.length} commits:\n\n`);
  
  data.log.forEach((commit: any, index: number) => {
    output += chalk.bold.green(`${index + 1}. ${commit.commit.substring(0, 8)}\n`);
    output += chalk.yellow('Author: ') + commit.author.name + '\n';
    output += chalk.yellow('Date: ') + new Date(commit.author.time * 1000).toLocaleDateString() + '\n';
    output += chalk.yellow('Message: ') + commit.message.split('\n')[0] + '\n';
    output += chalk.blue(`🔗 https://chromium.googlesource.com/chromium/src/+/${commit.commit}\n\n`);
  });
  
  return output;
}

function formatGerritDiffTable(data: any): string {
  if (!data) return chalk.red('No diff data found');
  
  let output = chalk.bold.cyan(`CL ${data.clId}: ${data.subject}\n\n`);
  output += chalk.yellow('Patchset: ') + data.patchset + '\n';
  output += chalk.yellow('Author: ') + data.author + '\n\n';
  
  if (data.error) {
    output += chalk.red(data.error) + '\n\n';
    if (data.changedFiles && data.changedFiles.length > 0) {
      output += chalk.yellow('Changed files:\n');
      data.changedFiles.forEach((file: string) => {
        output += `- ${file}\n`;
      });
    }
    return output;
  }
  
  if (data.diffData) {
    // Format specific file diff
    output += chalk.bold.green('Diff Content:\n');
    output += formatDiffContent(data.diffData);
  } else {
    // Format file overview
    output += chalk.bold.green(`Files changed: ${data.changedFiles.length}\n\n`);
    
    const tableData = [
      ['File', 'Status', 'Lines']
    ];
    
    data.changedFiles.slice(0, 10).forEach((fileName: string) => {
      const fileInfo = data.filesData[fileName];
      const status = getFileStatusText(fileInfo?.status || 'M');
      const lines = `+${fileInfo?.lines_inserted || 0} -${fileInfo?.lines_deleted || 0}`;
      
      tableData.push([fileName, status, lines]);
    });
    
    output += table(tableData);
    
    if (data.changedFiles.length > 10) {
      output += chalk.gray(`\nShowing first 10 files. Total: ${data.changedFiles.length} files changed.\n`);
    }
  }
  
  return output;
}

function formatGerritDiffPlain(data: any): string {
  return formatGerritDiffTable(data); // Same formatting for now
}

function formatGerritFileTable(data: any): string {
  if (!data) return chalk.red('No file data found');
  
  let output = chalk.bold.cyan(`File: ${data.filePath}\n`);
  output += chalk.yellow('CL: ') + `${data.clId} - ${data.subject}\n`;
  output += chalk.yellow('Patchset: ') + data.patchset + '\n';
  output += chalk.yellow('Author: ') + data.author + '\n';
  output += chalk.yellow('Lines: ') + data.lines + '\n\n';
  
  output += chalk.bold.green('Content:\n');
  output += '─'.repeat(80) + '\n';
  
  // Add line numbers to content
  const lines = data.content.split('\n');
  lines.forEach((line: string, index: number) => {
    const lineNum = (index + 1).toString().padStart(4, ' ');
    output += chalk.gray(lineNum + ': ') + line + '\n';
  });
  
  output += '─'.repeat(80) + '\n';
  
  return output;
}

function formatGerritFilePlain(data: any): string {
  return formatGerritFileTable(data); // Same formatting for now
}

function formatDiffContent(diffData: any): string {
  let result = '';
  
  if (!diffData.content) {
    return chalk.gray('No diff content available.\n\n');
  }
  
  result += '```diff\n';
  
  for (const section of diffData.content) {
    if (section.ab) {
      // Unchanged lines (context)
      section.ab.forEach((line: string) => {
        result += ` ${line}\n`;
      });
    }
    
    if (section.a) {
      // Removed lines
      section.a.forEach((line: string) => {
        result += chalk.red(`-${line}\n`);
      });
    }
    
    if (section.b) {
      // Added lines
      section.b.forEach((line: string) => {
        result += chalk.green(`+${line}\n`);
      });
    }
  }
  
  result += '```\n\n';
  
  return result;
}

function getFileStatusText(status: string): string {
  switch (status) {
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case 'M': return 'Modified';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    default: return 'Modified';
  }
}

function formatIssueTable(data: any): string {
  if (!data) return chalk.red('No issue data found');
  
  if (data.error) {
    let output = chalk.red(`Error: ${data.error}\n`);
    output += chalk.blue(`🔗 View issue: ${data.browserUrl}\n`);
    return output;
  }
  
  let output = chalk.bold.cyan(`Issue ${data.issueId}: ${data.title || 'Unknown Title'}\n\n`);
  
  const infoData = [
    ['Property', 'Value'],
    ['Status', data.status || 'Unknown'],
    ['Priority', data.priority || 'Unknown'],
    ['Type', data.type || 'Unknown'],
    ['Severity', data.severity || 'Unknown'],
    ['Reporter', data.reporter || 'Unknown'],
    ['Assignee', data.assignee || 'Unassigned'],
    ['Created', data.created ? new Date(data.created).toLocaleDateString() : 'Unknown'],
    ['Modified', data.modified ? new Date(data.modified).toLocaleDateString() : 'Unknown']
  ];
  
  output += table(infoData) + '\n';
  
  if (data.description && data.description.length > 10) {
    output += chalk.bold.yellow('Description:\n');
    output += data.description + '\n\n';
  }
  
  if (data.relatedCLs && data.relatedCLs.length > 0) {
    output += chalk.bold.yellow('Related CLs:\n');
    data.relatedCLs.forEach((cl: string) => {
      output += `- CL ${cl}: https://chromium-review.googlesource.com/c/chromium/src/+/${cl}\n`;
    });
    output += '\n';
  }
  
  output += chalk.blue(`🔗 View issue: ${data.browserUrl}\n`);
  
  return output;
}

function formatIssuePlain(data: any): string {
  if (!data) return chalk.red('No issue data found');
  
  if (data.error) {
    let output = chalk.red(`Error: ${data.error}\n`);
    output += chalk.blue(`🔗 View issue: ${data.browserUrl}\n`);
    return output;
  }
  
  let output = chalk.bold.cyan(`Issue ${data.issueId}: ${data.title || 'Unknown Title'}\n`);
  output += chalk.gray('═'.repeat(80)) + '\n\n';
  
  // Issue metadata
  output += chalk.yellow('Status: ') + (data.status || 'Unknown') + '\n';
  output += chalk.yellow('Priority: ') + (data.priority || 'Unknown') + '\n';
  output += chalk.yellow('Type: ') + (data.type || 'Unknown') + '\n';
  output += chalk.yellow('Severity: ') + (data.severity || 'Unknown') + '\n';
  output += chalk.yellow('Reporter: ') + (data.reporter || 'Unknown') + '\n';
  output += chalk.yellow('Assignee: ') + (data.assignee || 'Unassigned') + '\n';
  output += chalk.yellow('Created: ') + (data.created ? new Date(data.created).toLocaleDateString() : 'Unknown') + '\n';
  output += chalk.yellow('Modified: ') + (data.modified ? new Date(data.modified).toLocaleDateString() : 'Unknown') + '\n';
  
  if (data.extractionMethod) {
    output += chalk.gray(`Data source: ${data.extractionMethod}`) + '\n';
  }
  
  output += '\n';
  
  // Issue description (first comment)
  if (data.description && data.description.length > 10) {
    output += chalk.bold.yellow('📝 Description:\n');
    output += chalk.gray('─'.repeat(40)) + '\n';
    output += formatCommentContent(data.description) + '\n\n';
  }
  
  // Comments
  if (data.comments && data.comments.length > 0) {
    output += chalk.bold.yellow(`💬 Comments (${data.comments.length}):\n`);
    output += chalk.gray('─'.repeat(40)) + '\n';
    
    data.comments.forEach((comment: any, index: number) => {
      output += chalk.bold.green(`Comment #${index + 1}\n`);
      output += chalk.blue(`👤 ${comment.author || 'Unknown'}`);
      
      if (comment.timestamp) {
        const date = new Date(comment.timestamp);
        output += chalk.gray(` • ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
      }
      
      output += '\n';
      output += formatCommentContent(comment.content) + '\n';
      
      if (index < data.comments.length - 1) {
        output += chalk.gray('┈'.repeat(30)) + '\n';
      }
    });
    
    output += '\n';
  }
  
  // Related CLs
  if (data.relatedCLs && data.relatedCLs.length > 0) {
    output += chalk.bold.yellow('🔗 Related CLs:\n');
    data.relatedCLs.forEach((cl: string) => {
      output += `  • CL ${cl}: https://chromium-review.googlesource.com/c/chromium/src/+/${cl}\n`;
    });
    output += '\n';
  }
  
  output += chalk.gray('═'.repeat(80)) + '\n';
  output += chalk.blue(`🌐 View issue: ${data.browserUrl}\n`);
  
  return output;
}

function formatCommentContent(content: string): string {
  if (!content) return chalk.gray('(no content)');
  
  // Split into paragraphs and format nicely
  const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
  
  return paragraphs.map(paragraph => {
    // Wrap long lines
    const words = paragraph.trim().split(/\s+/);
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 > 78) {
        if (currentLine) {
          lines.push(currentLine.trim());
          currentLine = word;
        } else {
          lines.push(word); // Word too long, keep as is
        }
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine.trim());
    }
    
    return lines.map(line => `  ${line}`).join('\n');
  }).join('\n\n');
}

function formatCommitMessage(message: string): string {
  if (!message) return chalk.gray('(no commit message)');
  
  // Split message into lines and format nicely
  const lines = message.split('\n').filter(line => line.trim().length > 0);
  
  return lines.map((line, index) => {
    // First line (subject) should be bold
    if (index === 0) {
      return `  ${chalk.bold(line.trim())}`;
    }
    
    // Subsequent lines with proper indentation
    const trimmedLine = line.trim();
    
    // Special formatting for common patterns
    if (trimmedLine.startsWith('Bug:')) {
      return `  ${chalk.yellow(trimmedLine)}`;
    } else if (trimmedLine.startsWith('Change-Id:')) {
      return `  ${chalk.blue(trimmedLine)}`;
    } else if (trimmedLine.startsWith('- https://crrev.com/')) {
      return `  ${chalk.cyan(trimmedLine)}`;
    } else if (trimmedLine.match(/^https?:\/\//)) {
      return `  ${chalk.cyan(trimmedLine)}`;
    } else {
      return `  ${trimmedLine}`;
    }
  }).join('\n');
}

function formatIssueSearchTable(data: any): string {
  if (!data || !data.issues || data.issues.length === 0) {
    return chalk.yellow('No issues found');
  }
  
  let output = chalk.bold.cyan(`Found ${data.total} issues for query: "${data.query}"\n\n`);
  
  const tableData = [
    ['ID', 'Title', 'Status', 'Priority', 'Reporter', 'Modified']
  ];
  
  data.issues.forEach((issue: any) => {
    tableData.push([
      issue.issueId,
      (issue.title || 'No title').substring(0, 40) + '...',
      issue.status || 'Unknown',
      issue.priority || 'Unknown',
      issue.reporter || 'Unknown',
      issue.modified ? new Date(issue.modified).toLocaleDateString() : 'Unknown'
    ]);
  });
  
  output += table(tableData, {
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼'
    }
  });
  
  if (data.searchUrl) {
    output += '\n' + chalk.blue(`🔗 Web search: ${data.searchUrl}\n`);
  }
  
  return output;
}

function formatIssueSearchPlain(data: any): string {
  if (!data || !data.issues || data.issues.length === 0) {
    return chalk.yellow('No issues found');
  }
  
  let output = chalk.bold.cyan(`Found ${data.total} issues for query: "${data.query}"\n\n`);
  
  data.issues.forEach((issue: any, index: number) => {
    output += chalk.bold.green(`${index + 1}. Issue ${issue.issueId}\n`);
    output += chalk.yellow('Title: ') + (issue.title || 'No title') + '\n';
    output += chalk.yellow('Status: ') + (issue.status || 'Unknown') + '\n';
    output += chalk.yellow('Priority: ') + (issue.priority || 'Unknown') + '\n';
    output += chalk.yellow('Reporter: ') + (issue.reporter || 'Unknown') + '\n';
    output += chalk.yellow('Modified: ') + (issue.modified ? new Date(issue.modified).toLocaleDateString() : 'Unknown') + '\n';
    output += chalk.blue(`🔗 ${issue.browserUrl}\n`);
    
    if (index < data.issues.length - 1) {
      output += chalk.gray('─'.repeat(60)) + '\n';
    }
  });
  
  output += '\n';
  
  if (data.searchUrl) {
    output += chalk.blue(`🌐 Web search: ${data.searchUrl}\n`);
  }
  
  return output;
}

function formatGerritBotsTable(data: any): string {
  if (data.message) {
    return data.message;
  }

  const rows = data.bots.map((bot: any) => [
    bot.name,
    getStatusIcon(bot.status) + ' ' + bot.status,
    bot.summary || '',
    bot.buildUrl || bot.luciUrl || '',
  ]);

  return table([
    ['Bot Name', 'Status', 'Summary', 'URL'],
    ...rows
  ], {
    border: {
      topBody: '─',
      topJoin: '┬',
      topLeft: '┌',
      topRight: '┐',
      bottomBody: '─',
      bottomJoin: '┴',
      bottomLeft: '└',
      bottomRight: '┘',
      bodyLeft: '│',
      bodyRight: '│',
      bodyJoin: '│',
      joinBody: '─',
      joinLeft: '├',
      joinRight: '┤',
      joinJoin: '┼'
    },
    header: {
      alignment: 'center',
      content: `Try-Bot Status for CL ${data.clId} (Patchset ${data.patchset})\n` +
               `📊 Total: ${data.totalBots} | ✅ Passed: ${data.passedBots} | ❌ Failed: ${data.failedBots} | 🔄 Running: ${data.runningBots}`
    }
  });
}

function formatGerritBotsPlain(data: any): string {
  if (data.message) {
    return data.message;
  }

  let output = chalk.bold(`Try-Bot Status for CL ${data.clId}\n`);
  output += chalk.gray('─'.repeat(50)) + '\n';
  output += chalk.cyan(`Patchset: ${data.patchset}\n`);
  output += chalk.cyan(`LUCI Run: ${data.runId || 'N/A'}\n\n`);
  
  output += chalk.bold('📊 Summary:\n');
  output += `  Total: ${data.totalBots}\n`;
  output += `  ✅ Passed: ${data.passedBots}\n`;
  output += `  ❌ Failed: ${data.failedBots}\n`;
  output += `  🔄 Running: ${data.runningBots}\n`;
  if (data.canceledBots > 0) {
    output += `  ⏹️  Canceled: ${data.canceledBots}\n`;
  }
  output += '\n';

  if (data.bots.length === 0) {
    output += chalk.yellow('No bot results to display\n');
    return output;
  }

  output += chalk.bold('🤖 Bots:\n');
  data.bots.forEach((bot: any, index: number) => {
    const statusIcon = getStatusIcon(bot.status);
    output += `${statusIcon} ${chalk.bold(bot.name)} - ${bot.status}\n`;
    
    if (bot.summary) {
      output += chalk.gray(`   ${bot.summary}\n`);
    }
    
    if (bot.failureStep) {
      output += chalk.red(`   Failed step: ${bot.failureStep}\n`);
    }
    
    if (bot.buildUrl) {
      output += chalk.blue(`   🔗 Build: ${bot.buildUrl}\n`);
    } else if (bot.luciUrl) {
      output += chalk.blue(`   🔗 LUCI: ${bot.luciUrl}\n`);
    }
    
    if (index < data.bots.length - 1) {
      output += '\n';
    }
  });
  
  if (data.luciUrl) {
    output += '\n' + chalk.blue(`🌐 Full LUCI report: ${data.luciUrl}\n`);
  }
  
  return output;
}

function getStatusIcon(status: string): string {
  switch (status.toUpperCase()) {
    case 'PASSED': return '✅';
    case 'FAILED': return '❌';
    case 'RUNNING': return '🔄';
    case 'CANCELED': return '⏹️';
    case 'UNKNOWN': return '❓';
    default: return '⚪';
  }
}