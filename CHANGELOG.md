# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-10

### Added
- **Initial release** of Chromium CodeSearch MCP server
- **Code Search Tool** (`search_chromium_code`) with Google's official Code Search syntax
  - Support for `class:`, `function:`, `symbol:`, `lang:`, `file:`, `content:`, `comment:`, `usage:` operators
  - Case sensitivity toggle
  - Language and file pattern filtering
  - Search type specification (content, function, class, symbol, comment)
  - Comment exclusion option
- **Symbol Lookup Tool** (`find_chromium_symbol`) with comprehensive symbol analysis
  - Symbol definitions discovery
  - Class definitions search
  - Function definitions search
  - Usage examples (excluding comments)
  - Multiple search strategies for thorough coverage
- **File Content Tool** (`get_chromium_file`) for direct file access
  - Line range support
  - Direct links to source.chromium.org
- **OWNERS File Discovery** (`find_chromium_owners_file`)
  - Automatic OWNERS file hierarchy discovery
  - Real OWNERS file content fetching and parsing
  - Email extraction and ownership rules parsing
  - File reference resolution (`file://` directives)
  - Support for special directives (`set noparent`, `include`, etc.)
- **Gerrit Integration** with 4 tools:
  - `get_gerrit_cl_status` - CL status and test results with LUCI integration
  - `get_gerrit_cl_comments` - Review comments with code context
  - `get_gerrit_cl_diff` - Code changes and diffs
  - `get_gerrit_patchset_file` - File content from specific patchsets
- **Enterprise-grade Features**:
  - Custom error types (`ChromiumSearchError`, `GerritAPIError`)
  - Structured JSON logging to stderr
  - Dynamic version loading from package.json
  - Graceful shutdown handling (SIGINT/SIGTERM)
  - Request caching for Gerrit API calls
  - Execution time tracking and reporting
- **Comprehensive Documentation**:
  - Detailed README with all tool descriptions
  - 80+ sample usage examples in collapsible sections
  - Code Search syntax reference
  - Installation and configuration guide
  - API key configuration instructions

### Features
- **Real-time Search**: Uses live Chromium repository data via Google's CodeSearch API
- **Advanced Syntax**: Full support for Google's Code Search operators and filters
- **Multi-format Results**: Rich markdown formatting with syntax highlighting
- **Direct Integration**: Works seamlessly with Claude Desktop and other MCP clients
- **Performance Optimized**: Intelligent caching and request batching
- **Error Resilient**: Comprehensive error handling with user-friendly messages

### Technical Details
- **TypeScript**: Fully typed implementation with ES modules
- **MCP SDK**: Built on official Model Context Protocol SDK v0.6.0
- **API Integration**: Direct integration with Google's CodeSearch and Gerrit APIs
- **Node.js**: Requires Node.js 18+ with modern ES features
- **Zero Dependencies**: Minimal external dependencies for security and reliability