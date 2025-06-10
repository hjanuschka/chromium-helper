#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { load } from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface SearchResult {
  file: string;
  line: number;
  content: string;
  url: string;
  type?: string;
}

interface XRefResult {
  signature: string;
  definition?: SearchResult;
  declaration?: SearchResult;
  references: SearchResult[];
  overrides: SearchResult[];
  calls: SearchResult[];
}

// Custom error types for better error handling
class ChromiumSearchError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'ChromiumSearchError';
  }
}

class GerritAPIError extends Error {
  constructor(message: string, public statusCode?: number, public cause?: Error) {
    super(message);
    this.name = 'GerritAPIError';
  }
}

// Dynamic version loading
const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), '..');
const packageJsonPath = path.join(packageRoot, 'package.json');

let packageInfo: { version: string; name: string };
try {
  packageInfo = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
} catch (error) {
  console.error("Failed to load package.json:", error);
  packageInfo = { version: "0.0.0-error", name: "chromium-codesearch-mcp" };
}

class ChromiumCodeSearchServer {
  private server: Server;
  private cache = new Map<string, any>();

  constructor() {
    this.server = new Server(
      {
        name: "chromium-codesearch",
        version: packageInfo.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...data
    };
    
    // Output structured logs to stderr to avoid interfering with MCP protocol
    console.error(JSON.stringify(logEntry));
  }

  private handleError(error: any, toolName: string, args: any): string {
    // Determine error type and create appropriate response
    if (error instanceof ChromiumSearchError) {
      return `Chromium search failed: ${error.message}`;
    }
    
    if (error instanceof GerritAPIError) {
      return `Gerrit API error: ${error.message}${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}`;
    }
    
    // Handle fetch/network errors
    if (error.name === 'FetchError' || error.code === 'ENOTFOUND') {
      return `Network error: Unable to reach search API. Please check your internet connection.`;
    }
    
    // Handle timeout errors
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      return `Request timeout: The search took too long to complete. Try a more specific query.`;
    }
    
    // Generic error handling
    const errorMessage = error.message || 'Unknown error occurred';
    return `Tool execution failed: ${errorMessage}`;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "search_chromium_code",
            description: "Search for code in the Chromium source repository using Google's official Code Search syntax",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query using Code Search syntax. Examples: 'LOG(INFO)', 'class:Browser', 'function:CreateWindow', 'lang:cpp memory', 'file:*.cc content:\"base::\"', 'comment:\"TODO: fix\"'",
                },
                case_sensitive: {
                  type: "boolean",
                  description: "Make search case sensitive (adds 'case:yes' to query)",
                  default: false,
                },
                language: {
                  type: "string",
                  description: "Filter by programming language (e.g., 'cpp', 'javascript', 'python')",
                },
                file_pattern: {
                  type: "string", 
                  description: "File pattern filter (e.g., '*.cc', '*.h', 'chrome/browser/*')",
                },
                search_type: {
                  type: "string",
                  enum: ["content", "function", "class", "symbol", "comment"],
                  description: "Specific search type: 'content' (file contents), 'function' (function names), 'class' (class names), 'symbol' (symbols), 'comment' (comments only)",
                },
                exclude_comments: {
                  type: "boolean",
                  description: "Exclude comments and string literals from search (uses 'usage:' filter)",
                  default: false,
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 20)",
                  default: 20,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "find_chromium_symbol",
            description: "Find symbol definition, references, and usage in Chromium source",
            inputSchema: {
              type: "object",
              properties: {
                symbol: {
                  type: "string",
                  description: "Symbol to find (function, class, method, etc.)",
                },
                file_path: {
                  type: "string", 
                  description: "Optional file path context for better symbol resolution",
                },
              },
              required: ["symbol"],
            },
          },
          {
            name: "get_chromium_file",
            description: "Get contents of a specific file from Chromium source",
            inputSchema: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "Path to the file in Chromium source (e.g., 'base/logging.cc')",
                },
                line_start: {
                  type: "number",
                  description: "Optional starting line number",
                },
                line_end: {
                  type: "number", 
                  description: "Optional ending line number",
                },
              },
              required: ["file_path"],
            },
          },
          {
            name: "get_gerrit_cl_status",
            description: "Get status and test results for a Chromium Gerrit CL",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')",
                },
              },
              required: ["cl_number"],
            },
          },
          {
            name: "get_gerrit_cl_comments",
            description: "Get review comments for a Chromium Gerrit CL patchset",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')",
                },
                patchset: {
                  type: "number",
                  description: "Optional specific patchset number to get comments for (if not specified, gets comments for current patchset)",
                },
                include_resolved: {
                  type: "boolean",
                  description: "Include resolved comments (default: true)",
                  default: true,
                },
              },
              required: ["cl_number"],
            },
          },
          {
            name: "get_gerrit_cl_diff",
            description: "Get the diff/changes for a Chromium Gerrit CL patchset to understand what code was modified",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')",
                },
                patchset: {
                  type: "number",
                  description: "Optional specific patchset number to get diff for (if not specified, gets diff for current patchset)",
                },
                file_path: {
                  type: "string",
                  description: "Optional specific file path to get diff for (if not specified, gets diff for all files)",
                },
              },
              required: ["cl_number"],
            },
          },
          {
            name: "get_gerrit_patchset_file",
            description: "Get the content of a specific file from a Gerrit patchset for making code changes",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')",
                },
                file_path: {
                  type: "string",
                  description: "Path to the file to get content for (e.g., 'chrome/browser/ui/browser.cc')",
                },
                patchset: {
                  type: "number",
                  description: "Optional specific patchset number (if not specified, gets file from current patchset)",
                },
              },
              required: ["cl_number", "file_path"],
            },
          },
          {
            name: "find_chromium_owners_file",
            description: "Find OWNERS files for a given file path in Chromium source code by searching up the directory tree",
            inputSchema: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "Path to the file to find OWNERS for (e.g., 'chrome/browser/ui/browser.cc')",
                },
              },
              required: ["file_path"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const startTime = Date.now();

      try {
        this.log('info', `Executing tool: ${name}`, { args });

        let result;
        switch (name) {
          case "search_chromium_code":
            result = await this.searchChromiumCode(args);
            break;
          case "find_chromium_symbol":
            result = await this.findChromiumSymbol(args);
            break;
          case "get_chromium_file":
            result = await this.getChromiumFile(args);
            break;
          case "get_gerrit_cl_status":
            result = await this.getGerritCLStatus(args);
            break;
          case "get_gerrit_cl_comments":
            result = await this.getGerritCLComments(args);
            break;
          case "get_gerrit_cl_diff":
            result = await this.getGerritCLDiff(args);
            break;
          case "get_gerrit_patchset_file":
            result = await this.getGerritPatchsetFile(args);
            break;
          case "find_chromium_owners_file":
            result = await this.findChromiumOwnersFile(args);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        const executionTime = Date.now() - startTime;
        this.log('info', `Tool executed successfully: ${name}`, { executionTime });
        return result;

      } catch (error: any) {
        const executionTime = Date.now() - startTime;
        const errorMessage = this.handleError(error, name, args);
        
        this.log('error', `Tool execution failed: ${name}`, { 
          error: error.message, 
          executionTime,
          errorType: error.constructor.name 
        });

        return {
          content: [
            {
              type: "text",
              text: errorMessage,
            },
          ],
        };
      }
    });
  }

  private async searchChromiumCode(args: any) {
    const { 
      query, 
      case_sensitive = false,
      language,
      file_pattern, 
      search_type,
      exclude_comments = false,
      limit = 20 
    } = args;
    
    // Build the enhanced search query using Code Search syntax
    let searchQuery = query;
    
    // Add case sensitivity if requested
    if (case_sensitive) {
      searchQuery = `case:yes ${searchQuery}`;
    }
    
    // Add language filter if specified
    if (language) {
      searchQuery = `lang:${language} ${searchQuery}`;
    }
    
    // Add file pattern filter if specified
    if (file_pattern) {
      searchQuery = `file:${file_pattern} ${searchQuery}`;
    }
    
    // Add search type filter if specified
    if (search_type) {
      switch (search_type) {
        case 'content':
          searchQuery = `content:${query}`;
          break;
        case 'function':
          searchQuery = `function:${query}`;
          break;
        case 'class':
          searchQuery = `class:${query}`;
          break;
        case 'symbol':
          searchQuery = `symbol:${query}`;
          break;
        case 'comment':
          searchQuery = `comment:${query}`;
          break;
      }
      
      // Apply other filters to the type-specific query
      if (case_sensitive) searchQuery = `case:yes ${searchQuery}`;
      if (language) searchQuery = `lang:${language} ${searchQuery}`;
      if (file_pattern) searchQuery = `file:${file_pattern} ${searchQuery}`;
    }
    
    // Add usage filter to exclude comments if requested
    if (exclude_comments && !search_type) {
      searchQuery = `usage:${query}`;
      if (case_sensitive) searchQuery = `case:yes ${searchQuery}`;
      if (language) searchQuery = `lang:${language} ${searchQuery}`;
      if (file_pattern) searchQuery = `file:${file_pattern} ${searchQuery}`;
    }

    try {
      const response = await this.callChromiumSearchAPI(searchQuery, limit);
      const results = this.parseChromiumAPIResponse(response);
      
      if (results.length === 0) {
        const fallbackUrl = `https://source.chromium.org/search?q=${encodeURIComponent(query)}&ss=chromium%2Fchromium%2Fsrc`;
        return {
          content: [
            {
              type: "text",
              text: `No results found for query: "${query}"\n\n🔍 **Direct search URL:**\n${fallbackUrl}`,
            },
          ],
        };
      }

      // Format results with enhanced information
      let resultText = `## Search Results for "${query}"\n\n`;
      
      if (response.estimatedResultCount) {
        resultText += `📊 **Total estimated matches:** ${response.estimatedResultCount}\n`;
        resultText += `📄 **Showing:** ${results.length} results\n\n`;
      }

      resultText += results
        .map((result, index) => {
          const lineInfo = result.line > 0 ? `:${result.line}` : '';
          return `### ${index + 1}. ${result.file}${lineInfo}\n` +
                 `\`\`\`\n${result.content.trim()}\n\`\`\`\n` +
                 `🔗 [View in source.chromium.org](${result.url})\n`;
        })
        .join("\n");

      // Add pagination info if available
      if (response.nextPageToken) {
        resultText += `\n💡 **More results available** - Use the web interface to see additional matches.\n`;
      }
      
      resultText += `\n🔍 **Direct search:** https://source.chromium.org/search?q=${encodeURIComponent(query)}&ss=chromium%2Fchromium%2Fsrc`;

      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      const fallbackUrl = `https://source.chromium.org/search?q=${encodeURIComponent(query)}&ss=chromium%2Fchromium%2Fsrc`;
      return {
        content: [
          {
            type: "text",
            text: `Search failed: ${error.message}\n\nTry searching manually at: ${fallbackUrl}`,
          },
        ],
      };
    }
  }

  private async findChromiumSymbol(args: any) {
    const { symbol, file_path } = args;
    
    try {
      // Search for symbol definitions using Code Search syntax
      const symbolResults = await this.callChromiumSearchAPI(`symbol:${symbol}`, 10);
      const symbolParsed = this.parseChromiumAPIResponse(symbolResults);
      
      // Search for class definitions
      const classResults = await this.callChromiumSearchAPI(`class:${symbol}`, 5);
      const classParsed = this.parseChromiumAPIResponse(classResults);
      
      // Search for function definitions  
      const functionResults = await this.callChromiumSearchAPI(`function:${symbol}`, 5);
      const functionParsed = this.parseChromiumAPIResponse(functionResults);
      
      // Search for general usage in content (excluding comments)
      const usageResults = await this.callChromiumSearchAPI(`usage:${symbol}`, 10);
      const usageParsed = this.parseChromiumAPIResponse(usageResults);
      
      let resultText = `## Symbol: ${symbol}\n\n`;
      
      if (file_path) {
        resultText += `**Context file:** ${file_path}\n\n`;
      }
      
      // Symbol-specific results
      if (symbolParsed.length > 0) {
        resultText += `### 🎯 Symbol Definitions:\n`;
        symbolParsed.forEach((result, index) => {
          resultText += `#### ${index + 1}. ${result.file}:${result.line}\n`;
          resultText += `\`\`\`cpp\n${result.content.trim()}\n\`\`\`\n`;
          resultText += `🔗 [View source](${result.url})\n\n`;
        });
      }
      
      // Class definitions
      if (classParsed.length > 0) {
        resultText += `### 🏗️ Class Definitions:\n`;
        classParsed.forEach((result, index) => {
          resultText += `#### ${index + 1}. ${result.file}:${result.line}\n`;
          resultText += `\`\`\`cpp\n${result.content.trim()}\n\`\`\`\n`;
          resultText += `🔗 [View source](${result.url})\n\n`;
        });
      }
      
      // Function definitions
      if (functionParsed.length > 0) {
        resultText += `### ⚙️ Function Definitions:\n`;
        functionParsed.forEach((result, index) => {
          resultText += `#### ${index + 1}. ${result.file}:${result.line}\n`;
          resultText += `\`\`\`cpp\n${result.content.trim()}\n\`\`\`\n`;
          resultText += `🔗 [View source](${result.url})\n\n`;
        });
      }
      
      // Usage examples
      if (usageParsed.length > 0) {
        resultText += `### 📚 Usage Examples (excluding comments):\n`;
        if (usageResults.estimatedResultCount) {
          resultText += `*Found ${usageResults.estimatedResultCount} total usage matches across the codebase*\n\n`;
        }
        
        usageParsed.slice(0, 8).forEach((result, index) => {
          resultText += `#### ${index + 1}. ${result.file}:${result.line}\n`;
          resultText += `\`\`\`cpp\n${result.content.trim()}\n\`\`\`\n`;
          resultText += `🔗 [View source](${result.url})\n\n`;
        });
        
        if (usageParsed.length >= 8 && usageResults.estimatedResultCount > 8) {
          resultText += `💡 *Showing first 8 examples. Total usage matches: ${usageResults.estimatedResultCount}*\n\n`;
        }
      }
      
      // Show if no results found
      if (symbolParsed.length === 0 && classParsed.length === 0 && functionParsed.length === 0 && usageParsed.length === 0) {
        resultText += `### ❌ No results found\n\nThis could mean:\n- The symbol doesn't exist in the current codebase\n- It might be spelled differently\n- Try searching with different capitalization or as a partial string\n\n`;
      }
      
      resultText += `### 🔍 Search URLs:\n`;
      resultText += `- **Symbol:** https://source.chromium.org/search?q=${encodeURIComponent(`symbol:${symbol}`)}&ss=chromium%2Fchromium%2Fsrc\n`;
      resultText += `- **Class:** https://source.chromium.org/search?q=${encodeURIComponent(`class:${symbol}`)}&ss=chromium%2Fchromium%2Fsrc\n`;
      resultText += `- **Function:** https://source.chromium.org/search?q=${encodeURIComponent(`function:${symbol}`)}&ss=chromium%2Fchromium%2Fsrc\n`;
      resultText += `- **Usage:** https://source.chromium.org/search?q=${encodeURIComponent(`usage:${symbol}`)}&ss=chromium%2Fchromium%2Fsrc`;
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      const fallbackUrl = `https://source.chromium.org/search?q=${encodeURIComponent(symbol)}&ss=chromium%2Fchromium%2Fsrc`;
      return {
        content: [
          {
            type: "text",
            text: `Symbol lookup failed: ${error.message}\n\nTry searching manually at: ${fallbackUrl}`,
          },
        ],
      };
    }
  }

  private async getChromiumFile(args: any) {
    const { file_path, line_start, line_end } = args;
    
    let url = `https://source.chromium.org/chromium/chromium/src/+/main:${file_path}`;
    if (line_start) {
      url += `;l=${line_start}`;
      if (line_end) {
        url += `-${line_end}`;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `File: ${file_path}\nURL: ${url}\n\nUse the URL above to view the file content in your browser.`,
        },
      ],
    };
  }

  private async fetchWithCache(url: string): Promise<any> {
    const cacheHit = this.cache.has(url);
    this.log('debug', 'Fetching URL', { url: url.substring(0, 100) + '...', cacheHit });
    
    if (cacheHit) {
      return this.cache.get(url);
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        this.log('error', 'HTTP request failed', { 
          url: url.substring(0, 100) + '...', 
          status: response.status, 
          statusText: response.statusText 
        });
        throw new GerritAPIError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      const result = await response.json();
      this.cache.set(url, result);
      
      // Simple cache cleanup - remove old entries
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }

      this.log('debug', 'HTTP request successful', { 
        url: url.substring(0, 100) + '...', 
        cacheSize: this.cache.size 
      });

      return result;
    } catch (error: any) {
      if (error instanceof GerritAPIError) {
        throw error;
      }
      this.log('error', 'Network error during fetch', { 
        url: url.substring(0, 100) + '...', 
        error: error.message 
      });
      throw new GerritAPIError(`Network error: ${error.message}`, undefined, error);
    }
  }

  private parseSearchResponse(response: any): SearchResult[] {
    const results: SearchResult[] = [];
    
    if (!response.search_response || !response.search_response[0]) {
      return results;
    }

    const searchResult = response.search_response[0];
    if (!searchResult.search_result) {
      return results;
    }

    for (const fileResult of searchResult.search_result) {
      let filename = fileResult.file.name;
      if (filename.startsWith("src/")) {
        filename = filename.substr(4);
      }

      for (const match of fileResult.match || []) {
        const lineNumber = parseInt(match.line_number) || 0;
        const content = match.line_text || '';
        const url = `https://source.chromium.org/chromium/chromium/src/+/main:${filename};l=${lineNumber}`;

        results.push({
          file: filename,
          line: lineNumber,
          content: content,
          url: url,
        });
      }
    }

    return results;
  }

  private async getGerritCLStatus(args: any) {
    const { cl_number } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // Fetch CL details
      const clDetailsUrl = `https://chromium-review.googlesource.com/changes/?q=change:${clId}&o=DETAILED_ACCOUNTS&o=CURRENT_REVISION&o=SUBMIT_REQUIREMENTS&o=MESSAGES`;
      const clResponse = await fetch(clDetailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!clResponse.ok) {
        throw new Error(`Failed to fetch CL details: ${clResponse.status}`);
      }
      
      const responseText = await clResponse.text();
      // Remove XSSI prefix
      const jsonText = responseText.replace(/^\)]}'\n/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`CL ${clId} not found`);
      }
      
      const cl = clData[0];
      
      // Extract LUCI run information from messages
      const messages = await this.fetchGerritMessages(clId);
      const luciRuns = this.extractLuciRuns(messages);
      
      // Build result text
      let resultText = `## Gerrit CL ${clId}: ${cl.subject}\n\n`;
      resultText += `**Author:** ${cl.owner.name} (${cl.owner.email})\n`;
      resultText += `**Status:** ${cl.status}\n`;
      resultText += `**Created:** ${new Date(cl.created).toLocaleString()}\n`;
      resultText += `**Updated:** ${new Date(cl.updated).toLocaleString()}\n`;
      resultText += `**Patchset:** ${cl.current_revision_number}\n\n`;
      
      // Submit requirements
      resultText += `### 📋 Submit Requirements:\n`;
      for (const req of cl.submit_requirements || []) {
        if (req.status === 'NOT_APPLICABLE') continue;
        
        const status = req.status === 'SATISFIED' ? '✅' : 
                      req.status === 'UNSATISFIED' ? '❌' : '⚠️';
        resultText += `- ${status} **${req.name}**: ${req.status}\n`;
        
        if (req.name === 'Code-Review' && req.submittability_expression_result) {
          const expr = req.submittability_expression_result;
          if (expr.failing_atoms && expr.failing_atoms.includes('label:Code-Review=MAX,user=non_uploader')) {
            resultText += `  - Needs code review approval from another committer\n`;
          }
        }
      }
      
      // LUCI/Test status
      if (luciRuns.length > 0) {
        resultText += `\n### 🧪 Test Results:\n`;
        
        for (const run of luciRuns) {
          const passRate = this.calculatePassRate(run);
          resultText += `\n**Patchset ${run.patchset}**: ${run.status}\n`;
          
          if (passRate !== null) {
            const emoji = passRate === 100 ? '✅' : passRate >= 80 ? '⚠️' : '❌';
            resultText += `${emoji} **Success Rate:** ${passRate}%\n`;
          }
          
          if (run.luciUrl) {
            resultText += `🔗 [View test details in LUCI](${run.luciUrl})\n`;
          }
          
          if (run.message) {
            resultText += `💬 ${run.message}\n`;
          }
        }
      } else {
        resultText += `\n### 🧪 Test Results:\n`;
        resultText += `No LUCI runs found yet. Tests may still be queued.\n`;
      }
      
      // Links
      resultText += `\n### 🔗 Links:\n`;
      resultText += `- **Gerrit:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}\n`;
      
      // Comments summary
      if (cl.total_comment_count > 0) {
        resultText += `\n### 💬 Comments:\n`;
        resultText += `- Total: ${cl.total_comment_count}\n`;
        resultText += `- Unresolved: ${cl.unresolved_comment_count}\n`;
      }
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get CL status: ${error.message}\n\nTry viewing directly at: https://chromium-review.googlesource.com/c/chromium/src/+/${clId}`,
          },
        ],
      };
    }
  }
  
  private async fetchGerritMessages(clId: string): Promise<any[]> {
    try {
      const messagesUrl = `https://chromium-review.googlesource.com/changes/${clId}/messages`;
      const response = await fetch(messagesUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        return [];
      }
      
      const responseText = await response.text();
      const jsonText = responseText.replace(/^\)]}'\n/, '');
      return JSON.parse(jsonText);
    } catch (error) {
      return [];
    }
  }
  
  private extractLuciRuns(messages: any[]): any[] {
    const luciRuns = [];
    
    for (const msg of messages) {
      // Look for LUCI CQ messages
      if (msg.author?.name === 'Chromium LUCI CQ' || msg.tag?.includes('cq:dry-run')) {
        const luciUrlMatch = msg.message?.match(/https:\/\/luci-change-verifier\.appspot\.com\/ui\/run\/[^\s]+/);
        const patchsetMatch = msg.message?.match(/Patch Set (\d+):/);
        const statusMatch = msg.message?.match(/This CL has (passed|failed) the run/);
        const dryRunMatch = msg.message?.match(/Dry run: CV is trying the patch/);
        
        if (luciUrlMatch || statusMatch || dryRunMatch) {
          luciRuns.push({
            patchset: patchsetMatch ? parseInt(patchsetMatch[1]) : 0,
            luciUrl: luciUrlMatch ? luciUrlMatch[0] : null,
            status: statusMatch ? (statusMatch[1] === 'passed' ? '✅ PASSED' : '❌ FAILED') : 
                   dryRunMatch ? '🔄 RUNNING' : '❓ UNKNOWN',
            message: statusMatch ? `This CL has ${statusMatch[1]} the run` : 
                    dryRunMatch ? 'Dry run in progress' : '',
            timestamp: msg.date,
          });
        }
      }
    }
    
    // Return most recent runs first
    return luciRuns.reverse();
  }
  
  private calculatePassRate(run: any): number | null {
    // For now, we can't get detailed test results without scraping LUCI
    // Return null to indicate we don't have this data yet
    // In the future, we could add LUCI API integration
    if (run.status === '✅ PASSED') return 100;
    if (run.status === '❌ FAILED') return 0; // We don't know the exact percentage
    return null;
  }

  private async getGerritCLComments(args: any) {
    const { cl_number, patchset, include_resolved = true } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://chromium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
      const clResponse = await fetch(clDetailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!clResponse.ok) {
        throw new Error(`Failed to fetch CL details: ${clResponse.status}`);
      }
      
      const responseText = await clResponse.text();
      const jsonText = responseText.replace(/^\)]}'/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = patchset || cl.current_revision_number || 1;
      
      // Get comments for the specified patchset
      const commentsUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/comments`;
      const commentsResponse = await fetch(commentsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!commentsResponse.ok) {
        throw new Error(`Failed to fetch comments: ${commentsResponse.status}`);
      }
      
      const commentsText = await commentsResponse.text();
      const commentsJsonText = commentsText.replace(/^\)]}'/, '');
      const commentsData = JSON.parse(commentsJsonText);
      
      // Also get draft comments if available
      const draftsUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/drafts`;
      let draftsData = {};
      try {
        const draftsResponse = await fetch(draftsUrl, {
          headers: {
            'Accept': 'application/json',
          },
        });
        if (draftsResponse.ok) {
          const draftsText = await draftsResponse.text();
          const draftsJsonText = draftsText.replace(/^\)]}'/, '');
          draftsData = JSON.parse(draftsJsonText);
        }
      } catch (error) {
        // Drafts might not be accessible, ignore
      }
      
      // Format the results
      let resultText = `## Review Comments for CL ${clId}: ${cl.subject}\n\n`;
      resultText += `**Patchset:** ${targetPatchset}\n`;
      resultText += `**Author:** ${cl.owner.name}\n\n`;
      
      const allComments = this.organizeComments(commentsData, draftsData, include_resolved);
      
      if (allComments.length === 0) {
        resultText += `### 💬 No comments found\n\n`;
        resultText += `This patchset has no review comments yet.\n`;
      } else {
        // Group comments by file
        const commentsByFile = new Map<string, any[]>();
        
        for (const comment of allComments) {
          const fileName = comment.file || 'General Comments';
          if (!commentsByFile.has(fileName)) {
            commentsByFile.set(fileName, []);
          }
          commentsByFile.get(fileName)!.push(comment);
        }
        
        const stats = this.getCommentStats(allComments);
        resultText += `### 📊 Comment Summary\n`;
        resultText += `- **Total:** ${stats.total} comments\n`;
        resultText += `- **Unresolved:** ${stats.unresolved}\n`;
        resultText += `- **Resolved:** ${stats.resolved}\n`;
        if (stats.drafts > 0) {
          resultText += `- **Drafts:** ${stats.drafts}\n`;
        }
        resultText += `- **Files with comments:** ${commentsByFile.size}\n\n`;
        
        // Display comments grouped by file
        for (const [fileName, fileComments] of commentsByFile.entries()) {
          if (fileName === 'General Comments') {
            resultText += `### 💬 General Comments\n\n`;
          } else {
            resultText += `### 📄 ${fileName}\n\n`;
          }
          
          // Sort comments by line number
          fileComments.sort((a, b) => (a.line || 0) - (b.line || 0));
          
          for (const comment of fileComments) {
            const author = comment.author?.name || 'Unknown';
            const timestamp = comment.updated ? new Date(comment.updated).toLocaleDateString() : '';
            const resolved = comment.resolved ? '✅' : '🔴';
            const draft = comment.isDraft ? '📝 [DRAFT]' : '';
            const lineInfo = comment.line ? `:${comment.line}` : '';
            
            resultText += `#### ${resolved} ${author} ${draft}\n`;
            if (timestamp) {
              resultText += `*${timestamp}*`;
            }
            if (lineInfo) {
              resultText += ` - Line ${comment.line}`;
            }
            resultText += `\n\n`;
            
            // Quote the comment message
            const message = comment.message || '';
            resultText += `> ${message.split('\n').join('\n> ')}\n\n`;
            
            // Show code context if available
            if (comment.line && fileName !== 'General Comments' && fileName !== 'Commit Message') {
              try {
                const codeContext = await this.getCodeContextForComment(clId, targetPatchset, fileName, comment.line);
                if (codeContext) {
                  resultText += `**Code context (Line ${comment.line}):**\n`;
                  resultText += `\`\`\`${this.getFileExtension(fileName)}\n`;
                  resultText += codeContext;
                  resultText += `\`\`\`\n\n`;
                }
              } catch (error) {
                resultText += `**Code reference:** Line ${comment.line} in ${fileName}\n\n`;
              }
            }
          }
        }
      }
      
      resultText += `### 🔗 Links\n`;
      resultText += `- **Gerrit CL:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}/${targetPatchset}\n`;
      resultText += `- **Comments view:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}/${targetPatchset}#comments\n`;
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get CL comments: ${error.message}\n\nTry viewing directly at: https://chromium-review.googlesource.com/c/chromium/src/+/${clId}`,
          },
        ],
      };
    }
  }
  
  private organizeComments(commentsData: any, draftsData: any, includeResolved: boolean): any[] {
    const allComments = [];
    
    // Process regular comments
    for (const [fileName, fileComments] of Object.entries(commentsData)) {
      if (Array.isArray(fileComments)) {
        for (const comment of fileComments) {
          if (!includeResolved && comment.resolved) {
            continue;
          }
          allComments.push({
            ...comment,
            file: fileName === '/COMMIT_MSG' ? 'Commit Message' : fileName,
            isDraft: false,
          });
        }
      }
    }
    
    // Process draft comments
    for (const [fileName, fileComments] of Object.entries(draftsData)) {
      if (Array.isArray(fileComments)) {
        for (const comment of fileComments) {
          allComments.push({
            ...comment,
            file: fileName === '/COMMIT_MSG' ? 'Commit Message' : fileName,
            isDraft: true,
          });
        }
      }
    }
    
    return allComments;
  }
  
  private getCommentStats(comments: any[]): { total: number; resolved: number; unresolved: number; drafts: number } {
    let resolved = 0;
    let unresolved = 0;
    let drafts = 0;
    
    for (const comment of comments) {
      if (comment.isDraft) {
        drafts++;
      } else if (comment.resolved) {
        resolved++;
      } else {
        unresolved++;
      }
    }
    
    return {
      total: comments.length,
      resolved,
      unresolved,
      drafts,
    };
  }

  private async getCodeContextForComment(clId: string, patchset: number, fileName: string, lineNumber: number): Promise<string | null> {
    try {
      // Get the file content from the patchset
      const fileUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${patchset}/files/${encodeURIComponent(fileName)}/content`;
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'Accept': 'text/plain',
        },
      });
      
      if (!fileResponse.ok) {
        return null;
      }
      
      // Gerrit returns base64 encoded content
      const base64Content = await fileResponse.text();
      const content = Buffer.from(base64Content, 'base64').toString('utf-8');
      const lines = content.split('\n');
      
      // Get context around the comment line (±3 lines)
      const contextStart = Math.max(0, lineNumber - 4);
      const contextEnd = Math.min(lines.length, lineNumber + 3);
      
      let context = '';
      for (let i = contextStart; i < contextEnd; i++) {
        const displayLineNum = i + 1;
        const marker = displayLineNum === lineNumber ? '➤' : ' ';
        context += `${marker} ${displayLineNum.toString().padStart(4, ' ')}: ${lines[i]}\n`;
      }
      
      return context;
    } catch (error) {
      return null;
    }
  }

  private async getGerritCLDiff(args: any) {
    const { cl_number, patchset, file_path } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://chromium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
      const clResponse = await fetch(clDetailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!clResponse.ok) {
        throw new Error(`Failed to fetch CL details: ${clResponse.status}`);
      }
      
      const responseText = await clResponse.text();
      const jsonText = responseText.replace(/^\)]}'/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = patchset || cl.current_revision_number || 1;
      const revision = cl.revisions[cl.current_revision];
      
      // Get the files list first to understand what changed
      const filesUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files`;
      const filesResponse = await fetch(filesUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!filesResponse.ok) {
        throw new Error(`Failed to fetch files: ${filesResponse.status}`);
      }
      
      const filesText = await filesResponse.text();
      const filesJsonText = filesText.replace(/^\)]}'/, '');
      const filesData = JSON.parse(filesJsonText);
      
      let resultText = `## Diff for CL ${clId}: ${cl.subject}\n\n`;
      resultText += `**Patchset:** ${targetPatchset}\n`;
      resultText += `**Author:** ${cl.owner.name}\n\n`;
      
      const changedFiles = Object.keys(filesData).filter(f => f !== '/COMMIT_MSG');
      
      if (file_path) {
        // Get diff for specific file
        if (!filesData[file_path]) {
          resultText += `### ❌ File not found in this patchset\n\nFile \`${file_path}\` was not modified in patchset ${targetPatchset}.\n\n`;
          resultText += `**Modified files:**\n${changedFiles.map(f => `- ${f}`).join('\n')}`;
        } else {
          const diffUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(file_path)}/diff?base=${targetPatchset-1}&context=ALL&intraline`;
          const diffResponse = await fetch(diffUrl, {
            headers: {
              'Accept': 'application/json',
            },
          });
          
          if (diffResponse.ok) {
            const diffText = await diffResponse.text();
            const diffJsonText = diffText.replace(/^\)]}'/, '');
            const diffData = JSON.parse(diffJsonText);
            
            resultText += `### 📄 ${file_path}\n\n`;
            resultText += this.formatDiff(diffData, file_path);
          } else {
            resultText += `### ❌ Could not fetch diff for ${file_path}\n\n`;
          }
        }
      } else {
        // Get overview of all changed files
        resultText += `### 📊 Summary\n`;
        resultText += `- **Files changed:** ${changedFiles.length}\n`;
        resultText += `- **Commit:** ${revision?._number || 'Unknown'}\n\n`;
        
        resultText += `### 📁 Changed Files\n\n`;
        
        for (const fileName of changedFiles.slice(0, 10)) { // Limit to first 10 files
          const fileInfo = filesData[fileName];
          const status = fileInfo.status || 'M';
          const statusIcon = status === 'A' ? '🆕' : status === 'D' ? '🗑️' : '✏️';
          const linesAdded = fileInfo.lines_inserted || 0;
          const linesDeleted = fileInfo.lines_deleted || 0;
          
          resultText += `#### ${statusIcon} ${fileName}\n`;
          resultText += `- **Lines:** +${linesAdded} -${linesDeleted}\n`;
          resultText += `- **Status:** ${this.getStatusText(status)}\n\n`;
        }
        
        if (changedFiles.length > 10) {
          resultText += `\n💡 *Showing first 10 files. Total: ${changedFiles.length} files changed.*\n`;
        }
        
        resultText += `\n### 🔍 Get specific file diff:\n`;
        resultText += `Use \`get_gerrit_cl_diff(cl_number="${clId}", file_path="path/to/file")\` to see the actual code changes.\n`;
      }
      
      resultText += `\n### 🔗 Links\n`;
      resultText += `- **Gerrit diff view:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}/${targetPatchset}\n`;
      if (file_path) {
        resultText += `- **File diff:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}/${targetPatchset}/${encodeURIComponent(file_path)}\n`;
      }
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get CL diff: ${error.message}\n\nTry viewing directly at: https://chromium-review.googlesource.com/c/chromium/src/+/${clId}`,
          },
        ],
      };
    }
  }

  private async getGerritPatchsetFile(args: any) {
    const { cl_number, file_path, patchset } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://chromium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
      const clResponse = await fetch(clDetailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!clResponse.ok) {
        throw new Error(`Failed to fetch CL details: ${clResponse.status}`);
      }
      
      const responseText = await clResponse.text();
      const jsonText = responseText.replace(/^\)]}'/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = patchset || cl.current_revision_number || 1;
      
      // Get the file content from the patchset
      const fileUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(file_path)}/content`;
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'Accept': 'text/plain',
        },
      });
      
      if (!fileResponse.ok) {
        if (fileResponse.status === 404) {
          return {
            content: [
              {
                type: "text",
                text: `File not found: ${file_path}\n\nThis file may not exist in patchset ${targetPatchset} or may have been deleted.\n\nTry using get_gerrit_cl_diff to see what files were changed.`,
              },
            ],
          };
        }
        throw new Error(`Failed to fetch file content: ${fileResponse.status}`);
      }
      
      // Gerrit returns base64 encoded content
      const base64Content = await fileResponse.text();
      const content = Buffer.from(base64Content, 'base64').toString('utf-8');
      
      let resultText = `## File: ${file_path}\n`;
      resultText += `**CL:** ${clId} - ${cl.subject}\n`;
      resultText += `**Patchset:** ${targetPatchset}\n`;
      resultText += `**Author:** ${cl.owner.name}\n\n`;
      
      // Add file content with line numbers
      const lines = content.split('\n');
      resultText += `### 📄 Content (${lines.length} lines)\n\n`;
      resultText += `\`\`\`${this.getFileExtension(file_path)}\n`;
      
      // Add line numbers for easier reference with comments
      lines.forEach((line, index) => {
        resultText += `${(index + 1).toString().padStart(4, ' ')}: ${line}\n`;
      });
      
      resultText += `\`\`\`\n\n`;
      
      resultText += `### 🔗 Links\n`;
      resultText += `- **Gerrit file view:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}/${targetPatchset}/${encodeURIComponent(file_path)}\n`;
      resultText += `- **File diff:** https://chromium-review.googlesource.com/c/chromium/src/+/${clId}/${targetPatchset}/${encodeURIComponent(file_path)}?diff=1\n`;
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get file content: ${error.message}\n\nTry viewing directly at: https://chromium-review.googlesource.com/c/chromium/src/+/${clId}`,
          },
        ],
      };
    }
  }

  private formatDiff(diffData: any, fileName: string): string {
    let result = '';
    
    if (!diffData.content) {
      return 'No diff content available.\n\n';
    }
    
    result += `\`\`\`diff\n`;
    
    for (const section of diffData.content) {
      if (section.ab) {
        // Unchanged lines (context)
        section.ab.forEach((line: string) => {
          result += ` ${line}\n`;
        });
      }
      
      if (section.a) {
        // Removed lines
        section.a.forEach((line: string) => {
          result += `-${line}\n`;
        });
      }
      
      if (section.b) {
        // Added lines
        section.b.forEach((line: string) => {
          result += `+${line}\n`;
        });
      }
    }
    
    result += `\`\`\`\n\n`;
    
    return result;
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'A': return 'Added';
      case 'D': return 'Deleted';
      case 'M': return 'Modified';
      case 'R': return 'Renamed';
      case 'C': return 'Copied';
      default: return 'Modified';
    }
  }

  private getFileExtension(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const extensionMap: { [key: string]: string } = {
      'cc': 'cpp',
      'cpp': 'cpp',
      'cxx': 'cpp',
      'h': 'cpp',
      'hpp': 'cpp',
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'go': 'go',
      'rs': 'rust',
      'sh': 'bash',
      'md': 'markdown',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'yml': 'yaml',
      'yaml': 'yaml',
    };
    return extensionMap[ext] || '';
  }

  private parseOwnersContent(content: string): string[] {
    const owners: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Handle file:// references (points to other OWNERS files)
      if (trimmed.startsWith('file://')) {
        owners.push(`📁 ${trimmed} (reference to other OWNERS file)`);
        continue;
      }
      
      // Handle per-file rules (only add the email part)
      if (trimmed.includes('=')) {
        const parts = trimmed.split('=');
        if (parts.length > 1) {
          const emails = parts[1].trim();
          if (emails && emails.includes('@')) {
            owners.push(emails);
          }
        }
        continue;
      }
      
      // Handle regular email addresses
      if (trimmed.includes('@')) {
        owners.push(trimmed);
        continue;
      }
      
      // Handle special keywords
      if (trimmed === '*') {
        owners.push('* (anyone can approve)');
        continue;
      }
      
      // Handle set directives
      if (trimmed.startsWith('set ')) {
        owners.push(`⚙️ ${trimmed} (directive)`);
        continue;
      }
      
      // Handle include directives  
      if (trimmed.startsWith('include ')) {
        owners.push(`📂 ${trimmed} (include directive)`);
        continue;
      }
      
      // Any other non-empty line might be relevant
      if (trimmed) {
        owners.push(`? ${trimmed} (unknown format)`);
      }
    }
    
    return owners;
  }

  private async findChromiumOwnersFile(args: any) {
    const { file_path } = args;
    
    try {
      let resultText = `## OWNERS files for ${file_path}\n\n`;
      
      // Split the path into directory segments
      const pathParts = file_path.split('/');
      const directories = [];
      
      // Get the file's directory (remove filename if this is a file path)
      const isFile = !file_path.endsWith('/') && pathParts[pathParts.length - 1].includes('.');
      const dirParts = isFile ? pathParts.slice(0, -1) : pathParts;
      
      // Build directory paths from most specific to least specific
      for (let i = dirParts.length; i > 0; i--) {
        const dirPath = dirParts.slice(0, i).join('/');
        if (dirPath) {
          directories.push(dirPath);
        }
      }
      
      this.log('debug', 'OWNERS search directories', { 
        file_path, 
        isFile, 
        directories: directories.slice(0, 5) // Log first 5 to avoid spam
      });
      
      // Search for OWNERS files in each directory from most specific to least specific
      const ownersFiles = [];
      for (const dir of directories) {
        const ownersPath = `${dir}/OWNERS`;
        
        // Always construct the OWNERS file URL since search is unreliable for specific files
        const constructedUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${ownersPath}`;
        
        // Try to verify if the file exists via a simple search
        let verified = false;
        try {
          const searchResponse = await this.callChromiumSearchAPI(`"${ownersPath}"`, 3);
          const results = this.parseChromiumAPIResponse(searchResponse);
          
          verified = results.some(result => 
            result.file === ownersPath || 
            result.file === `src/${ownersPath}` ||
            result.file.endsWith(`${ownersPath}`)
          );
          
          this.log('debug', 'OWNERS file search result', { 
            ownersPath, 
            verified, 
            resultCount: results.length 
          });
        } catch (error: any) {
          this.log('debug', 'OWNERS file verification failed', { ownersPath, error: error.message });
        }
        
        // Try to fetch the OWNERS file content
        let content = null;
        let owners: string[] = [];
        
        try {
          // Use the Gitiles raw file API to get the actual file content
          const rawUrl = `https://chromium.googlesource.com/chromium/src/+/main/${ownersPath}?format=TEXT`;
          const response = await fetch(rawUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
          });
          
          if (response.ok) {
            const base64Content = await response.text();
            content = Buffer.from(base64Content, 'base64').toString('utf-8');
            owners = this.parseOwnersContent(content);
            verified = true;
            this.log('debug', 'Successfully fetched OWNERS file', { 
              ownersPath, 
              contentLength: content.length,
              ownersCount: owners.length 
            });
          }
        } catch (error: any) {
          this.log('debug', 'Failed to fetch OWNERS file content', { ownersPath, error: error.message });
        }

        ownersFiles.push({
          path: ownersPath,
          url: constructedUrl,
          directory: dir,
          verified,
          content,
          owners
        });
      }
      
      if (ownersFiles.length === 0) {
        resultText += `### ❌ No OWNERS files found\n\n`;
        resultText += `Could not find any OWNERS files in the directory tree for \`${file_path}\`.\n\n`;
        resultText += `This could mean:\n`;
        resultText += `- The file path might not exist in the Chromium repository\n`;
        resultText += `- OWNERS files might be named differently in this area\n`;
        resultText += `- The search API might not have indexed these files\n\n`;
      } else {
        resultText += `### 📋 Found ${ownersFiles.length} OWNERS file(s)\n\n`;
        resultText += `Listed from most specific (closest to file) to most general:\n\n`;
        
        for (const [index, ownersFile] of ownersFiles.entries()) {
          const statusIcon = ownersFile.verified ? '✅' : '🔗';
          const statusText = ownersFile.verified ? '(loaded)' : '(check manually)';
          
          resultText += `#### ${index + 1}. ${ownersFile.path}\n`;
          resultText += `**Directory:** \`${ownersFile.directory}/\`\n`;
          resultText += `${statusIcon} [View OWNERS file](${ownersFile.url}) ${statusText}\n\n`;
          
          // Show owners if we successfully loaded the file
          if (ownersFile.owners && ownersFile.owners.length > 0) {
            resultText += `**Owners/Rules:**\n`;
            for (const owner of ownersFile.owners) {
              resultText += `- ${owner}\n`;
            }
            resultText += `\n`;
          } else if (ownersFile.content) {
            resultText += `**Note:** OWNERS file found but no recognizable owners parsed.\n\n`;
          }
        }
      }
      
      // Add helpful information
      resultText += `### 💡 About OWNERS files\n\n`;
      resultText += `OWNERS files define who can approve changes in Chromium:\n`;
      resultText += `- **Closest OWNERS file** typically has the most relevant reviewers\n`;
      resultText += `- **Higher-level OWNERS** can also approve but may be less familiar with specifics\n`;
      resultText += `- Use \`git cl owners\` locally to find suggested reviewers\n\n`;
      
      resultText += `### 🔍 Manual search\n`;
      resultText += `**Search for OWNERS files:** https://source.chromium.org/search?q=filename:OWNERS&ss=chromium%2Fchromium%2Fsrc\n`;
      
      return {
        content: [
          {
            type: "text",
            text: resultText,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to find OWNERS files: ${error.message}\n\nTry searching manually at: https://source.chromium.org/search?q=filename:OWNERS&ss=chromium%2Fchromium%2Fsrc`,
          },
        ],
      };
    }
  }

  private escapeRegexChars(query: string): string {
    // Escape regex special characters for literal search
    // Based on discovery that parentheses need escaping: LOG(INFO) -> LOG\\(INFO\\)
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
  }

  private async callChromiumSearchAPI(query: string, limit: number): Promise<any> {
    // Use environment variable or fall back to the public API key used by source.chromium.org
    const apiKey = process.env.CHROMIUM_SEARCH_API_KEY || 'AIzaSyCqPSptx9mClE5NU4cpfzr6cgdO_phV1lM';
    
    this.log('debug', 'Calling Chromium Search API', { 
      query: query.length > 100 ? query.substring(0, 100) + '...' : query,
      limit 
    });
    
    const searchPayload = {
      queryString: query,
      searchOptions: {
        enableDiagnostics: false,
        exhaustive: false,
        numberOfContextLines: 1,
        pageSize: Math.min(limit, 25),
        pageToken: "",
        pathPrefix: "",
        repositoryScope: {
          root: {
            ossProject: "chromium",
            repositoryName: "chromium/src"
          }
        },
        retrieveMultibranchResults: true,
        savedQuery: "",
        scoringModel: "",
        showPersonalizedResults: false,
        suppressGitLegacyResults: false
      },
      snippetOptions: {
        minSnippetLinesPerFile: 10,
        minSnippetLinesPerPage: 60,
        numberOfContextLines: 1
      }
    };

    // Generate a boundary for multipart request
    const boundary = `batch${Date.now()}${Math.random().toString().substr(2)}`;
    
    // Create the multipart body exactly like the working curl
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/http',
      `Content-ID: <response-${boundary}+gapiRequest@googleapis.com>`,
      '',
      `POST /v1/contents/search?alt=json&key=${apiKey}`,
      'sessionid: ' + Math.random().toString(36).substr(2, 12),
      'actionid: ' + Math.random().toString(36).substr(2, 12),
      'X-JavaScript-User-Agent: google-api-javascript-client/1.1.0',
      'X-Requested-With: XMLHttpRequest',
      'Content-Type: application/json',
      'X-Goog-Encode-Response-If-Executable: base64',
      '',
      JSON.stringify(searchPayload),
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const response = await fetch(`https://grimoireoss-pa.clients6.google.com/batch?%24ct=multipart%2Fmixed%3B%20boundary%3D${boundary}`, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'text/plain; charset=UTF-8',
        'origin': 'https://source.chromium.org',
        'pragma': 'no-cache',
        'referer': 'https://source.chromium.org/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      },
      body: multipartBody
    });

    if (!response.ok) {
      this.log('error', 'Chromium Search API request failed', { 
        status: response.status, 
        statusText: response.statusText,
        query: query.length > 50 ? query.substring(0, 50) + '...' : query
      });
      throw new ChromiumSearchError(`API request failed: ${response.status} ${response.statusText}`);
    }

    const responseText = await response.text();
    
    // Parse the multipart response to extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.log('error', 'Failed to parse Chromium Search API response', { 
        responseLength: responseText.length,
        query: query.length > 50 ? query.substring(0, 50) + '...' : query
      });
      throw new ChromiumSearchError('Could not parse API response');
    }

    const result = JSON.parse(jsonMatch[0]);
    this.log('debug', 'Chromium Search API response received', { 
      resultCount: result.searchResults?.length || 0,
      estimatedTotal: result.estimatedResultCount
    });

    return result;
  }

  private parseChromiumAPIResponse(apiResponse: any): SearchResult[] {
    const results: SearchResult[] = [];
    
    if (!apiResponse.searchResults) {
      return results;
    }

    for (const searchResult of apiResponse.searchResults) {
      const fileResult = searchResult.fileSearchResult;
      if (!fileResult) continue;

      const filePath = fileResult.fileSpec.path;
      
      for (const snippet of fileResult.snippets || []) {
        const snippetLines = snippet.snippetLines || [];
        
        // Group lines by snippet for better context
        if (snippetLines.length > 0) {
          // Find the primary match line (the one with ranges)
          const matchLines = snippetLines.filter((line: any) => line.ranges && line.ranges.length > 0);
          
          if (matchLines.length > 0) {
            // Use the first match line as the primary result
            const primaryMatch = matchLines[0];
            const lineNumber = parseInt(primaryMatch.lineNumber) || 0;
            const url = `https://source.chromium.org/chromium/chromium/src/+/main:${filePath};l=${lineNumber}`;
            
            // Build context with all lines in this snippet
            const contextLines = snippetLines.map((line: any) => {
              const lineText = line.lineText || '';
              const hasMatch = line.ranges && line.ranges.length > 0;
              return hasMatch ? `➤ ${lineText}` : `  ${lineText}`;
            }).join('\n');
            
            results.push({
              file: filePath,
              line: lineNumber,
              content: contextLines,
              url: url,
            });
          }
        }
      }
    }

    return results;
  }


  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Set up graceful shutdown
    const gracefulShutdown = async () => {
      this.log('info', 'Received shutdown signal, closing server gracefully');
      try {
        await this.server.close();
        this.log('info', 'Server closed successfully');
        process.exit(0);
      } catch (error: any) {
        this.log('error', 'Error during server shutdown', { error: error.message });
        process.exit(1);
      }
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    
    this.log('info', 'Chromium CodeSearch MCP Server started', { 
      version: packageInfo.version,
      pid: process.pid 
    });
  }
}

// Start the server
const server = new ChromiumCodeSearchServer();
server.run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});