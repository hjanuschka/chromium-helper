# Chromium CodeSearch MCP Server

An MCP (Model Context Protocol) server that provides access to the Chromium source code repository via the **real Google CodeSearch API**. This is the same API that powers https://source.chromium.org.

## Features

- **🔍 Real-time Code Search**: Search the live Chromium codebase using Google's official search API
- **🎯 Symbol Lookup**: Find definitions, declarations, and usage examples for C++ symbols, classes, and functions  
- **📊 Rich Results**: Get line numbers, file paths, code snippets, and estimated match counts
- **🔗 Direct Links**: Every result includes clickable URLs to view code in source.chromium.org
- **⚡ Fast & Accurate**: Uses the same search infrastructure as the official Chromium website

## Tools Provided

### `search_chromium_code`
Search for code in the Chromium source repository using Google's official Code Search syntax with advanced filtering options.

**Parameters:**
- `query` (required): Search query using Code Search syntax
- `case_sensitive` (optional): Make search case sensitive (default: false)
- `language` (optional): Filter by programming language (e.g., 'cpp', 'javascript', 'python')
- `file_pattern` (optional): File pattern filter (e.g., '*.cc', '*.h', 'chrome/browser/*')
- `search_type` (optional): Specific search type: 'content', 'function', 'class', 'symbol', 'comment'
- `exclude_comments` (optional): Exclude comments and string literals from search (default: false)
- `limit` (optional): Maximum number of results to return (default: 20)

**Code Search Syntax Examples:**
```
search_chromium_code(query="LOG(INFO)")                    // Basic text search
search_chromium_code(query="CreateWindow", search_type="function")  // Function search
search_chromium_code(query="Browser", search_type="class")          // Class search  
search_chromium_code(query="memory management", search_type="comment") // Comment search
search_chromium_code(query="base::", language="cpp", file_pattern="*.cc") // C++ in .cc files
search_chromium_code(query="TODO", case_sensitive=true, exclude_comments=false) // Case-sensitive
search_chromium_code(query="virtual", exclude_comments=true) // Exclude comments/strings
```

**Advanced Query Syntax:**
You can also use Code Search operators directly in the query:
- `class:ClassName` - Search for class definitions
- `function:FunctionName` - Search for function definitions  
- `symbol:SymbolName` - Search for symbol definitions
- `lang:cpp` - Filter by language
- `file:*.h` - Filter by file pattern
- `content:"exact phrase"` - Search file contents only
- `comment:"TODO: fix"` - Search comments only
- `usage:symbol` - Search excluding comments/strings
- `case:yes query` - Case-sensitive search

### `find_chromium_symbol`
Find symbol definitions, declarations, and usage examples in Chromium source.

**Parameters:**
- `symbol` (required): Symbol to find (function, class, method, etc.)
- `file_path` (optional): File path context for better symbol resolution

**Example:**
```
find_chromium_symbol(symbol="Browser::Create")
```

Returns structured results with:
- **Definitions/Declarations**: Where the symbol is defined
- **Usage Examples**: Real code examples showing how it's used
- **Estimated Match Count**: Total occurrences across the codebase
- **Direct URLs**: Links to view each result in source.chromium.org

### `get_chromium_file`
Get contents of a specific file from Chromium source.

**Parameters:**
- `file_path` (required): Path to the file in Chromium source (e.g., 'base/logging.cc')
- `line_start` (optional): Starting line number
- `line_end` (optional): Ending line number

**Example:**
```
get_chromium_file(file_path="base/logging.cc", line_start=100, line_end=200)
```

### `get_gerrit_cl_status`
Get status and test results for a Chromium Gerrit CL (Change List).

**Parameters:**
- `cl_number` (required): CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')

**Example:**
```
get_gerrit_cl_status(cl_number="6624568")
get_gerrit_cl_status(cl_number="https://chromium-review.googlesource.com/c/chromium/src/+/6624568")
```

**Returns:**
- **CL Information**: Author, status, creation/update timestamps, current patchset
- **Submit Requirements**: Code review status, pre-submit checks, and other requirements
- **Test Results**: LUCI build status, test pass rates, and test run details
- **Comments Summary**: Total and unresolved comment counts
- **Direct Links**: URLs to view the CL in Gerrit and test results in LUCI

### `get_gerrit_cl_comments`
Get review comments for a Chromium Gerrit CL patchset.

**Parameters:**
- `cl_number` (required): CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')
- `patchset` (optional): Specific patchset number to get comments for (defaults to current patchset)
- `include_resolved` (optional): Include resolved comments (default: true)

**Examples:**
```
get_gerrit_cl_comments(cl_number="6624568")
get_gerrit_cl_comments(cl_number="6624568", patchset=3)
get_gerrit_cl_comments(cl_number="6624568", include_resolved=false)
```

**Returns:**
- **Comment Summary**: Total, resolved, unresolved, and draft comment counts
- **Comments by File**: Organized by file with line numbers and actual code context
- **Comment Details**: Author, timestamp, resolution status, and full message text
- **Code Context**: Shows actual code lines around each comment with ➤ highlighting
- **Draft Comments**: Includes any draft comments (marked as 📝 [DRAFT])
- **Direct Links**: URLs to view comments in Gerrit interface

### `get_gerrit_cl_diff`
Get the diff/changes for a Chromium Gerrit CL patchset to see what code was modified.

**Parameters:**
- `cl_number` (required): CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')
- `patchset` (optional): Specific patchset number to get diff for (defaults to current patchset)
- `file_path` (optional): Specific file path to get diff for (if not specified, shows overview of all files)

**Examples:**
```
get_gerrit_cl_diff(cl_number="6624568")                              # Overview of all changes
get_gerrit_cl_diff(cl_number="6624568", file_path="chrome/browser/ui/browser.cc")  # Specific file diff
get_gerrit_cl_diff(cl_number="6624568", patchset=3)                  # Specific patchset
```

**Returns:**
- **File Overview**: List of all changed files with added/deleted line counts
- **Diff Display**: Actual code changes in unified diff format with +/- indicators
- **File Status**: Whether files were added, modified, deleted, or renamed
- **Direct Links**: URLs to view diffs in Gerrit interface

### `get_gerrit_patchset_file`
Get the content of a specific file from a Gerrit patchset for making code changes.

**Parameters:**
- `cl_number` (required): CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')
- `file_path` (required): Path to the file to get content for (e.g., 'chrome/browser/ui/browser.cc')
- `patchset` (optional): Specific patchset number (defaults to current patchset)

**Example:**
```
get_gerrit_patchset_file(cl_number="6624568", file_path="chrome/browser/ui/browser.cc")
get_gerrit_patchset_file(cl_number="6624568", file_path="chrome/browser/ui/browser.cc", patchset=3)
```

**Returns:**
- **Full File Content**: Complete file content with line numbers for easy reference
- **Syntax Highlighting**: Proper language formatting based on file extension
- **File Information**: CL details, patchset number, and author information
- **Direct Links**: URLs to view and diff the file in Gerrit

### `find_chromium_owners_file`
Find OWNERS files for a given file path in Chromium source code by searching up the directory tree.

**Parameters:**
- `file_path` (required): Path to the file to find OWNERS for (e.g., 'chrome/browser/ui/browser.cc')

**Example:**
```
find_chromium_owners_file(file_path="chrome/browser/ui/browser.cc")
```

**Returns:**
- **OWNERS File List**: All OWNERS files from most specific (closest to file) to most general
- **Directory Context**: Shows which directory each OWNERS file applies to
- **Direct Links**: URLs to view each OWNERS file in source.chromium.org
- **Review Guidance**: Information about how OWNERS files work for code reviews

## Sample Usage Examples

<details>
<summary>🔍 Code Search Examples</summary>

### Basic Text Search
```
Search for all LOG(INFO) statements in the codebase
Find all instances of "WebContents" in Chromium
Look for "memory leak" mentions in code
```

### Function Search
```
Find all CreateWindow function definitions
Search for functions named "addEventListener" in JavaScript
Look for all virtual destructor functions
```

### Class Search  
```
Search for Browser class definitions in C++ code
Find all classes ending with "Manager"
Look for CSS-related classes in Blink renderer
```

### Advanced Filtering
```
Search for "WebContents" in C++ header files only
Find all virtual functions in rendering code, excluding comments
Search for "base::" usage in .cc files with case sensitivity
Look for security-related comments in the network stack
Find all memory allocation functions in the base library
```

### Language-Specific Search
```
Search for JavaScript APIs exposed to web pages
Find Python scripts in the testing framework
Look for CSS properties in Blink style code
```

### File Pattern Search
```
Search for "TODO" in all header files
Find logging statements in Chrome browser code only
Look for test functions in unit test files
```

</details>

<details>
<summary>🎯 Symbol Lookup Examples</summary>

### Symbol Discovery
```
Find all definitions and usage of the Browser symbol
Show me where WebContents class is defined and used
Find the RenderProcessHost symbol definitions
Look up the definition of kMaxTabs constant
```

### Class Analysis
```
Find where the TabStripModel class is defined
Show me all usage of the RenderFrameHost class
Look up BrowserWindow interface definitions
Find ContentBrowserClient class implementations
```

### Function Analysis
```
Find where CreateBrowser function is defined
Show usage examples of PostTask function
Look up all overrides of OnNavigationFinished
Find implementations of the Render method
```

</details>

<details>
<summary>📄 File Content Examples</summary>

### Direct File Access
```
Get the content of chrome/browser/ui/browser.h
Show me base/memory/ref_counted.h from lines 100-200
View the LICENSE file in the root directory
```

### File Exploration
```
Get the main browser header file
Show me the base logging implementation
View the WebContents interface definition
```

</details>

<details>
<summary>👥 OWNERS File Examples</summary>

### File Ownership
```
Who owns the file third_party/blink/renderer/core/style/computed_style.h?
Find the owners for chrome/browser/ui/browser.cc
Show me the OWNERS files for base/memory/
Who can review changes to content/browser/ directory?
```

### Directory Ownership
```
Find owners for the entire Blink renderer
Who owns the Chrome UI components?
Show me reviewers for network stack changes
Find owners for testing infrastructure
```

### Specific Component Ownership
```
Who owns CSS implementation in Blink?
Find owners for JavaScript V8 integration
Show me owners for security-critical code
Who reviews accessibility features?
```

</details>

<details>
<summary>🔄 Gerrit Integration Examples</summary>

### CL Status Checking
```
Get the status of Gerrit CL 6624568
Check if CL 5234567 has passed all tests
Show me the current status of https://chromium-review.googlesource.com/c/chromium/src/+/6624568
Find out if CL 7890123 is ready to submit
```

### Review Comments
```
Show me the review comments for CL 6624568
Get all unresolved comments for CL 5234567
Find comments on patchset 3 of CL 7890123
Show resolved and unresolved feedback for CL 4567890
```

### Code Changes (Diffs)
```
Get the diff for CL 6624568 to see what changed
Show me what files were modified in CL 5234567
View the changes to browser.cc in CL 7890123
See the complete diff for CL 4567890 patchset 2
```

### File Content from Patchsets
```
Show me the content of chrome/browser/ui/browser.cc from CL 6624568
Get the modified version of base/memory/ref_counted.h from CL 5234567
View the updated test file from CL 7890123 patchset 3
Show me how the header file changed in CL 4567890
```

</details>

<details>
<summary>🎨 Specialized Use Cases</summary>

### Security Research
```
Find all security-related TODOs in the codebase
Search for cryptographic functions in the network stack
Look for authentication-related classes
Find all uses of sensitive data APIs
```

### Performance Analysis
```
Search for performance-critical code sections
Find all memory allocation patterns
Look for threading and concurrency code
Search for GPU-related implementations
```

### Testing and Quality
```
Find all unit tests for a specific component
Search for integration test patterns
Look for mock implementations
Find performance benchmark code
```

### Web Standards Implementation
```
Search for HTML5 feature implementations
Find CSS specification implementations
Look for JavaScript API implementations
Search for WebAssembly integration code
```

### Architecture Exploration
```
Find all singleton pattern implementations
Search for observer pattern usage
Look for factory pattern implementations
Find all interface definitions in a subsystem
```

</details>

## Installation

### Option 1: From npm (Recommended)
```bash
npm install -g chromium-codesearch-mcp
```

### Option 2: From Source
1. Clone this repository:
   ```bash
   git clone https://github.com/username/chromium-codesearch-mcp.git
   cd chromium-codesearch-mcp
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Option 3: Using npx (No Installation)
```bash
npx chromium-codesearch-mcp
```

## Configuration

### Claude Desktop Setup

1. **Copy the example configuration**:
   ```bash
   cp claude-desktop-config.example.json ~/.config/claude-desktop/claude_desktop_config.json
   ```

2. **Edit the configuration** to point to your installation:
   ```json
   {
     "mcpServers": {
       "chromium-codesearch": {
         "command": "node",
         "args": ["/path/to/chromium-codesearch-mcp/dist/index.js"]
       }
     }
   }
   ```

   Or if installed globally via npm:
   ```json
   {
     "mcpServers": {
       "chromium-codesearch": {
         "command": "chromium-codesearch-mcp"
       }
     }
   }
   ```

3. **Restart Claude Desktop** to load the new MCP server.

### Environment Variables (Optional)

Set a custom API key if desired:
```bash
export CHROMIUM_SEARCH_API_KEY=your_custom_key_here
```

## Example Usage

Once configured with Claude Desktop, you can search the Chromium codebase directly:

**Search for specific code patterns:**
```
Use search_chromium_code to find "WTF::Partitions" usage with limit 5
```

**Find symbol definitions and usage:**
```
Use find_chromium_symbol to find "Browser::Create" definitions and examples
```

**Get direct file links:**
```
Use get_chromium_file to get the link for "chrome/browser/ui/browser.h" from lines 100-200
```

**Check Gerrit CL status:**
```
Use get_gerrit_cl_status to check the status of CL 6624568
```

**Get Gerrit CL review comments:**
```
Use get_gerrit_cl_comments to get review comments for CL 6624568
```

**Get Gerrit CL diff to see code changes:**
```
Use get_gerrit_cl_diff to see what files were changed in CL 6624568
```

**Get specific file content from patchset:**
```
Use get_gerrit_patchset_file to get the content of "chrome/browser/ui/browser.cc" from CL 6624568
```

**Find code reviewers for a file:**
```
Use find_chromium_owners_file to find who can review changes to "chrome/browser/ui/browser.cc"
```

## Sample Results

When you search for `LOG(INFO)`, you'll get results like:

```markdown
## Search Results for "LOG(INFO)"

📊 **Total estimated matches:** 5040
📄 **Showing:** 10 results

### 1. chromecast/crash/linux/dump_info.cc:248
```cpp
➤   LOG(INFO) << "Failed to convert dump time invalid";
    return false;
```
🔗 [View in source.chromium.org](https://source.chromium.org/chromium/chromium/src/+/main:chromecast/crash/linux/dump_info.cc;l=248)

### 2. remoting/host/desktop_display_info.cc:145
```cpp
  if (displays_.size() == 0) {
➤     LOG(INFO) << "No display info available";
    return webrtc::DesktopVector();
```
🔗 [View in source.chromium.org](https://source.chromium.org/chromium/chromium/src/+/main:remoting/host/desktop_display_info.cc;l=145)
```

Note how:
- **Total matches** (5,040) are shown for scope
- **Match highlighting** with ➤ shows exact matches vs context
- **Code formatting** with syntax highlighting
- **Direct links** to view each result in the browser

## Implementation Details

This MCP server uses Google's **official Chromium CodeSearch API**:
- **Endpoint**: `https://grimoireoss-pa.clients6.google.com/batch`
- **API**: `/v1/contents/search` (same API that powers source.chromium.org)
- **Format**: Multipart batch requests with JSON payloads
- **Authentication**: Uses the public API key from source.chromium.org (can be overridden with `CHROMIUM_SEARCH_API_KEY` environment variable)
- **Real-time**: Searches the live Chromium repository, not a cached copy

### API Key Configuration

The server uses the same public API key that source.chromium.org uses. If you prefer to use your own key or the key changes in the future, you can set the `CHROMIUM_SEARCH_API_KEY` environment variable:

```bash
export CHROMIUM_SEARCH_API_KEY=your_api_key_here
node dist/index.js
```

### Key Features:
- 🎯 **Exact Match Highlighting**: Shows precisely which parts of code lines matched
- 📈 **Result Statistics**: Provides estimated total match counts  
- 🔄 **Pagination**: Supports getting more results with `nextPageToken`
- 🔍 **Rich Metadata**: Includes file paths, line numbers, and syntax highlighting info

## Development

- `npm run build`: Build the TypeScript code
- `npm run dev`: Watch for changes and rebuild
- `npm start`: Start the MCP server

## License

This project is licensed under the MIT License.