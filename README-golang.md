# Chromium Helper - Go Implementation

This is a complete Go implementation of the Chromium Helper tools, including both the MCP server and CLI.

## Features

- 🚀 **100% Go** - No TypeScript/JavaScript dependencies
- 🔍 **Full feature parity** with the TypeScript version
- 📦 **Single binary distribution** - Easy deployment
- 🎯 **Better performance** - Compiled language benefits
- 🛠️ **Same API** - Drop-in replacement for the TypeScript version

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/hjanuschka/chromium-helper.git
cd chromium-helper
git checkout golang

# Build the MCP server
go build -o chromium-mcp-server ./cmd/mcp-server

# Build the CLI
go build -o chromium-helper ./cmd/chromium-helper
```

### Pre-built Binaries

Coming soon - check the releases page.

## Usage

### MCP Server

The MCP server is compatible with Claude Desktop and other MCP clients:

```bash
# Run the MCP server
./chromium-mcp-server
```

Configure in Claude Desktop's `claude_config.json`:

```json
{
  "mcpServers": {
    "chromium-codesearch": {
      "command": "/path/to/chromium-mcp-server"
    }
  }
}
```

### CLI Tool

The CLI provides the same commands as the TypeScript version:

```bash
# Search for code
./chromium-helper search "LOG(INFO)" --limit=10

# Get file contents
./chromium-helper file base/logging.h

# List folder contents
./chromium-helper ls content/browser/

# Find symbol
./chromium-helper symbol Browser::Create

# Get file from V8 submodule
./chromium-helper file v8/src/api/api.cc

# Show AI guide
./chromium-helper ai
```

## Architecture

### Project Structure

```
.
├── cmd/
│   ├── mcp-server/         # MCP server entry point
│   └── chromium-helper/    # CLI entry point
├── internal/
│   ├── api/                # Chromium API client
│   ├── cli/                # CLI commands
│   └── formatter/          # Output formatters
└── go.mod                  # Go module definition
```

### Key Components

1. **MCP Server** (`cmd/mcp-server/main.go`)
   - Implements the Model Context Protocol
   - Provides tools for searching, browsing, and analyzing Chromium code
   - Supports stdio and HTTP transports

2. **CLI Tool** (`cmd/chromium-helper/main.go`)
   - Command-line interface using Cobra
   - Supports multiple output formats (table, plain, JSON)
   - Full feature parity with TypeScript version

3. **API Client** (`internal/api/client.go`)
   - Handles communication with Chromium CodeSearch APIs
   - Manages submodule routing (V8, WebRTC, DevTools)
   - Implements caching and error handling

## Supported Features

- ✅ Code search with advanced syntax
- ✅ Symbol lookup (definitions and references)
- ✅ File retrieval with line ranges
- ✅ Directory listing
- ✅ Git submodule support (V8, WebRTC, DevTools)
- ✅ Multiple output formats
- ✅ AI assistant integration guide
- 🚧 Gerrit CL support (in progress)
- 🚧 Issue tracking (in progress)
- 🚧 Commit history search (in progress)
- 🚧 OWNERS file lookup (in progress)

## Performance

The Go implementation offers several performance advantages:

- **Faster startup** - No Node.js/V8 initialization
- **Lower memory usage** - Efficient memory management
- **Better concurrency** - Goroutines for parallel operations
- **Single binary** - No dependency resolution at runtime

## Development

### Requirements

- Go 1.22 or later
- Git

### Building

```bash
# Download dependencies
go mod download

# Run tests
go test ./...

# Build everything
go build ./...

# Format code
go fmt ./...

# Run linter
golangci-lint run
```

### Adding New Features

1. Add new tool to MCP server in `cmd/mcp-server/main.go`
2. Add corresponding CLI command in `internal/cli/`
3. Implement API client methods in `internal/api/client.go`
4. Add formatters in `internal/formatter/formatter.go`

## Migration from TypeScript

The Go implementation is designed as a drop-in replacement:

1. **MCP Server**: Update the command path in Claude Desktop config
2. **CLI**: Replace `npx chromium-helper` with `./chromium-helper`
3. **API**: All tools and commands work identically

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Based on the original TypeScript implementation
- Uses the official [Go MCP SDK](https://github.com/modelcontextprotocol/go-sdk)
- Inspired by the Chromium project's excellent tooling