# Release Process

This document describes the process for releasing both npm packages in this monorepo.

## Overview

This repository contains two separate npm packages:
1. **`chromium-codesearch-mcp`** - MCP Server for Model Context Protocol integration
2. **`chromium-helper`** - CLI tool for command-line usage

## Pre-release Checklist

### 1. Code Quality
- [ ] All tests pass
- [ ] TypeScript builds without errors
- [ ] Code follows project conventions
- [ ] Documentation is up to date

### 2. Version Management
- [ ] Update version numbers in both `package.json` files
- [ ] Update CHANGELOG.md with new features/fixes
- [ ] Commit version changes

### 3. Testing
- [ ] Test MCP server functionality
- [ ] Test CLI tool with all major commands
- [ ] Test binary execution with npx
- [ ] Verify README examples work

## Release Steps

### MCP Server (`chromium-codesearch-mcp`)

1. **Navigate to root directory**
   ```bash
   cd /path/to/chromium-codesearch-mcp
   ```

2. **Update version**
   ```bash
   # Update package.json version manually or use npm version
   npm version patch  # or minor/major
   ```

3. **Build and test**
   ```bash
   npm run build
   npm run test
   ```

4. **Publish to npm**
   ```bash
   # Dry run first to check what will be published
   npm publish --dry-run
   
   # Publish to npm
   npm publish
   ```

5. **Verify publication**
   ```bash
   npx chromium-codesearch-mcp --help
   ```

### CLI Tool (`chromium-helper`)

1. **Navigate to CLI directory**
   ```bash
   cd chromium-helper-cli
   ```

2. **Update version**
   ```bash
   # Update package.json version manually or use npm version
   npm version patch  # or minor/major
   ```

3. **Build and test**
   ```bash
   npm run build
   node dist/index.js --help
   node dist/index.js search "LOG(INFO)" --limit 3
   ```

4. **Publish to npm**
   ```bash
   # Dry run first
   npm publish --dry-run
   
   # Publish to npm
   npm publish
   ```

5. **Verify publication**
   ```bash
   # Test global installation
   npx chromium-helper --help
   npx chromium-helper search "LOG(INFO)" --limit 3
   
   # Test short alias
   npx ch --help
   ```

## Post-release Steps

1. **Tag the release**
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```

2. **Create GitHub release**
   - Go to GitHub releases page
   - Create new release from tag
   - Add release notes from CHANGELOG.md

3. **Update documentation**
   - Update any version references in README files
   - Update installation instructions if needed

## Quick Release Script

Create a script to automate releases:

```bash
#!/bin/bash
# release.sh

set -e

echo "🚀 Starting release process..."

# Check we're on main branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo "❌ Please switch to main branch"
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Please commit all changes first"
    exit 1
fi

echo "📦 Building and testing MCP server..."
npm run build
npm run test

echo "📦 Building and testing CLI tool..."
cd chromium-helper-cli
npm run build
node dist/index.js --help > /dev/null
cd ..

echo "🏷️  Updating versions..."
# Prompt for version type
read -p "Version bump (patch/minor/major): " VERSION_TYPE

# Update MCP server version
npm version $VERSION_TYPE --no-git-tag-version

# Update CLI version
cd chromium-helper-cli
npm version $VERSION_TYPE --no-git-tag-version
cd ..

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")

echo "📝 Committing version changes..."
git add .
git commit -m "chore: bump version to $NEW_VERSION"

echo "📤 Publishing MCP server..."
npm publish

echo "📤 Publishing CLI tool..."
cd chromium-helper-cli
npm publish
cd ..

echo "🏷️  Creating git tag..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin main
git push origin "v$NEW_VERSION"

echo "✅ Release v$NEW_VERSION completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Create GitHub release at: https://github.com/hjanuschka/chromium-codesearch-mcp/releases"
echo "2. Test installations:"
echo "   npx chromium-codesearch-mcp --help"
echo "   npx chromium-helper --help"
echo "   npx ch --help"
```

## Testing Published Packages

### MCP Server
```bash
# Test MCP server
npx chromium-codesearch-mcp

# Test with Claude Desktop (add to config)
{
  "mcpServers": {
    "chromium-codesearch": {
      "command": "npx",
      "args": ["chromium-codesearch-mcp"]
    }
  }
}
```

### CLI Tool
```bash
# Test CLI tool
npx chromium-helper --help
npx chromium-helper search "LOG(INFO)" --limit 3
npx chromium-helper gerrit status 6624568

# Test short alias
npx ch --help
npx ch search "memory leak" --format json --limit 3

# Test PDFium functionality
npx ch pdfium status 130850
```

## Troubleshooting

### Common Issues

1. **Build fails**
   - Check TypeScript errors: `npm run build`
   - Verify all dependencies are installed: `npm install`

2. **Binary not executable**
   - Ensure shebang line exists: `#!/usr/bin/env node`
   - Check file permissions: `chmod +x dist/index.js`

3. **npx fails to find command**
   - Check `bin` field in package.json
   - Verify package name is correct
   - Wait a few minutes for npm to propagate

4. **Version conflicts**
   - Use `npm version` command to update versions consistently
   - Check both package.json files have same version

### Rollback Process

If a release has issues:

1. **Unpublish from npm (within 24 hours)**
   ```bash
   npm unpublish chromium-codesearch-mcp@1.0.0
   npm unpublish chromium-helper@1.0.0
   ```

2. **Deprecate version (after 24 hours)**
   ```bash
   npm deprecate chromium-codesearch-mcp@1.0.0 "Version has issues, use latest"
   npm deprecate chromium-helper@1.0.0 "Version has issues, use latest"
   ```

3. **Release fixed version**
   - Fix issues
   - Bump patch version
   - Follow normal release process

## Monitoring

After release, monitor:
- npm download statistics
- GitHub issues for bug reports
- User feedback and questions

## Maintenance

Regular maintenance tasks:
- Update dependencies monthly
- Review and respond to issues
- Update documentation as needed
- Monitor security advisories