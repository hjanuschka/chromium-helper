# Chromium Helper CLI

A powerful command-line tool for searching and exploring the Chromium source code using Google's official CodeSearch APIs. Built for developers, AI systems, and shell scripts that need fast, programmatic access to Chromium codebase information.

## 🚀 Features

- **🔍 Fast Code Search**: Search the live Chromium codebase using Google's official search API
- **🎯 Symbol Lookup**: Find definitions, declarations, and usage examples for functions, classes, and symbols
- **📄 File Content**: Fetch any file from Chromium source with optional line ranges
- **⚡ Multiple Output Formats**: Plain text, JSON, and table formats for different use cases
- **🔧 Shell-Friendly**: Perfect for integration with AI systems, shell scripts, and automation
- **🌐 Direct Links**: Every result includes clickable URLs to view code in source.chromium.org
- **⚙️ Configurable**: Support for custom API keys and output preferences

## 📦 Installation

### Option 1: Install from npm (Recommended)
```bash
npm install -g chromium-helper
npx playwright install chromium  # Required for issue extraction
```

### Option 2: From Source
```bash
git clone https://github.com/hjanuschka/chromium-helper-cli.git
cd chromium-helper-cli
npm install
npx playwright install chromium  # Required for issue extraction
npm run build
npm link  # Optional: Make globally available
```

## 🎯 Quick Start

```bash
# Basic code search
chromium-helper search "LOG(INFO)" --limit 5

# Find symbol definitions and usage
chromium-helper symbol "Browser"

# Get file content with line range
chromium-helper file "base/logging.h" --start 100 --end 150

# Search with specific filters
chromium-helper search "WebContents" --language cpp --file-pattern "*.h"

# Get results in JSON format
chromium-helper search "memory leak" --format json

# Show results in table format
chromium-helper search "virtual destructor" --format table --limit 10
```

## 📖 Commands

### `search` - Search Chromium Source Code
Search for code patterns in the Chromium codebase.

```bash
chromium-helper search <query> [options]

# Aliases: s

Options:
  -c, --case-sensitive          Case sensitive search
  -l, --language <lang>         Filter by programming language (cpp, javascript, python, etc.)
  -p, --file-pattern <pattern>  File pattern filter (*.cc, *.h, chrome/browser/*, etc.)
  -t, --type <type>             Search type: content|function|class|symbol|comment
  --exclude-comments            Exclude comments from search results
  --limit <number>              Maximum number of results (default: 20)
```

**Examples:**
```bash
# Basic text search
chromium-helper search "LOG(INFO)"

# Function search
chromium-helper search "CreateWindow" --type function

# Class search in C++ headers
chromium-helper search "Browser" --type class --file-pattern "*.h"

# Search excluding comments
chromium-helper search "TODO" --exclude-comments

# Language-specific search
chromium-helper search "addEventListener" --language javascript
```

### `symbol` - Find Symbol Definitions and Usage
Find where symbols (functions, classes, variables) are defined and used.

```bash
chromium-helper symbol <symbol> [options]

# Aliases: sym

Options:
  -f, --file <path>  File path context for symbol resolution
```

**Examples:**
```bash
# Find Browser symbol
chromium-helper symbol "Browser"

# Find with file context
chromium-helper symbol "CreateWindow" --file "chrome/browser/ui/browser.cc"
```

### `file` - Get File Content
Fetch the content of any file from Chromium source.

```bash
chromium-helper file <path> [options]

# Aliases: f

Options:
  -s, --start <line>  Starting line number
  -e, --end <line>    Ending line number
```

**Examples:**
```bash
# Get entire file
chromium-helper file "base/logging.h"

# Get specific line range
chromium-helper file "chrome/browser/ui/browser.h" --start 100 --end 200

# Get from line 50 to end
chromium-helper file "content/browser/browser_context.h" --start 50
```

### `owners` - Find OWNERS Files
Find OWNERS files for a given file path to identify code reviewers.

```bash
chromium-helper owners <path>

# Aliases: own
```

**Examples:**
```bash
# Find owners for a specific file
chromium-helper owners "chrome/browser/ui/browser.cc"

# Find owners for a directory
chromium-helper owners "third_party/blink/renderer/"
```

### `commits` - Search Commit History
Search commit messages and metadata in the Chromium repository.

```bash
chromium-helper commits <query> [options]

# Aliases: cm

Options:
  -a, --author <author>    Filter by author name or email
  --since <date>           Commits after date (YYYY-MM-DD)
  --until <date>           Commits before date (YYYY-MM-DD)
  --limit <number>         Maximum number of results (default: 20)
```

**Examples:**
```bash
# Search commit messages
chromium-helper commits "password manager"

# Search by author
chromium-helper commits "security fix" --author "chrome-security"

# Search in date range
chromium-helper commits "memory leak" --since "2023-01-01" --until "2023-12-31"
```

### `gerrit` - Gerrit Code Review Operations
Work with Chromium Gerrit code reviews.

```bash
chromium-helper gerrit <command> [options]

# Aliases: gr

Commands:
  status <cl>                Get CL status and test results
  comments <cl> [options]    Get CL review comments
```

**Examples:**
```bash
# Get CL status
chromium-helper gerrit status 6624568

# Get review comments
chromium-helper gerrit comments 6624568
```

### `issue` - Get Chromium Issue Details
Get information about Chromium bugs and feature requests.

```bash
chromium-helper issue <id>

# Aliases: bug
```

**Examples:**
```bash
# Get issue details
chromium-helper issue 422768753

# Using full URL
chromium-helper issue "https://issues.chromium.org/issues/422768753"
```

## 🎨 Output Formats

Control output format with the global `--format` option:

### Plain Text (Default)
```bash
chromium-helper search "LOG(INFO)" --format plain
```
Human-readable format with colors and formatting.

### JSON
```bash
chromium-helper search "LOG(INFO)" --format json
```
Structured JSON for programmatic processing and AI systems.

### Table
```bash
chromium-helper search "LOG(INFO)" --format table
```
Tabular format for easy reading and comparison.

## ⚙️ Configuration

### Environment Variables
```bash
# Set custom API key
export CHROMIUM_SEARCH_API_KEY=your_api_key_here

# Disable colors
export NO_COLOR=1
```

### Config File
Create `~/.chromium-helper.json` or `.chromium-helper.json` in your project:

```json
{
  "apiKey": "your_api_key_here",
  "outputFormat": "json",
  "defaultLimit": 50
}
```

### Configuration Commands
```bash
# Show current configuration
chromium-helper config --show

# Set API key (future feature)
chromium-helper config --set-api-key "your_key"
```

## 🤖 AI and Shell Script Integration

Perfect for AI systems and shell scripts:

```bash
#!/bin/bash

# Search for security-related code
RESULTS=$(chromium-helper search "crypto" --language cpp --format json --limit 10)

# Process results with jq
echo "$RESULTS" | jq '.[] | select(.file | contains("security")) | .url'

# Find all Browser class definitions
chromium-helper symbol "Browser" --format json | jq '.classResults[].url'

# Get file content for analysis
chromium-helper file "base/security/security_context.h" --format json | \
  jq -r '.content' | head -20
```

## 📋 Use Cases

### For Developers
- **Code Discovery**: Find examples of how to use specific APIs
- **Architecture Understanding**: Explore class hierarchies and dependencies
- **Code Review**: Understand context around changes
- **Bug Investigation**: Search for related code patterns

### For AI Systems
- **Code Analysis**: Extract structured information about Chromium codebase
- **Documentation Generation**: Gather examples and usage patterns
- **Refactoring Assistance**: Find all usages of symbols before changes
- **Learning**: Understand large codebase patterns and conventions

### For Automation
- **CI/CD Integration**: Validate code patterns and standards
- **Monitoring**: Track usage of deprecated APIs
- **Documentation**: Generate up-to-date code examples
- **Security Audits**: Search for security-sensitive code patterns

## 🔍 Advanced Search Techniques

### Code Search Syntax
The tool supports Google CodeSearch syntax:

```bash
# Search specific function definitions
chromium-helper search "function:CreateWindow"

# Search class definitions
chromium-helper search "class:Browser"

# Search symbols (excludes comments/strings)
chromium-helper search "symbol:WebContents"

# Case-sensitive search
chromium-helper search "case:yes LOG"

# Language and file filters
chromium-helper search "lang:cpp file:*.h virtual"
```

### Complex Queries
```bash
# Find all virtual destructors in headers
chromium-helper search "virtual ~" --file-pattern "*.h" --language cpp

# Search for TODO comments in browser code
chromium-helper search "TODO" --type comment --file-pattern "chrome/browser/*"

# Find memory management patterns
chromium-helper search "std::unique_ptr" --language cpp --exclude-comments
```

## 🚀 Performance Tips

- Use `--limit` to control result count for faster responses
- Use `--file-pattern` to narrow search scope
- Use `--language` to filter by programming language
- Use `--format json` for faster parsing in scripts
- Cache results in shell scripts to avoid repeated API calls

## 🛠️ Development

```bash
# Clone and setup
git clone https://github.com/hjanuschka/chromium-helper-cli.git
cd chromium-helper-cli
npm install

# Development with watch mode
npm run dev

# Build
npm run build

# Test locally
node dist/index.js --help
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes and add tests
4. Commit: `git commit -am 'Add new feature'`
5. Push: `git push origin feature/new-feature`
6. Create a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Related

- [Chromium Code Search](https://source.chromium.org) - Official web interface
- [Chromium Development](https://www.chromium.org/developers/) - Developer documentation
- [Gerrit Code Review](https://chromium-review.googlesource.com/) - Code review system

## 📞 Support

- [GitHub Issues](https://github.com/hjanuschka/chromium-helper-cli/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/hjanuschka/chromium-helper-cli/discussions) - Questions and community

---

**Made with ❤️ for the Chromium developer community**