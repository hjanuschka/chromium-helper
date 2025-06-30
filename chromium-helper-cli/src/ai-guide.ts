export function getAIUsageGuide(): string {
  return `# Chromium Helper CLI - AI Usage Guide

A comprehensive CLI tool for searching and exploring the Chromium source code. All commands support --debug flag for detailed logging and --format for output control.

## Global Options
--format <type>     Output format: json, table, plain (default: plain)
--debug            Enable debug logging
--no-color         Disable colored output
--ai               Show this AI usage guide

## Commands Overview

### 1. search - Search Chromium source code
Usage: chromium-helper search <query> [options]
Aliases: s

Options:
  -c, --case-sensitive              Case sensitive search
  -l, --language <lang>             Filter by language (cpp, javascript, python, etc.)
  -p, --file-pattern <pattern>      File pattern (*.cc, *.h, chrome/browser/*, etc.)
  -t, --type <type>                 Search type: content|function|class|symbol|comment
  --exclude-comments                Exclude comments from results
  --limit <number>                  Max results (default: 20)

Examples:
  chromium-helper search "LOG(INFO)" --format json --limit 5
  chromium-helper search "WebContents" --type class --file-pattern "*.h"
  chromium-helper search "memory leak" --language cpp --exclude-comments

JSON Output Format:
[
  {
    "file": "path/to/file.cc",
    "line": 123,
    "content": "matched code context",
    "url": "https://source.chromium.org/chromium/chromium/src/+/main:path/to/file.cc;l=123"
  }
]

### 2. symbol - Find symbol definitions and usage
Usage: chromium-helper symbol <symbol> [options]
Aliases: sym

Options:
  -f, --file <path>                 File context for symbol resolution

Examples:
  chromium-helper symbol "Browser" --format json
  chromium-helper symbol "CreateWindow" --file "chrome/browser/ui/browser.cc"

JSON Output Format:
{
  "symbol": "Browser",
  "symbolResults": [SearchResult[]],
  "classResults": [SearchResult[]],
  "functionResults": [SearchResult[]],
  "usageResults": [SearchResult[]],
  "estimatedUsageCount": 1250
}

### 3. file - Get file content from Chromium source
Usage: chromium-helper file <path> [options]
Aliases: f

Options:
  -s, --start <line>                Starting line number
  -e, --end <line>                  Ending line number

Examples:
  chromium-helper file "base/logging.h" --format json
  chromium-helper file "chrome/browser/ui/browser.h" --start 100 --end 200

JSON Output Format:
{
  "filePath": "base/logging.h",
  "content": "1  // Copyright text\\n2  #ifndef BASE_LOGGING_H_\\n...",
  "totalLines": 456,
  "displayedLines": 356,
  "lineStart": 100,
  "lineEnd": 200,
  "browserUrl": "https://source.chromium.org/chromium/chromium/src/+/main:base/logging.h;l=100-200"
}

### 4. owners - Find OWNERS files for a file path
Usage: chromium-helper owners <path>
Aliases: own

Examples:
  chromium-helper owners "chrome/browser/ui/browser.cc" --format json

JSON Output Format:
{
  "filePath": "chrome/browser/ui/browser.cc",
  "ownerFiles": [
    {
      "path": "chrome/browser/ui/OWNERS",
      "content": "# OWNERS file content\\nuser@chromium.org\\n...",
      "browserUrl": "https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/ui/OWNERS"
    }
  ]
}

### 5. commits - Search commit history
Usage: chromium-helper commits <query> [options]
Aliases: cm

Options:
  -a, --author <author>             Filter by author
  --since <date>                    Commits after date (YYYY-MM-DD)
  --until <date>                    Commits before date (YYYY-MM-DD)
  --limit <number>                  Max results (default: 20)

Examples:
  chromium-helper commits "password manager" --format json --limit 10
  chromium-helper commits "security fix" --author "chrome-security"
  chromium-helper commits "memory leak" --since "2023-01-01" --until "2023-12-31"

JSON Output Format:
{
  "log": [
    {
      "commit": "abc123def456...",
      "author": {
        "name": "Developer Name",
        "email": "dev@chromium.org",
        "time": 1703980800
      },
      "message": "Fix memory leak in browser startup\\n\\nDetailed description..."
    }
  ]
}

### 6. gerrit - Gerrit code review operations
Usage: chromium-helper gerrit <command> [options]
Aliases: gr

Subcommands:
  status <cl>                       Get CL status and test results
  comments <cl> [options]           Get CL review comments
  diff <cl> [options]              Get CL diff/changes
  file <cl> <path> [options]       Get file content from CL patchset

Options for comments:
  -p, --patchset <number>          Specific patchset number
  --no-resolved                    Exclude resolved comments

Options for diff:
  -p, --patchset <number>          Specific patchset number
  -f, --file <path>               Specific file path to get diff for

Examples:
  chromium-helper gerrit status 6624568 --format json
  chromium-helper gerrit comments 6624568 --format json
  chromium-helper gerrit diff 6624568 --file "base/logging.cc"
  chromium-helper gerrit file 6624568 "base/logging.cc" --patchset 3

### 7. pdfium - PDFium Gerrit operations
Usage: chromium-helper pdfium <command> [options]
Aliases: pdf

Subcommands:
  status <cl>                      Get PDFium CL status and test results
  comments <cl> [options]          Get PDFium CL review comments
  diff <cl> [options]              Get PDFium CL diff/changes
  file <cl> <path> [options]       Get file content from PDFium CL patchset

Options for comments:
  -p, --patchset <number>          Specific patchset number
  --no-resolved                    Exclude resolved comments

Options for diff:
  -p, --patchset <number>          Specific patchset number
  -f, --file <path>               Specific file path to get diff for

Examples:
  chromium-helper pdfium status 130850
  chromium-helper pdfium comments 130850 --format json
  chromium-helper pdfium diff 130850 --file "fpdfsdk/fpdf_view.cpp"
  chromium-helper pdfium file 130850 "fpdfsdk/fpdf_view.cpp" --patchset 9

### 8. issues - Chromium issue operations
Usage: chromium-helper issues <command> [options]
Aliases: bugs

Subcommands:
  get <id>                          Get specific issue details
  search <query> [options]          Search for issues

Options for search:
  --limit <number>                  Max results (default: 50)
  --start <number>                  Starting index for pagination (default: 0)

Examples:
  chromium-helper issues get 422768753 --format json
  chromium-helper issues search "memory leak" --format json --limit 10
  chromium-helper issues search "webrtc" --start 50 --limit 25

JSON Output Format for get:
{
  "issueId": "422768753",
  "browserUrl": "https://issues.chromium.org/issues/422768753",
  "title": "FakeDesktopMediaPickerFactory footgun",
  "status": "ASSIGNED",
  "priority": "P4",
  "type": "Bug",
  "severity": "S3",
  "reporter": "reporter@chromium.org",
  "assignee": "assignee@chromium.org",
  "created": "2023-12-30T10:00:00.000Z",
  "modified": "2024-01-15T14:30:00.000Z",
  "description": "Issue description text...",
  "comments": [
    {
      "author": "commenter@chromium.org",
      "timestamp": "2023-12-30T11:00:00.000Z",
      "content": "Comment text here..."
    }
  ],
  "relatedCLs": ["6624568", "6678901"],
  "extractionMethod": "direct-api"
}

JSON Output Format for search:
{
  "query": "memory leak",
  "total": 15,
  "issues": [
    {
      "issueId": "422768753",
      "title": "Memory leak in WebRTC",
      "status": "ASSIGNED",
      "priority": "P2",
      "reporter": "reporter@chromium.org",
      "assignee": "assignee@chromium.org",
      "created": "2023-12-30T10:00:00.000Z",
      "modified": "2024-01-15T14:30:00.000Z",
      "browserUrl": "https://issues.chromium.org/issues/422768753"
    }
  ],
  "searchUrl": "https://issues.chromium.org/issues?q=memory%20leak"
}

### 8. issue - Get Chromium issue details (Legacy)
Usage: chromium-helper issue <id>
Aliases: bug

Note: This is a legacy command. Use 'chromium-helper issues get <id>' instead.

## AI Usage Patterns

### Code Analysis Workflow
1. Search for relevant code: \`chromium-helper search "feature name" --format json\`
2. Examine specific files: \`chromium-helper file "path/to/file.cc" --format json\`
3. Find symbol definitions: \`chromium-helper symbol "ClassName" --format json\`
4. Check ownership: \`chromium-helper owners "path/to/file.cc" --format json\`

### Bug Investigation Workflow
1. Search for related issues: \`chromium-helper issues search "memory leak" --format json\`
2. Get specific issue details: \`chromium-helper issues get 12345 --format json\`
3. Review related CLs: \`chromium-helper gerrit status 6624568 --format json\`
4. Search for similar code patterns: \`chromium-helper search "error message" --format json\`
5. Check commit history: \`chromium-helper commits "bug keyword" --format json\`

### Shell Integration Examples
\`\`\`bash
# Find all TODOs in browser code
chromium-helper search "TODO" --type comment --file-pattern "chrome/browser/*" --format json | jq '.[] | .file'

# Get security-related symbols
chromium-helper search "crypto" --language cpp --format json | jq '.[] | select(.file | contains("security"))'

# Find all Browser class usage
chromium-helper symbol "Browser" --format json | jq '.usageResults[].url'

# Search for high priority memory issues
chromium-helper issues search "memory" --format json | jq '.issues[] | select(.priority == "P1" or .priority == "P2")'

# Get all issue URLs for a specific search
chromium-helper issues search "webrtc" --format json | jq '.issues[].browserUrl'
\`\`\`

### Error Handling
All commands return non-zero exit codes on failure. JSON output always includes error information when available.

### Performance Notes
- Use --limit to control result count for faster responses
- File pattern filters improve search performance
- JSON format is fastest for programmatic processing
- Debug mode (--debug) provides detailed API timing information

### Output Formats
- **json**: Structured data, best for AI/programmatic use
- **table**: Tabular format, good for comparison
- **plain**: Human-readable with colors, best for terminal use

All JSON outputs are valid, parseable JSON. Empty results return empty arrays [] or objects {}.
`;
}