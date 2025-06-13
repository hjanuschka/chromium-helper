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

#### Code Search Tools (works for both Chromium and PDFium)
1. `search_chromium_code` - Search for code patterns in Chromium/PDFium
2. `find_chromium_symbol` - Find symbol definitions and usage
3. `get_chromium_file` - Get specific file contents

#### Chromium-specific Tools
4. `get_gerrit_cl_status` - Check Chromium Gerrit CL status and test results
5. `get_gerrit_cl_comments` - View Chromium review comments
6. `get_gerrit_cl_diff` - See code changes in Chromium CLs
7. `get_gerrit_patchset_file` - Get file content from Chromium patchsets
8. `find_chromium_owners_file` - Find code reviewers/owners
9. `search_chromium_commits` - Search Chromium commit history
10. `get_chromium_issue` - Get Chromium bug/issue details

#### PDFium-specific Tools
11. `get_pdfium_gerrit_cl_status` - Check PDFium Gerrit CL status and test results
12. `get_pdfium_gerrit_cl_comments` - View PDFium review comments
13. `get_pdfium_gerrit_cl_diff` - See code changes in PDFium CLs
14. `get_pdfium_gerrit_patchset_file` - Get file content from PDFium patchsets

### Usage

After configuration, you can use commands like:

#### Chromium Examples:
- "Search for LOG(INFO) usage in Chromium"
- "Find Browser::Create symbol definitions"
- "Get the content of chrome/browser/ui/browser.h"
- "Check status of Gerrit CL 6624568"
- "Find owners for chrome/browser/ui/browser.cc"

#### PDFium Examples:
- "Search for CPDF_Parser in PDFium code"
- "Find FPDF_LoadDocument symbol usage"
- "Get the content of core/fpdfapi/parser/cpdf_parser.cpp"
- "Check status of PDFium Gerrit CL 12345"
- "Get diff for PDFium CL https://pdfium-review.googlesource.com/c/pdfium/+/12345"