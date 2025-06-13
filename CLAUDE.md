# Claude Code Configuration

## MCP Servers

This project includes a Chromium CodeSearch MCP server that provides access to the Chromium source code repository.

### Chromium CodeSearch MCP Server

- **Command**: `chromium-codesearch-mcp`
- **Description**: Search and explore the Chromium codebase using Google's official CodeSearch API
- **Features**:
  - Real-time code search across the entire Chromium repository
  - Symbol lookup and definition finding
  - File content retrieval with line number support
  - Gerrit CL status, comments, and diff viewing
  - Commit history search
  - Issue tracking integration
  - OWNERS file discovery

### Available Tools

1. `search_chromium_code` - Search for code patterns in Chromium
2. `find_chromium_symbol` - Find symbol definitions and usage
3. `get_chromium_file` - Get specific file contents
4. `get_gerrit_cl_status` - Check Gerrit CL status and test results
5. `get_gerrit_cl_comments` - View review comments
6. `get_gerrit_cl_diff` - See code changes in CLs
7. `get_gerrit_patchset_file` - Get file content from patchsets
8. `find_chromium_owners_file` - Find code reviewers/owners
9. `search_chromium_commits` - Search commit history
10. `get_chromium_issue` - Get bug/issue details

### Usage

After configuration, you can use commands like:
- "Search for LOG(INFO) usage in Chromium"
- "Find Browser::Create symbol definitions"
- "Get the content of chrome/browser/ui/browser.h"
- "Check status of Gerrit CL 6624568"
- "Find owners for chrome/browser/ui/browser.cc"