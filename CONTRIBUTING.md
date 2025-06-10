# Contributing to Chromium CodeSearch MCP

Thank you for your interest in contributing! This document provides guidelines for contributing to the Chromium CodeSearch MCP server.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/yourusername/chromium-codesearch-mcp.git
   cd chromium-codesearch-mcp
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the project**:
   ```bash
   npm run build
   ```

## Development Workflow

### Running in Development Mode
```bash
npm run dev  # Watch mode - rebuilds on changes
```

### Testing Your Changes
```bash
npm test    # Run basic MCP server tests
npm start   # Start the server manually
```

### Code Style
- Use TypeScript for all new code
- Follow existing code formatting and style
- Add type annotations where helpful
- Use meaningful variable and function names

## Making Changes

### Areas for Contribution

1. **Search Functionality**
   - Enhance search query parsing
   - Add new search operators
   - Improve result formatting

2. **Gerrit Integration**
   - Add more Gerrit API endpoints
   - Improve CL analysis features
   - Enhance diff visualization

3. **OWNERS File Parsing**
   - Better OWNERS file format support
   - Enhanced ownership resolution
   - Performance improvements

4. **Documentation**
   - Add more usage examples
   - Improve API documentation
   - Create video tutorials

5. **Testing**
   - Add unit tests
   - Integration tests
   - Performance tests

### Submitting Changes

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and test thoroughly

3. **Commit with clear messages**:
   ```bash
   git commit -m "Add support for advanced search operators"
   ```

4. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create a Pull Request** on GitHub

## Pull Request Guidelines

- **Clear title** describing the change
- **Detailed description** of what was changed and why
- **Test your changes** thoroughly
- **Update documentation** if needed
- **Keep commits focused** - one feature per PR

## Code Review Process

1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, your PR will be merged

## Reporting Issues

When reporting bugs or requesting features:

1. **Search existing issues** first
2. **Use clear, descriptive titles**
3. **Provide reproduction steps** for bugs
4. **Include relevant logs or error messages**
5. **Describe expected vs actual behavior**

## Development Setup

### Required Tools
- Node.js 18 or higher
- TypeScript 5.x
- npm or yarn

### Environment Variables
- `CHROMIUM_SEARCH_API_KEY` - Optional custom API key

### Project Structure
```
src/
  index.ts          # Main MCP server implementation
dist/               # Compiled TypeScript output
test-mcp.js         # Basic test script
README.md           # Project documentation
```

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for general questions
- Check the README for usage examples

Thank you for contributing! 🚀