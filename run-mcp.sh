#!/bin/bash

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use Node.js 20 (silently)
nvm use 20 >/dev/null 2>&1

# Run the MCP server
node "/Users/hjanuschka/chromium-codesearch-mcp/dist/index.js"