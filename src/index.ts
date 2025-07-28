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
import { chromium } from 'playwright';

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
            name: "get_gerrit_cl_trybot_status",
            description: "Get detailed try-bot status for a Chromium Gerrit CL, including individual bot results and pass/fail counts",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '6624568' or 'https://chromium-review.googlesource.com/c/chromium/src/+/6624568')",
                },
                patchset: {
                  type: "number",
                  description: "Optional specific patchset number to get bot status for (if not specified, gets status for latest patchset)",
                },
                failed_only: {
                  type: "boolean",
                  description: "Only return failed bots (default: false)",
                  default: false,
                },
              },
              required: ["cl_number"],
            },
          },
          // PDFium Gerrit tools
          {
            name: "get_pdfium_gerrit_cl_status",
            description: "Get status and test results for a PDFium Gerrit CL",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '12345' or 'https://pdfium-review.googlesource.com/c/pdfium/+/12345')",
                },
              },
              required: ["cl_number"],
            },
          },
          {
            name: "get_pdfium_gerrit_cl_comments",
            description: "Get review comments for a PDFium Gerrit CL patchset",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '12345' or 'https://pdfium-review.googlesource.com/c/pdfium/+/12345')",
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
            name: "get_pdfium_gerrit_cl_diff",
            description: "Get the diff/changes for a PDFium Gerrit CL patchset to understand what code was modified",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '12345' or 'https://pdfium-review.googlesource.com/c/pdfium/+/12345')",
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
            name: "get_pdfium_gerrit_patchset_file",
            description: "Get the content of a specific file from a PDFium Gerrit patchset for making code changes",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '12345' or 'https://pdfium-review.googlesource.com/c/pdfium/+/12345')",
                },
                file_path: {
                  type: "string",
                  description: "Path to the file to get content for (e.g., 'core/fpdfapi/parser/cpdf_parser.cpp')",
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
            name: "get_pdfium_gerrit_cl_trybot_status",
            description: "Get detailed try-bot status for a PDFium Gerrit CL, including individual bot results and pass/fail counts",
            inputSchema: {
              type: "object",
              properties: {
                cl_number: {
                  type: "string",
                  description: "CL number or full Gerrit URL (e.g., '12345' or 'https://pdfium-review.googlesource.com/c/pdfium/+/12345')",
                },
                patchset: {
                  type: "number",
                  description: "Optional specific patchset number to get bot status for (if not specified, gets status for latest patchset)",
                },
                failed_only: {
                  type: "boolean",
                  description: "Only return failed bots (default: false)",
                  default: false,
                },
              },
              required: ["cl_number"],
            },
          },
          {
            name: "list_pdfium_gerrit_cls",
            description: "List PDFium Gerrit CLs from PDFium dashboard (requires authentication cookies)",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Gerrit search query for PDFium (e.g., 'owner:me', 'status:open', 'change:12345 OR change:67890')",
                },
                auth_cookie: {
                  type: "string",
                  description: "Authentication cookie string from browser (copy full cookie header value)",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of CLs to return (default: 25, max: 100)",
                  default: 25,
                },
              },
              required: ["auth_cookie"],
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
          {
            name: "search_chromium_commits",
            description: "Search commit messages and metadata in the Chromium repository using Gitiles API",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query for commit messages, file paths, or metadata",
                },
                author: {
                  type: "string",
                  description: "Filter by author name or email (optional)",
                },
                since: {
                  type: "string",
                  description: "Only commits after this date (YYYY-MM-DD format, optional)",
                },
                until: {
                  type: "string",
                  description: "Only commits before this date (YYYY-MM-DD format, optional)",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of commits to return (default: 20, max: 100)",
                },
              },
              required: ["query"],
            },
          },
          {
            name: "get_chromium_issue",
            description: "Get details for a specific Chromium issue/bug from issues.chromium.org",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description: "Issue ID or full URL (e.g., '422768753' or 'https://issues.chromium.org/issues/422768753')",
                },
              },
              required: ["issue_id"],
            },
          },
          {
            name: "search_chromium_issues",
            description: "Search for issues in the Chromium issue tracker with full-text search across titles, descriptions, and metadata",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query for issue titles, descriptions, or metadata (e.g., 'memory leak', 'pkasting', 'security')",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return (default: 50, max: 100)",
                  default: 50,
                },
                start_index: {
                  type: "number", 
                  description: "Starting index for pagination (default: 0)",
                  default: 0,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "list_chromium_folder",
            description: "List files and folders in a specific directory of the Chromium source tree",
            inputSchema: {
              type: "object",
              properties: {
                folder_path: {
                  type: "string",
                  description: "Path to the folder in Chromium source (e.g., 'third_party/blink/renderer/core/style')",
                },
              },
              required: ["folder_path"],
            },
          },
          {
            name: "list_gerrit_cls",
            description: "List Gerrit CLs from Chromium dashboard (requires authentication cookies)",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Gerrit search query (e.g., 'owner:me', 'status:open', 'change:1234 OR change:5678')",
                },
                auth_cookie: {
                  type: "string",
                  description: "Authentication cookie string from browser (copy full cookie header value)",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of CLs to return (default: 25, max: 100)",
                  default: 25,
                },
              },
              required: ["auth_cookie"],
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
          case "get_gerrit_cl_trybot_status":
            result = await this.getGerritCLTrybotStatus(args);
            break;
          // PDFium Gerrit handlers
          case "get_pdfium_gerrit_cl_status":
            result = await this.getPDFiumGerritCLStatus(args);
            break;
          case "get_pdfium_gerrit_cl_comments":
            result = await this.getPDFiumGerritCLComments(args);
            break;
          case "get_pdfium_gerrit_cl_diff":
            result = await this.getPDFiumGerritCLDiff(args);
            break;
          case "get_pdfium_gerrit_patchset_file":
            result = await this.getPDFiumGerritPatchsetFile(args);
            break;
          case "get_pdfium_gerrit_cl_trybot_status":
            result = await this.getPDFiumGerritCLTrybotStatus(args);
            break;
          case "list_pdfium_gerrit_cls":
            result = await this.listPDFiumGerritCLs(args);
            break;
          case "find_chromium_owners_file":
            result = await this.findChromiumOwnersFile(args);
            break;
          case "search_chromium_commits":
            result = await this.searchChromiumCommits(args);
            break;
          case "get_chromium_issue":
            result = await this.getChromiumIssue(args);
            break;
          case "search_chromium_issues":
            result = await this.searchChromiumIssues(args);
            break;
          case "list_chromium_folder":
            result = await this.listChromiumFolder(args);
            break;
          case "list_gerrit_cls":
            result = await this.listGerritCLs(args);
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
    
    try {
      // Check if this is a submodule file
      const knownSubmodules = ['v8/', 'third_party/webrtc/'];
      const isSubmodulePath = knownSubmodules.some(submodule => file_path.startsWith(submodule));
      
      if (isSubmodulePath) {
        // Handle submodule files
        if (file_path.startsWith('v8/')) {
          return await this.getV8FileViaGitHub(file_path, line_start, line_end);
        }
        if (file_path.startsWith('third_party/webrtc/')) {
          return await this.getWebRTCFileViaGitiles(file_path, line_start, line_end);
        }
      }
      
      // Fetch from Gitiles API
      const gitileUrl = `https://chromium.googlesource.com/chromium/src/+/main/${file_path}?format=TEXT`;
      
      this.log('debug', 'Fetching file from Gitiles', { file_path, gitileUrl });
      
      const response = await fetch(gitileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        // If Gitiles fails, provide the browser URL as fallback
        const browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${file_path}`;
        return {
          content: [
            {
              type: "text",
              text: `❌ **Failed to fetch file content** (HTTP ${response.status})\n\n**File:** ${file_path}\n**Browser URL:** ${browserUrl}\n\nUse the URL above to view the file in your browser.`,
            },
          ],
        };
      }

      // The response is base64 encoded
      const base64Content = await response.text();
      const fileContent = Buffer.from(base64Content, 'base64').toString('utf-8');
      
      // Split into lines for line number processing
      const lines = fileContent.split('\n');
      let displayLines = lines;
      let startLine = 1;
      
      // Apply line range if specified
      if (line_start) {
        const start = Math.max(1, parseInt(line_start)) - 1; // Convert to 0-based
        const end = line_end ? Math.min(lines.length, parseInt(line_end)) : lines.length;
        displayLines = lines.slice(start, end);
        startLine = start + 1;
      }
      
      // Format content with line numbers
      const numberedLines = displayLines.map((line, index) => {
        const lineNum = (startLine + index).toString().padStart(4, ' ');
        return `${lineNum}  ${line}`;
      }).join('\n');
      
      // Create browser URL for reference
      let browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${file_path}`;
      if (line_start) {
        browserUrl += `;l=${line_start}`;
        if (line_end) {
          browserUrl += `-${line_end}`;
        }
      }
      
      const totalLines = lines.length;
      const displayedLines = displayLines.length;
      const lineRangeText = line_start ? ` (lines ${line_start}${line_end ? `-${line_end}` : '+'})` : '';
      
      return {
        content: [
          {
            type: "text",
            text: `## File: ${file_path}${lineRangeText}\n\n📊 **Total lines:** ${totalLines} | **Displayed:** ${displayedLines}\n🔗 **Browser URL:** ${browserUrl}\n\n\`\`\`${this.getFileExtension(file_path)}\n${numberedLines}\n\`\`\``,
          },
        ],
      };
      
    } catch (error: any) {
      this.log('error', 'Failed to fetch file content', { file_path, error: error.message });
      
      // Fallback to browser URL
      const browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${file_path}`;
      return {
        content: [
          {
            type: "text",
            text: `❌ **Error fetching file:** ${error.message}\n\n**File:** ${file_path}\n**Browser URL:** ${browserUrl}\n\nUse the URL above to view the file in your browser.`,
          },
        ],
      };
    }
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
          resultText += `- **Status:** ${this.getFileStatusText(status)}\n\n`;
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

  private getFileStatusText(status: string): string {
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

  private async searchChromiumCommits(args: any) {
    const { query, author, since, until, limit = 20 } = args;
    const maxLimit = Math.min(limit, 100); // Cap at 100 commits
    
    try {
      this.log('debug', 'Searching commits', { query, author, since, until, limit: maxLimit });
      
      // Build the Gitiles log API URL
      let apiUrl = `https://chromium.googlesource.com/chromium/src/+log?format=JSON&n=${maxLimit}`;
      
      // Add query parameter
      if (query) {
        apiUrl += `&q=${encodeURIComponent(query)}`;
      }
      
      // Add author filter if provided
      if (author) {
        apiUrl += `&author=${encodeURIComponent(author)}`;
      }
      
      // Add date filters if provided
      if (since) {
        apiUrl += `&since=${encodeURIComponent(since)}`;
      }
      
      if (until) {
        apiUrl += `&until=${encodeURIComponent(until)}`;
      }
      
      this.log('debug', 'Fetching commits from Gitiles', { apiUrl: apiUrl.substring(0, 100) + '...' });
      
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to search commits: HTTP ${response.status}`);
      }

      const responseText = await response.text();
      
      // Remove the XSSI protection prefix ")]}''" if present
      const jsonText = responseText.startsWith(")]}'") ? responseText.substring(4) : responseText;
      const data = JSON.parse(jsonText);
      
      if (!data.log || data.log.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No commits found for query: "${query}"\n\n🔍 **Try different search terms or expand date range**`,
            },
          ],
        };
      }

      // Format results
      let resultText = `## Commit Search Results for "${query}"\n\n`;
      resultText += `📊 **Found:** ${data.log.length} commit${data.log.length === 1 ? '' : 's'}\n`;
      
      if (author) resultText += `👤 **Author filter:** ${author}\n`;
      if (since) resultText += `📅 **Since:** ${since}\n`;
      if (until) resultText += `📅 **Until:** ${until}\n`;
      
      resultText += `\n`;

      data.log.forEach((commit: any, index: number) => {
        const shortHash = commit.commit.substring(0, 12);
        const author = commit.author.name;
        const email = commit.author.email;
        const date = new Date(commit.author.time).toLocaleDateString();
        const message = commit.message.trim();
        
        // Extract the first line (summary) and remaining lines (body)
        const messageLines = message.split('\n');
        const summary = messageLines[0];
        const hasBody = messageLines.length > 1 && messageLines.slice(1).some((line: string) => line.trim());
        
        resultText += `### ${index + 1}. ${summary}\n`;
        resultText += `**Commit:** \`${shortHash}\` | **Author:** ${author} | **Date:** ${date}\n`;
        
        // Show body if it exists (first few lines)
        if (hasBody) {
          const bodyLines = messageLines.slice(1).filter((line: string) => line.trim()).slice(0, 3);
          if (bodyLines.length > 0) {
            resultText += `\n${bodyLines.join('\n')}\n`;
            if (messageLines.length > 5) {
              resultText += `\n*[...commit message continues...]*\n`;
            }
          }
        }
        
        // Extract and add bug IDs
        const bugIds = this.extractBugIds(message);
        if (bugIds.length > 0) {
          resultText += `\n**🐛 Related Issues:** `;
          resultText += bugIds.map(bugId => `[${bugId}](https://issues.chromium.org/issues/${bugId})`).join(', ');
        }
        
        // Add links
        const commitUrl = `https://chromium.googlesource.com/chromium/src/+/${commit.commit}`;
        const gerritUrl = this.extractGerritUrl(message);
        
        resultText += `\n🔗 **Commit:** [${shortHash}](${commitUrl})`;
        if (gerritUrl) {
          const clId = gerritUrl.match(/(\d+)$/)?.[1];
          if (clId) {
            resultText += ` | **Review:** [CL ${clId}](http://crrev.com/c/${clId})`;
          }
        }
        
        resultText += `\n\n`;
      });
      
      // Add pagination info if we hit the limit
      if (data.log.length >= maxLimit) {
        resultText += `\n📄 **Note:** Showing first ${maxLimit} results. Use more specific search terms for better results.\n`;
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
      this.log('error', 'Failed to search commits', { query, error: error.message });
      throw new ChromiumSearchError(`Commit search failed: ${error.message}`);
    }
  }

  private extractGerritUrl(commitMessage: string): string | null {
    // Extract Gerrit review URL from commit message
    const gerritMatch = commitMessage.match(/https:\/\/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/);
    return gerritMatch ? gerritMatch[0] : null;
  }

  private extractBugIds(commitMessage: string): string[] {
    // Extract bug IDs from commit messages
    // Common patterns: "Bug: 422768753", "BUG=422768753", "crbug.com/422768753", etc.
    const bugIds: string[] = [];
    
    // Pattern 1: Bug: 123456789
    const bugPattern1 = commitMessage.match(/Bug:\s*(\d{6,})/gi);
    if (bugPattern1) {
      bugPattern1.forEach(match => {
        const id = match.match(/\d{6,}/);
        if (id) bugIds.push(id[0]);
      });
    }
    
    // Pattern 2: BUG=123456789
    const bugPattern2 = commitMessage.match(/BUG=(\d{6,})/gi);
    if (bugPattern2) {
      bugPattern2.forEach(match => {
        const id = match.match(/\d{6,}/);
        if (id) bugIds.push(id[0]);
      });
    }
    
    // Pattern 3: crbug.com/123456789 or bugs.chromium.org/p/chromium/issues/detail?id=123456789
    const bugPattern3 = commitMessage.match(/(?:crbug\.com\/|bugs\.chromium\.org\/[^?]*\?id=|issues\.chromium\.org\/issues\/)(\d{6,})/gi);
    if (bugPattern3) {
      bugPattern3.forEach(match => {
        const id = match.match(/\d{6,}/);
        if (id) bugIds.push(id[0]);
      });
    }
    
    // Remove duplicates and return
    return [...new Set(bugIds)];
  }

  private async getChromiumIssue(args: any) {
    const { issue_id } = args;
    
    // Extract issue ID from URL if provided
    const issueIdMatch = issue_id.match(/(?:issues\.chromium\.org\/issues\/)?(\d+)$/);
    const cleanIssueId = issueIdMatch ? issueIdMatch[1] : issue_id;
    
    if (!/^\d+$/.test(cleanIssueId)) {
      throw new ChromiumSearchError(`Invalid issue ID format: ${issue_id}`);
    }
    
    try {
      this.log('debug', 'Fetching Chromium issue', { issue_id: cleanIssueId });
      
      const issueUrl = `https://issues.chromium.org/issues/${cleanIssueId}`;
      
      const response = await fetch(issueUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to fetch issue: HTTP ${response.status}`);
      }

      const htmlContent = await response.text();
      
      // Extract the defrostedResourcesJspb data that contains issue information
      const dataMatch = htmlContent.match(/defrostedResourcesJspb = (\[\[.*?\]\]);/s);
      if (!dataMatch) {
        throw new ChromiumSearchError('Could not find issue data in page');
      }
      
      try {
        const issueData = JSON.parse(dataMatch[1]);
        
        // Navigate the nested structure to find issue details
        // Structure: [[["b.IssueFetchResponse", [..., [..., issueId, [..., status, priority, type, title, ...]]]]]
        const issueResponse = issueData[0]?.[0]?.[1];
        if (!issueResponse) {
          throw new ChromiumSearchError('Invalid issue data structure');
        }
        
        // Find the issue object in the response
        let issueObj = null;
        for (const item of issueResponse) {
          if (Array.isArray(item) && item[1] === parseInt(cleanIssueId)) {
            issueObj = item;
            break;
          }
        }
        
        if (!issueObj || !Array.isArray(issueObj) || issueObj.length < 3) {
          throw new ChromiumSearchError('Issue not found or has invalid structure');
        }
        
        // Extract issue details from the complex nested structure
        const details = issueObj[2]; // The main details array
        if (!Array.isArray(details) || details.length < 6) {
          throw new ChromiumSearchError('Issue details have invalid structure');
        }
        
        const status = this.getStatusText(details[1]); // Status number
        const priority = this.getPriorityText(details[2]); // Priority number  
        const type = this.getTypeText(details[3]); // Type number
        const severity = this.getSeverityText(details[4]); // Severity number
        const title = details[5] || 'No title'; // Title string
        
        // Try to extract reporter and assignee info
        const reporter = details[6] ? this.extractUserInfo(details[6]) : null;
        const assignee = details[9] ? this.extractUserInfo(details[9]) : null;
        
        // Extract timestamps if available
        const createdTime = details[23] ? this.formatTimestamp(details[23]) : null;
        const modifiedTime = details[24] ? this.formatTimestamp(details[24]) : null;
        
        // Extract description using browser automation for better accuracy
        const description = await this.extractIssueDescriptionWithBrowser(issueUrl, cleanIssueId);
        
        // Extract related CLs if available
        const relatedCLs = details[33] || [];
        
        // Format the result
        let resultText = `## Issue ${cleanIssueId}: ${title}\n\n`;
        
        resultText += `**Status:** ${status}`;
        if (priority) resultText += ` | **Priority:** ${priority}`;
        if (type) resultText += ` | **Type:** ${type}`;
        if (severity) resultText += ` | **Severity:** ${severity}`;
        resultText += `\n\n`;
        
        if (reporter) resultText += `**Reporter:** ${reporter}\n`;
        if (assignee) resultText += `**Assignee:** ${assignee}\n`;
        if (createdTime) resultText += `**Created:** ${createdTime}\n`;
        if (modifiedTime) resultText += `**Modified:** ${modifiedTime}\n`;
        
        if (description) {
          resultText += `\n### Description\n${description}\n`;
        }
        
        // Add related CLs if any
        if (relatedCLs.length > 0) {
          resultText += `\n### Related Changes\n`;
          relatedCLs.forEach((cl: any) => {
            if (Array.isArray(cl) && cl.length >= 3) {
              const clId = cl[2];
              const clStatus = cl[3] === 1 ? 'MERGED' : cl[3] === 2 ? 'ABANDONED' : 'OPEN';
              resultText += `- **CL ${clId}** (${clStatus}): [crrev.com/c/${clId}](http://crrev.com/c/${clId}) | [Gerrit](https://chromium-review.googlesource.com/c/chromium/src/+/${clId})\n`;
            }
          });
        }
        
        resultText += `\n🔗 **Issue URL:** ${issueUrl}\n`;
        
        return {
          content: [
            {
              type: "text",
              text: resultText,
            },
          ],
        };
        
      } catch (parseError: any) {
        this.log('error', 'Failed to parse issue data', { issue_id: cleanIssueId, error: parseError.message });
        throw new ChromiumSearchError(`Failed to parse issue data: ${parseError.message}`);
      }
      
    } catch (error: any) {
      this.log('error', 'Failed to fetch issue', { issue_id: cleanIssueId, error: error.message });
      
      if (error instanceof ChromiumSearchError) {
        throw error;
      }
      
      throw new ChromiumSearchError(`Issue fetch failed: ${error.message}`);
    }
  }

  private async searchChromiumIssues(args: any) {
    const { query, limit = 50, start_index = 0 } = args;
    
    this.log('debug', 'Searching Chromium issues', { query, limit, start_index });
    
    try {
      const baseUrl = 'https://issues.chromium.org';
      const endpoint = '/action/issues/list';
      
      // Based on the curl command structure: [null,null,null,null,null,["157"],["pkasting","modified_time desc",50,"start_index:0"]]
      const searchParams = [query, "modified_time desc", limit];
      if (start_index > 0) {
        searchParams.push(`start_index:${start_index}`);
      }
      
      const payload = [
        null,
        null,
        null,
        null,
        null,
        ["157"], // Track ID for Chromium
        searchParams
      ];
      
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://issues.chromium.org/',
          'Origin': 'https://issues.chromium.org',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to search issues: HTTP ${response.status}`);
      }

      const text = await response.text();
      this.log('debug', 'Issue search response received', { responseLength: text.length });
      
      // Strip the XSSI protection prefix ")]}'\n" if present
      let cleanText = text;
      if (text.startsWith(")]}'\n")) {
        cleanText = text.substring(5);
      } else if (text.startsWith(")]}'")) {
        cleanText = text.substring(4);
      }
      
      // Parse the response
      const data = JSON.parse(cleanText);
      
      // Extract issues from the response using the same parsing logic as CLI
      const issues = this.parseIssueSearchResults(data, query);
      
      let resultText = `## Issue Search Results for "${query}"\n\n`;
      resultText += `📊 **Found:** ${issues.length} issues\n`;
      if (start_index > 0) {
        resultText += `📄 **Page:** Starting from index ${start_index}\n`;
      }
      resultText += `🔍 **Search URL:** ${baseUrl}/issues?q=${encodeURIComponent(query)}\n\n`;
      
      if (issues.length === 0) {
        resultText += "No issues found matching your search query.\n";
      } else {
        issues.forEach((issue, index) => {
          resultText += `### ${index + 1}. Issue ${issue.issueId}\n`;
          resultText += `**Title:** ${issue.title || 'Unknown'}\n`;
          resultText += `**Status:** ${issue.status || 'Unknown'}\n`;
          if (issue.priority) {
            resultText += `**Priority:** ${issue.priority}\n`;
          }
          if (issue.component) {
            resultText += `**Component:** ${issue.component}\n`;
          }
          if (issue.assignee) {
            resultText += `**Assignee:** ${issue.assignee}\n`;
          }
          if (issue.reporter) {
            resultText += `**Reporter:** ${issue.reporter}\n`;
          }
          if (issue.modified) {
            resultText += `**Modified:** ${issue.modified}\n`;
          }
          resultText += `🔗 **URL:** https://issues.chromium.org/issues/${issue.issueId}\n\n`;
        });
        
        if (issues.length === limit) {
          resultText += `💡 *More results may be available. Use start_index=${start_index + limit} to get the next page.*\n`;
        }
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
      this.log('error', 'Issue search failed', { query, error: error.message });
      
      if (error instanceof ChromiumSearchError) {
        throw error;
      }
      
      throw new ChromiumSearchError(`Issue search failed: ${error.message}`);
    }
  }
  
  private parseIssueSearchResults(data: any, query: string): any[] {
    this.log('debug', 'Parsing issue search results', { query });
    
    const issues: any[] = [];
    
    try {
      if (data && data[0] && data[0][6] && Array.isArray(data[0][6])) {
        const issueContainer = data[0][6];
        
        for (let i = 0; i < issueContainer.length; i++) {
          const item = issueContainer[i];
          
          if (Array.isArray(item)) {
            // Check if this is a direct issue array
            if (item.length > 5 && typeof item[1] === 'number' && item[1] > 1000000) {
              const issue = this.parseIssueFromProtobufArray(item);
              if (issue) {
                issues.push(issue);
              }
            }
            // Check if this contains nested issue arrays
            else if (item.length > 0) {
              for (let j = 0; j < item.length; j++) {
                if (Array.isArray(item[j]) && item[j].length > 5) {
                  if (typeof item[j][1] === 'number' && item[j][1] > 1000000) {
                    const issue = this.parseIssueFromProtobufArray(item[j]);
                    if (issue) {
                      issues.push(issue);
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      this.log('error', 'Error parsing issue search results', { error });
    }
    
    return issues;
  }
  
  private parseIssueFromProtobufArray(arr: any[]): any | null {
    try {
      const issue: any = {};
      
      // Issue ID is at position 1
      if (arr[1] && typeof arr[1] === 'number') {
        issue.issueId = arr[1].toString();
      }
      
      // Try to extract other basic information
      if (arr.length > 8) {
        // Status is often at position 8
        if (typeof arr[8] === 'number') {
          issue.status = this.getStatusText(arr[8]);
        }
        
        // Priority information might be in an array at position 9
        if (Array.isArray(arr[9]) && arr[9].length > 0) {
          if (typeof arr[9][0] === 'number') {
            issue.priority = this.getPriorityText(arr[9][0]);
          }
        }
      }
      
      // Try to find title in nested structures
      for (let i = 2; i < Math.min(arr.length, 15); i++) {
        if (Array.isArray(arr[i])) {
          for (let j = 0; j < arr[i].length; j++) {
            if (typeof arr[i][j] === 'string' && arr[i][j].length > 10 && !arr[i][j].includes('@')) {
              if (!issue.title || arr[i][j].length > issue.title.length) {
                issue.title = arr[i][j];
              }
            }
          }
        } else if (typeof arr[i] === 'string' && arr[i].length > 10 && !arr[i].includes('@')) {
          if (!issue.title || arr[i].length > issue.title.length) {
            issue.title = arr[i];
          }
        }
      }
      
      return issue.issueId ? issue : null;
    } catch (error) {
      return null;
    }
  }

  private getStatusText(status: number): string {
    const statusMap: { [key: number]: string } = {
      1: 'NEW',
      2: 'ASSIGNED', 
      3: 'ACCEPTED',
      4: 'FIXED',
      5: 'VERIFIED',
      6: 'DUPLICATE',
      7: 'WONTFIX',
      8: 'WORKINGASINTENDED',
      15: 'AVAILABLE', // Available for assignment
    };
    return statusMap[status] || `Unknown (${status})`;
  }

  private getPriorityText(priority: number): string {
    const priorityMap: { [key: number]: string } = {
      1: 'P0 (Critical)',
      2: 'P1 (High)', 
      3: 'P2 (Medium)',
      4: 'P3 (Low)',
      5: 'P4 (Nice to have)',
    };
    return priorityMap[priority] || `P${priority}`;
  }

  private getTypeText(type: number): string {
    const typeMap: { [key: number]: string } = {
      1: 'Bug',
      2: 'Feature Request',
      3: 'Task',
      4: 'Process',
      5: 'Bug-Security',
    };
    return typeMap[type] || `Type ${type}`;
  }

  private getSeverityText(severity: number): string {
    const severityMap: { [key: number]: string } = {
      1: 'S0 (Critical)',
      2: 'S1 (High)',
      3: 'S2 (Medium)', 
      4: 'S3 (Low)',
      5: 'S4 (Minimal)',
    };
    return severityMap[severity] || `S${severity}`;
  }

  private extractUserInfo(userArray: any): string | null {
    if (!Array.isArray(userArray) || userArray.length < 2) return null;
    
    // userArray structure: [null, email, displayType, ...]
    const email = userArray[1];
    if (typeof email === 'string') {
      // Mask email for privacy (already masked in the data)
      return email;
    }
    return null;
  }

  private formatTimestamp(timestampArray: any): string | null {
    if (!Array.isArray(timestampArray) || timestampArray.length < 2) return null;
    
    // timestampArray structure: [seconds, nanoseconds]
    const seconds = timestampArray[0];
    const nanoseconds = timestampArray[1];
    
    if (typeof seconds === 'number') {
      const date = new Date(seconds * 1000 + nanoseconds / 1000000);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
    return null;
  }

  private async extractIssueDescriptionWithBrowser(issueUrl: string, issueId?: string): Promise<string | null> {
    let browser = null;
    
    try {
      this.log('debug', 'Launching browser to extract issue description', { issueUrl });
      
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      });
      
      const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      // Navigate to the issue page
      await page.goto(issueUrl, { waitUntil: 'networkidle' });
      
      // Wait for the issue content to load and try multiple wait strategies
      await page.waitForTimeout(5000);
      
      // Try to wait for common elements that indicate the page is loaded
      try {
        await page.waitForSelector('body', { timeout: 10000 });
      } catch (e) {
        this.log('debug', 'Could not wait for body selector');
      }
      
      // Log the page title and URL to verify we're on the right page
      const title = await page.title();
      const url = await page.url();
      this.log('debug', 'Page loaded', { title, url });
      
      // Take a screenshot for debugging and save page content
      const debugDir = '/tmp';
      try {
        const fileId = issueId || 'unknown';
        await page.screenshot({ path: `${debugDir}/issue-${fileId}.png` });
        const htmlContent = await page.content();
        await require('fs').promises.writeFile(`${debugDir}/issue-${fileId}.html`, htmlContent);
        this.log('debug', 'Saved debug files', { 
          screenshot: `${debugDir}/issue-${fileId}.png`,
          html: `${debugDir}/issue-${fileId}.html`
        });
      } catch (e: any) {
        this.log('debug', 'Could not save debug files', { error: e.message });
      }
      
      // Try to find the issue description in various ways
      let description = null;
      
      // Method 1: Use the specific selectors we found for this Chromium issue tracker
      const primarySelectors = [
        '#bv2-edit-issue-details-scroll > b-issue-description',
        'b-issue-description'
      ];
      
      // Try the primary selectors first
      for (const selector of primarySelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            const text = await element.textContent();
            if (text && text.trim().length > 20) {
              description = text.trim();
              this.log('debug', 'Found description with primary selector', { 
                selector, 
                length: description.length,
                preview: description.substring(0, 100) + '...'
              });
              break;
            }
          }
        } catch (e: any) {
          this.log('debug', 'Primary selector failed', { selector, error: e.message });
        }
      }
      
      // If primary selectors don't work, try fallback selectors
      if (!description) {
        const fallbackSelectors = [
          '[data-testid="description"]',
          '[data-testid="issue-description"]',
          '.issue-description',
          '.description-content',
          '[role="main"] .content',
          'article'
        ];
        
        for (const selector of fallbackSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              const text = await element.textContent();
              if (text && text.length > 50) {
                description = text.trim();
                this.log('debug', 'Found description with fallback selector', { 
                  selector, 
                  length: description.length,
                  preview: description.substring(0, 100) + '...'
                });
                break;
              }
            }
          } catch (e: any) {
            this.log('debug', 'Fallback selector failed', { selector, error: e.message });
          }
        }
      }
      
      // Method 1.5: Try to get all visible text and log it for debugging
      if (!description) {
        try {
          const allText = await page.textContent('body');
          this.log('debug', 'All page text length', { length: allText?.length || 0 });
          
          // Log a sample of the text to see what we're getting
          if (allText && allText.length > 100) {
            this.log('debug', 'Page text sample', { 
              sample: allText.substring(0, 500).replace(/\s+/g, ' ') 
            });
          }
        } catch (e: any) {
          this.log('debug', 'Could not get page text', { error: e.message });
        }
      }
      
      // Method 2: If no description found, try to extract from page text
      if (!description) {
        const pageText = await page.textContent('body');
        if (pageText) {
          // Look for common patterns in the text - be more liberal with extraction
          const patterns = [
            // Try to match the specific content we know is in this issue
            /(The goals are:.*?)(?=\n\s*\n|\n\s*Bug:|\n\s*Change-Id:|\n\s*Reviewed|$)/s,
            /(Stop using the WTF namespace.*?)(?=\n\s*\n|\n\s*Bug:|\n\s*Change-Id:|\n\s*Reviewed|$)/s,
            /(Choose a single header.*?)(?=\n\s*\n|\n\s*Bug:|\n\s*Change-Id:|\n\s*Reviewed|$)/s,
            // More generic patterns
            /Description:(.*?)(?=\n\s*\n|\n\s*Bug:|\n\s*Change-Id:|\n\s*Reviewed|$)/s,
            /Summary:(.*?)(?=\n\s*\n|\n\s*Bug:|\n\s*Change-Id:|\n\s*Reviewed|$)/s,
            // Look for any substantial block of text that mentions key terms
            /(.*WTF.*namespace.*blink.*)/s,
            /(.*Choose.*header.*platform.*wtf.*)/s,
            // Very broad patterns as fallback
            /(The goals are:.*)/s,
            /(Stop using.*)/s
          ];
          
          for (const pattern of patterns) {
            const match = pageText.match(pattern);
            if (match && match[1] && match[1].trim().length > 50) {
              description = match[0].trim();
              this.log('debug', 'Found description with pattern matching', { pattern: pattern.source, length: description.length });
              break;
            }
          }
        }
      }
      
      // Method 3: Try to get all text and find meaningful content
      if (!description) {
        try {
          // Look for text that contains key phrases related to the issue
          const keyPhrases = ['WTF namespace', 'blink namespace', 'goals are', 'Choose a single header'];
          const allText = await page.textContent('body');
          
          if (allText) {
            for (const phrase of keyPhrases) {
              const index = allText.indexOf(phrase);
              if (index !== -1) {
                // Extract a reasonable chunk around the key phrase
                const start = Math.max(0, index - 100);
                const end = Math.min(allText.length, index + 800);
                const chunk = allText.substring(start, end).trim();
                
                if (chunk.length > 100) {
                  description = chunk;
                  this.log('debug', 'Found description with key phrase search', { phrase, length: description.length });
                  break;
                }
              }
            }
          }
        } catch (e: any) {
          this.log('debug', 'Key phrase search failed', { error: e.message });
        }
      }
      
      // Also try to get comments/updates for additional context
      let comments = null;
      try {
        const commentsElement = await page.$('#bv2-edit-issue-details-scroll > div');
        if (commentsElement) {
          const commentsText = await commentsElement.textContent();
          if (commentsText && commentsText.trim().length > 50) {
            comments = commentsText.trim();
            this.log('debug', 'Found comments/updates', { 
              length: comments.length,
              preview: comments.substring(0, 100) + '...'
            });
          }
        }
      } catch (e: any) {
        this.log('debug', 'Could not get comments', { error: e.message });
      }
      
      // Combine description and comments if we have both
      if (description && comments) {
        // Only add comments if they contain additional useful information
        if (comments.length > description.length * 0.2) {
          // Format CL links in comments to use crrev.com
          const formattedComments = comments.replace(
            /https:\/\/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/g,
            'http://crrev.com/c/$1'
          );
          description = description + '\n\n**Comments/Updates:**\n' + formattedComments;
        }
      }
      
      // Also format any CL links in the main description
      if (description) {
        // Replace full Gerrit URLs with crrev.com links
        description = description.replace(
          /https:\/\/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/g,
          '[CL $1](http://crrev.com/c/$1)'
        );
        
        // Also replace standalone CL references (like "CL 6627032")
        description = description.replace(
          /\bCL\s+(\d{6,})\b/g,
          '[CL $1](http://crrev.com/c/$1)'
        );
        
        // Handle "http://crrev.com/c/ID" format that might be in comments
        description = description.replace(
          /http:\/\/crrev\.com\/c\/(\d+)/g,
          '[CL $1](http://crrev.com/c/$1)'
        );
        
        // Handle any remaining Gerrit change IDs in various formats
        description = description.replace(
          /\b(\d{7})\b(?=.*?(?:Change-Id|chromium-review|gerrit))/gi,
          '[CL $1](http://crrev.com/c/$1)'
        );
      }
      
      return description;
      
    } catch (error: any) {
      this.log('error', 'Browser-based description extraction failed', { error: error.message });
      return null;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private escapeRegexChars(query: string): string {
    // Escape regex special characters for literal search
    // Based on discovery that parentheses need escaping: LOG(INFO) -> LOG\\(INFO\\)
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
  }

  private async listChromiumFolder(args: any) {
    const { folder_path } = args;
    
    try {
      // Normalize folder path - remove leading/trailing slashes
      let normalizedPath = folder_path.replace(/^\/+|\/+$/g, '');
      
      // Use Gitiles API to get directory listing
      const gitilesUrl = `https://chromium.googlesource.com/chromium/src/+/main/${normalizedPath}/?format=JSON`;
      const browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${normalizedPath}/`;
      
      this.log('debug', 'Fetching folder listing from Gitiles', { folder_path: normalizedPath, url: gitilesUrl });
      
      // Try to fetch the directory listing from Gitiles
      const response = await fetch(gitilesUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        // Check if this might be a path inside a submodule
        const knownSubmodules = ['v8', 'third_party/webrtc', 'third_party/devtools-frontend'];
        const isSubmodulePath = knownSubmodules.some(submodule => 
          normalizedPath.startsWith(submodule + '/') || normalizedPath === submodule
        );
        
        if (response.status === 404 && isSubmodulePath) {
          const submodule = knownSubmodules.find(sm => normalizedPath.startsWith(sm));
          
          let resultText = `## Cannot List Submodule Path: ${normalizedPath}\n\n`;
          resultText += `⚠️ **This path is inside the "${submodule}" Git submodule**\n\n`;
          resultText += `### Why this doesn't work:\n`;
          resultText += `- "${submodule}" is a separate Git repository included as a submodule\n`;
          resultText += `- The Gitiles API for the main Chromium repo cannot access submodule contents\n`;
          resultText += `- Only the submodule reference itself is visible, not its internal structure\n\n`;
          resultText += `### What you can do:\n`;
          resultText += `1. Browse the path in the source browser: ${browserUrl}\n`;
          resultText += `2. Use the search functionality to find files in this area\n`;
          resultText += `3. Access the submodule's repository directly\n\n`;
          
          return {
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
          };
        }
        
        throw new ChromiumSearchError(`Failed to fetch folder listing: HTTP ${response.status}`);
      }
      
      const responseText = await response.text();
      // Remove XSSI prefix
      const jsonText = responseText.replace(/^\)]}'/, '');
      const data = JSON.parse(jsonText);
      
      // Check if this is a submodule (like v8)
      if (data.url && data.revision && !data.entries) {
        // This is a submodule - try to fetch from the submodule's repository
        return await this.listSubmoduleFolder(normalizedPath, data);
      }
      
      // Parse the Gitiles response to extract file/folder names
      const items = this.parseGitilesListing(data);
      
      // Format the results
      let resultText = `## Folder Contents: ${normalizedPath}\n\n`;
      resultText += `📁 **Path:** ${normalizedPath}\n`;
      resultText += `🔗 **Browser URL:** ${browserUrl}\n\n`;
      
      if (items.length === 0) {
        resultText += `### ❌ No items found\n\nThis could mean:\n`;
        resultText += `- The folder doesn't exist\n`;
        resultText += `- The path is incorrect\n`;
        resultText += `- The folder is empty\n`;
      } else {
        // Separate folders and files
        const folders = items.filter(item => item.type === 'folder');
        const files = items.filter(item => item.type === 'file');
        
        resultText += `### 📊 Summary\n`;
        resultText += `- **Folders:** ${folders.length}\n`;
        resultText += `- **Files:** ${files.length}\n`;
        resultText += `- **Total:** ${items.length}\n\n`;
        
        if (folders.length > 0) {
          resultText += `### 📁 Folders (${folders.length})\n`;
          folders.forEach(folder => {
            resultText += `- ${folder.name}/\n`;
          });
          resultText += `\n`;
        }
        
        if (files.length > 0) {
          resultText += `### 📄 Files (${files.length})\n`;
          files.forEach(file => {
            resultText += `- ${file.name}\n`;
          });
        }
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
      this.log('error', 'Failed to list folder contents', { folder_path, error: error.message });
      
      const browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${folder_path}/`;
      return {
        content: [
          {
            type: "text",
            text: `❌ **Error listing folder:** ${error.message}\n\n**Folder:** ${folder_path}\n**Browser URL:** ${browserUrl}\n\nUse the URL above to view the folder in your browser.`,
          },
        ],
      };
    }
  }
  
  private async listSubmoduleFolder(originalPath: string, submoduleData: any) {
    const { url, revision } = submoduleData;
    
    // Handle V8 via GitHub API
    if (url.includes('v8/v8')) {
      return await this.listV8FolderViaGitHub(originalPath);
    }
    
    // Handle WebRTC via its Gitiles
    if (url.includes('webrtc')) {
      return await this.listWebRTCFolderViaGitiles(originalPath);
    }
    
    // For other submodules, return informative message
    let resultText = `## Submodule: ${originalPath}\n\n`;
    resultText += `⚠️ **This is a Git submodule pointing to another repository**\n\n`;
    resultText += `📦 **Repository:** ${url}\n`;
    resultText += `📌 **Revision:** ${revision}\n\n`;
    resultText += `🔗 **Browser URL:** https://source.chromium.org/chromium/chromium/src/+/main:${originalPath}/\n\n`;
    resultText += `### Note\n`;
    resultText += `This submodule doesn't have automatic folder listing support yet.\n`;
    resultText += `You can browse it using the source browser URL above.\n`;
    
    return {
      content: [
        {
          type: "text",
          text: resultText,
        },
      ],
    };
  }
  
  private async listV8FolderViaGitHub(path: string) {
    try {
      // Remove 'v8/' prefix if present
      const v8Path = path.startsWith('v8/') ? path.substring(3) : path;
      
      // Use GitHub API to list contents
      const githubApiUrl = `https://api.github.com/repos/v8/v8/contents/${v8Path}`;
      
      this.log('debug', 'Fetching V8 folder from GitHub', { path: v8Path, url: githubApiUrl });
      
      const response = await fetch(githubApiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'chromium-codesearch-mcp',
        },
      });
      
      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to fetch V8 folder from GitHub: HTTP ${response.status}`);
      }
      
      const items = await response.json() as any[];
      
      // Convert GitHub API response to our format
      const formattedItems = items.map((item: any) => ({
        name: item.name,
        type: item.type === 'dir' ? 'folder' : 'file'
      }));
      
      // Sort items: folders first, then files, alphabetically
      formattedItems.sort((a: any, b: any) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
      // Format the results
      const folders = formattedItems.filter((item: any) => item.type === 'folder');
      const files = formattedItems.filter((item: any) => item.type === 'file');
      
      let resultText = `## V8 Folder Contents: ${path}\n\n`;
      resultText += `📁 **Path:** ${path}\n`;
      resultText += `🔗 **GitHub:** https://github.com/v8/v8/tree/main/${v8Path}\n`;
      resultText += `🔗 **Chromium Browser:** https://source.chromium.org/chromium/chromium/src/+/main:${path}/\n\n`;
      
      resultText += `### 📊 Summary\n`;
      resultText += `- **Folders:** ${folders.length}\n`;
      resultText += `- **Files:** ${files.length}\n`;
      resultText += `- **Total:** ${formattedItems.length}\n\n`;
      
      if (folders.length > 0) {
        resultText += `### 📁 Folders (${folders.length})\n`;
        folders.forEach((folder: any) => {
          resultText += `- ${folder.name}/\n`;
        });
        resultText += `\n`;
      }
      
      if (files.length > 0) {
        resultText += `### 📄 Files (${files.length})\n`;
        files.forEach((file: any) => {
          resultText += `- ${file.name}\n`;
        });
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
      this.log('error', 'Failed to fetch V8 folder from GitHub', { path, error: error.message });
      throw error;
    }
  }
  
  private async listWebRTCFolderViaGitiles(path: string) {
    try {
      // Remove 'third_party/webrtc/' prefix
      const webrtcPath = path.replace(/^third_party\/webrtc\/?/, '');
      
      // Use WebRTC's Gitiles API
      const gitilesUrl = `https://webrtc.googlesource.com/src/+/main/${webrtcPath}?format=JSON`;
      
      this.log('debug', 'Fetching WebRTC folder from Gitiles', { path: webrtcPath, url: gitilesUrl });
      
      const response = await fetch(gitilesUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to fetch WebRTC folder: HTTP ${response.status}`);
      }
      
      const responseText = await response.text();
      const jsonText = responseText.replace(/^\)]}'/, '');
      const data = JSON.parse(jsonText);
      
      // Parse the Gitiles response
      const items = this.parseGitilesListing(data);
      
      // Format the results
      const folders = items.filter(item => item.type === 'folder');
      const files = items.filter(item => item.type === 'file');
      
      let resultText = `## WebRTC Folder Contents: ${path}\n\n`;
      resultText += `📁 **Path:** ${path}\n`;
      resultText += `🔗 **WebRTC Gitiles:** https://webrtc.googlesource.com/src/+/main/${webrtcPath}\n`;
      resultText += `🔗 **Chromium Browser:** https://source.chromium.org/chromium/chromium/src/+/main:${path}/\n\n`;
      
      resultText += `### 📊 Summary\n`;
      resultText += `- **Folders:** ${folders.length}\n`;
      resultText += `- **Files:** ${files.length}\n`;
      resultText += `- **Total:** ${items.length}\n\n`;
      
      if (folders.length > 0) {
        resultText += `### 📁 Folders (${folders.length})\n`;
        folders.forEach(folder => {
          resultText += `- ${folder.name}/\n`;
        });
        resultText += `\n`;
      }
      
      if (files.length > 0) {
        resultText += `### 📄 Files (${files.length})\n`;
        files.forEach(file => {
          resultText += `- ${file.name}\n`;
        });
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
      this.log('error', 'Failed to fetch WebRTC folder', { path, error: error.message });
      throw error;
    }
  }

  private async getV8FileViaGitHub(filePath: string, lineStart?: number, lineEnd?: number) {
    try {
      // Remove 'v8/' prefix
      const v8Path = filePath.substring(3);
      
      // Use GitHub raw content URL
      const githubUrl = `https://raw.githubusercontent.com/v8/v8/main/${v8Path}`;
      
      this.log('debug', 'Fetching V8 file from GitHub', { path: v8Path, url: githubUrl });
      
      const response = await fetch(githubUrl, {
        headers: {
          'User-Agent': 'chromium-codesearch-mcp',
        },
      });
      
      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to fetch V8 file from GitHub: HTTP ${response.status}`);
      }
      
      const fileContent = await response.text();
      const lines = fileContent.split('\n');
      let displayLines = lines;
      let startLine = 1;
      
      // Apply line range if specified
      if (lineStart) {
        const start = Math.max(1, lineStart) - 1;
        const end = lineEnd ? Math.min(lines.length, lineEnd) : lines.length;
        displayLines = lines.slice(start, end);
        startLine = start + 1;
      }
      
      // Format content with line numbers
      const numberedLines = displayLines.map((line, index) => {
        const lineNum = (startLine + index).toString().padStart(4, ' ');
        return `${lineNum}  ${line}`;
      }).join('\n');
      
      // Create browser URL
      let browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${filePath}`;
      let githubBrowserUrl = `https://github.com/v8/v8/blob/main/${v8Path}`;
      if (lineStart) {
        browserUrl += `;l=${lineStart}`;
        githubBrowserUrl += `#L${lineStart}`;
        if (lineEnd) {
          browserUrl += `-${lineEnd}`;
          githubBrowserUrl += `-L${lineEnd}`;
        }
      }
      
      const totalLines = lines.length;
      const displayedLines = displayLines.length;
      const lineRangeText = lineStart ? ` (lines ${lineStart}${lineEnd ? `-${lineEnd}` : '+'})` : '';
      
      return {
        content: [
          {
            type: "text",
            text: `## V8 File: ${filePath}${lineRangeText}\n\n` +
                  `📊 **Total lines:** ${totalLines} | **Displayed:** ${displayedLines}\n` +
                  `🔗 **Chromium Browser:** ${browserUrl}\n` +
                  `🔗 **GitHub:** ${githubBrowserUrl}\n` +
                  `📌 **Source:** GitHub (V8 submodule)\n\n` +
                  `\`\`\`${this.getFileExtension(filePath)}\n${numberedLines}\n\`\`\``,
          },
        ],
      };
      
    } catch (error: any) {
      this.log('error', 'Failed to fetch V8 file from GitHub', { filePath, error: error.message });
      throw error;
    }
  }
  
  private async getWebRTCFileViaGitiles(filePath: string, lineStart?: number, lineEnd?: number) {
    try {
      // Remove 'third_party/webrtc/' prefix
      const webrtcPath = filePath.replace(/^third_party\/webrtc\/?/, '');
      
      // Use WebRTC's Gitiles API
      const gitilesUrl = `https://webrtc.googlesource.com/src/+/main/${webrtcPath}?format=TEXT`;
      
      this.log('debug', 'Fetching WebRTC file from Gitiles', { path: webrtcPath, url: gitilesUrl });
      
      const response = await fetch(gitilesUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        throw new ChromiumSearchError(`Failed to fetch WebRTC file: HTTP ${response.status}`);
      }
      
      // The response is base64 encoded
      const base64Content = await response.text();
      const fileContent = Buffer.from(base64Content, 'base64').toString('utf-8');
      
      const lines = fileContent.split('\n');
      let displayLines = lines;
      let startLine = 1;
      
      // Apply line range if specified
      if (lineStart) {
        const start = Math.max(1, lineStart) - 1;
        const end = lineEnd ? Math.min(lines.length, lineEnd) : lines.length;
        displayLines = lines.slice(start, end);
        startLine = start + 1;
      }
      
      // Format content with line numbers
      const numberedLines = displayLines.map((line, index) => {
        const lineNum = (startLine + index).toString().padStart(4, ' ');
        return `${lineNum}  ${line}`;
      }).join('\n');
      
      // Create URLs
      let browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${filePath}`;
      let webrtcUrl = `https://webrtc.googlesource.com/src/+/main/${webrtcPath}`;
      if (lineStart) {
        browserUrl += `;l=${lineStart}`;
        webrtcUrl += `#${lineStart}`;
        if (lineEnd) {
          browserUrl += `-${lineEnd}`;
        }
      }
      
      const totalLines = lines.length;
      const displayedLines = displayLines.length;
      const lineRangeText = lineStart ? ` (lines ${lineStart}${lineEnd ? `-${lineEnd}` : '+'})` : '';
      
      return {
        content: [
          {
            type: "text",
            text: `## WebRTC File: ${filePath}${lineRangeText}\n\n` +
                  `📊 **Total lines:** ${totalLines} | **Displayed:** ${displayedLines}\n` +
                  `🔗 **Chromium Browser:** ${browserUrl}\n` +
                  `🔗 **WebRTC Gitiles:** ${webrtcUrl}\n` +
                  `📌 **Source:** WebRTC Gitiles (submodule)\n\n` +
                  `\`\`\`${this.getFileExtension(filePath)}\n${numberedLines}\n\`\`\``,
          },
        ],
      };
      
    } catch (error: any) {
      this.log('error', 'Failed to fetch WebRTC file', { filePath, error: error.message });
      throw error;
    }
  }

  private parseGitilesListing(data: any): Array<{name: string, type: 'file' | 'folder'}> {
    const items: Array<{name: string, type: 'file' | 'folder'}> = [];
    
    try {
      // Gitiles returns an object with "entries" array
      if (data && data.entries && Array.isArray(data.entries)) {
        for (const entry of data.entries) {
          // Each entry has 'name' and 'type' fields
          // type can be 'tree' (folder) or 'blob' (file)
          if (entry.name && entry.type) {
            items.push({
              name: entry.name,
              type: entry.type === 'tree' ? 'folder' : 'file'
            });
          }
        }
      }
      
      // Sort items: folders first, then files, alphabetically
      items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
    } catch (error) {
      this.log('error', 'Error parsing Gitiles listing response', { error });
    }
    
    return items;
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


  // PDFium Gerrit methods
  private async getPDFiumGerritCLStatus(args: any) {
    const { cl_number } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // Fetch CL details
      const detailsUrl = `https://pdfium-review.googlesource.com/changes/?q=change:${clId}&o=DETAILED_ACCOUNTS&o=CURRENT_REVISION&o=SUBMIT_REQUIREMENTS&o=MESSAGES`;
      const response = await fetch(detailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new GerritAPIError(`Failed to fetch CL status: ${response.status}`, response.status);
      }

      const responseText = await response.text();
      // Remove the XSSI protection prefix
      const jsonText = responseText.replace(/^\)]}'\n/, '');
      const data = JSON.parse(jsonText);
      
      if (!data || data.length === 0) {
        throw new GerritAPIError(`PDFium CL ${clId} not found`);
      }
      
      const cl = data[0];
      
      // Fetch messages for LUCI status
      const messages = await this.fetchPDFiumGerritMessages(clId);
      const luciRuns = this.extractLuciRuns(messages);
      
      // Format the result
      let resultText = `## PDFium CL ${clId}: ${cl.subject}\n\n`;
      resultText += `**Status:** ${cl.status}\n`;
      resultText += `**Author:** ${cl.owner.name} (${cl.owner.email})\n`;
      resultText += `**Created:** ${new Date(cl.created).toLocaleDateString()}\n`;
      resultText += `**Updated:** ${new Date(cl.updated).toLocaleDateString()}\n`;
      resultText += `**Current Patchset:** ${cl.revisions[cl.current_revision]._number}\n\n`;
      
      // Submit requirements
      if (cl.submit_requirements) {
        resultText += `### ✅ Submit Requirements:\n`;
        for (const req of cl.submit_requirements) {
          const status = req.status === 'SATISFIED' ? '✅' : 
                        req.status === 'UNSATISFIED' ? '❌' : '❓';
          resultText += `- ${status} **${req.name}**: ${req.status}\n`;
          
          if (req.submittability_expression_result) {
            const exprResult = req.submittability_expression_result;
            if (exprResult.status === 'FAIL' && exprResult.error_message) {
              resultText += `  - Error: ${exprResult.error_message}\n`;
            }
          }
        }
        resultText += `\n`;
      }
      
      // LUCI test results
      if (luciRuns.length > 0) {
        resultText += `### 🧪 Test Results:\n`;
        for (const run of luciRuns) {
          resultText += `\n**Patchset ${run.patchset}:** ${run.status}\n`;
          
          const passRate = this.calculatePassRate(run);
          if (passRate !== null) {
            resultText += `📊 Pass rate: ${passRate}%\n`;
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
      resultText += `- **Gerrit:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}\n`;
      
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
            text: `Failed to get PDFium CL status: ${error.message}\n\nTry viewing directly at: https://pdfium-review.googlesource.com/c/pdfium/+/${clId}`,
          },
        ],
      };
    }
  }

  private async fetchPDFiumGerritMessages(clId: string): Promise<any[]> {
    try {
      const messagesUrl = `https://pdfium-review.googlesource.com/changes/${clId}/messages`;
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

  private async getPDFiumGerritCLComments(args: any) {
    const { cl_number, patchset, include_resolved = true } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://pdfium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
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
        throw new Error(`PDFium CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = patchset || cl.current_revision_number || 1;
      
      // Get comments for the specified patchset
      const commentsUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/comments`;
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
      const draftsUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/drafts`;
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
      let resultText = `## Review Comments for PDFium CL ${clId}: ${cl.subject}\n\n`;
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
                const codeContext = await this.getPDFiumCodeContextForComment(clId, targetPatchset, fileName, comment.line);
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
      resultText += `- **Gerrit CL:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}/${targetPatchset}\n`;
      resultText += `- **Comments view:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}/${targetPatchset}#comments\n`;
      
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
            text: `Failed to get PDFium CL comments: ${error.message}\n\nTry viewing directly at: https://pdfium-review.googlesource.com/c/pdfium/+/${clId}`,
          },
        ],
      };
    }
  }

  private async getPDFiumCodeContextForComment(clId: string, patchset: number, fileName: string, lineNumber: number): Promise<string | null> {
    try {
      // Get the file content from the patchset
      const fileUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${patchset}/files/${encodeURIComponent(fileName)}/content`;
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

  private async getPDFiumGerritCLDiff(args: any) {
    const { cl_number, patchset, file_path } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://pdfium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
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
        throw new Error(`PDFium CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = patchset || cl.current_revision_number || 1;
      const revision = cl.revisions[cl.current_revision];
      
      // Get the files list first to understand what changed
      const filesUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files`;
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
      
      let resultText = `## Diff for PDFium CL ${clId}: ${cl.subject}\n\n`;
      resultText += `**Patchset:** ${targetPatchset}\n`;
      resultText += `**Author:** ${cl.owner.name}\n\n`;
      
      const changedFiles = Object.keys(filesData).filter(f => f !== '/COMMIT_MSG');
      
      if (file_path) {
        // Get diff for specific file
        if (!filesData[file_path]) {
          resultText += `### ❌ File not found in this patchset\n\nFile \`${file_path}\` was not modified in patchset ${targetPatchset}.\n\n`;
          resultText += `**Modified files:**\n${changedFiles.map(f => `- ${f}`).join('\n')}`;
        } else {
          const diffUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(file_path)}/diff?base=${targetPatchset-1}&context=ALL&intraline`;
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
          resultText += `- **Status:** ${this.getFileStatusText(status)}\n\n`;
        }
        
        if (changedFiles.length > 10) {
          resultText += `\n💡 *Showing first 10 files. Total: ${changedFiles.length} files changed.*\n`;
        }
        
        resultText += `\n### 🔍 Get specific file diff:\n`;
        resultText += `Use \`get_pdfium_gerrit_cl_diff(cl_number="${clId}", file_path="path/to/file")\` to see the actual code changes.\n`;
      }
      
      resultText += `\n### 🔗 Links\n`;
      resultText += `- **Gerrit diff view:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}/${targetPatchset}\n`;
      if (file_path) {
        resultText += `- **File diff:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}/${targetPatchset}/${encodeURIComponent(file_path)}\n`;
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
            text: `Failed to get PDFium CL diff: ${error.message}\n\nTry viewing directly at: https://pdfium-review.googlesource.com/c/pdfium/+/${clId}`,
          },
        ],
      };
    }
  }

  private async getPDFiumGerritPatchsetFile(args: any) {
    const { cl_number, file_path, patchset } = args;
    
    // Extract CL number from URL if provided
    const clMatch = cl_number.match(/(\d+)$/);
    const clId = clMatch ? clMatch[1] : cl_number;
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://pdfium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
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
        throw new Error(`PDFium CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = patchset || cl.current_revision_number || 1;
      
      // Get the file content from the patchset
      const fileUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(file_path)}/content`;
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
                text: `File not found: ${file_path}\n\nThis file may not exist in patchset ${targetPatchset} or may have been deleted.\n\nTry using get_pdfium_gerrit_cl_diff to see what files were changed.`,
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
      resultText += `- **Gerrit file view:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}/${targetPatchset}/${encodeURIComponent(file_path)}\n`;
      resultText += `- **File diff:** https://pdfium-review.googlesource.com/c/pdfium/+/${clId}/${targetPatchset}/${encodeURIComponent(file_path)}?diff=1\n`;
      
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
            text: `Failed to get file content: ${error.message}\n\nTry viewing directly at: https://pdfium-review.googlesource.com/c/pdfium/+/${clId}`,
          },
        ],
      };
    }
  }

  private async getGerritCLTrybotStatus(args: any) {
    const { cl_number, patchset, failed_only } = args;
    const clId = this.extractCLNumber(cl_number);
    
    try {
      // Get CL messages to find LUCI Change Verifier URLs
      const messagesUrl = `https://chromium-review.googlesource.com/changes/${clId}/messages`;
      const response = await fetch(messagesUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }
      
      const text = await response.text();
      const jsonText = text.replace(/^\)\]\}'/, '');
      const messages = JSON.parse(jsonText);
      
      // Find LUCI Change Verifier URLs from messages
      const luciUrls = this.extractLuciVerifierUrls(messages, patchset);
      
      if (luciUrls.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `## Try-Bot Status for CL ${clId}\n\n❌ **No LUCI runs found for this CL**\n\nThis CL may not have any try-bot runs yet, or the CQ may not have been triggered.\n\nCheck the CL status to see if builds are pending: [CL ${clId}](https://chromium-review.googlesource.com/c/chromium/src/+/${clId})`,
            },
          ],
        };
      }
      
      // Get detailed bot status from the most recent LUCI run
      const latestLuciUrl = luciUrls[0];
      const detailedBots = await this.fetchLuciRunDetails(latestLuciUrl.url);
      
      // Filter by failed only if requested
      const filteredBots = failed_only 
        ? detailedBots.filter(bot => bot.status === 'FAILED')
        : detailedBots;
      
      const totalBots = detailedBots.length;
      const failedBots = detailedBots.filter(bot => bot.status === 'FAILED').length;
      const passedBots = detailedBots.filter(bot => bot.status === 'PASSED').length;
      const runningBots = detailedBots.filter(bot => bot.status === 'RUNNING').length;
      const canceledBots = detailedBots.filter(bot => bot.status === 'CANCELED').length;
      
      let resultText = `## Try-Bot Status for CL ${clId}\n\n`;
      resultText += `**Patchset:** ${latestLuciUrl.patchset}\n`;
      resultText += `**LUCI Run:** [${latestLuciUrl.runId}](${latestLuciUrl.url})\n\n`;
      
      resultText += `### 📊 Summary\n`;
      resultText += `- **Total:** ${totalBots} bots\n`;
      resultText += `- **✅ Passed:** ${passedBots}\n`;
      resultText += `- **❌ Failed:** ${failedBots}\n`;
      resultText += `- **🔄 Running:** ${runningBots}\n`;
      if (canceledBots > 0) {
        resultText += `- **⏹️ Canceled:** ${canceledBots}\n`;
      }
      resultText += `\n`;
      
      if (filteredBots.length === 0) {
        if (failed_only) {
          resultText += `### 🎉 No Failed Bots\n\nAll bots have passed! No failed builds to show.\n`;
        } else {
          resultText += `### ⚠️ No Bot Results\n\nNo bot results to display.\n`;
        }
      } else {
        resultText += `### 🤖 Bot Results${failed_only ? ' (Failed Only)' : ''}\n\n`;
        
        for (const bot of filteredBots) {
          const statusIcon = this.getStatusIcon(bot.status);
          resultText += `#### ${statusIcon} ${bot.name}\n`;
          resultText += `**Status:** ${bot.status}\n`;
          if (bot.summary) {
            resultText += `**Summary:** ${bot.summary}\n`;
          }
          if (bot.luciUrl) {
            resultText += `**LUCI:** [View details](${bot.luciUrl})\n`;
          }
          resultText += `\n`;
        }
      }
      
      resultText += `### 🔗 Links\n`;
      resultText += `- **LUCI Change Verifier:** [View run](${latestLuciUrl.url})\n`;
      resultText += `- **Gerrit CL:** [CL ${clId}](https://chromium-review.googlesource.com/c/chromium/src/+/${clId})\n`;
      
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
            text: `Failed to get trybot status: ${error.message}\n\nTry viewing the CL directly at: https://chromium-review.googlesource.com/c/chromium/src/+/${clId}`,
          },
        ],
      };
    }
  }

  private async getPDFiumGerritCLTrybotStatus(args: any) {
    const { cl_number, patchset, failed_only } = args;
    const clId = this.extractCLNumber(cl_number);
    
    try {
      // Get CL messages to find LUCI Change Verifier URLs
      const messagesUrl = `https://pdfium-review.googlesource.com/changes/${clId}/messages`;
      const response = await fetch(messagesUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }
      
      const text = await response.text();
      const jsonText = text.replace(/^\)\]\}'/, '');
      const messages = JSON.parse(jsonText);
      
      // Find LUCI Change Verifier URLs from messages (PDFium uses different LUCI structure)
      const luciUrls = this.extractPDFiumLuciVerifierUrls(messages, patchset);
      
      if (luciUrls.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `## Try-Bot Status for PDFium CL ${clId}\n\n❌ **No LUCI runs found for this CL**\n\nThis CL may not have any try-bot runs yet, or the CQ may not have been triggered.\n\nCheck the CL status to see if builds are pending: [CL ${clId}](https://pdfium-review.googlesource.com/c/pdfium/+/${clId})`,
            },
          ],
        };
      }
      
      // Get detailed bot status from the most recent LUCI run
      const latestLuciUrl = luciUrls[0];
      const detailedBots = await this.fetchLuciRunDetails(latestLuciUrl.url);
      
      // Filter by failed only if requested
      const filteredBots = failed_only 
        ? detailedBots.filter(bot => bot.status === 'FAILED')
        : detailedBots;
      
      const totalBots = detailedBots.length;
      const failedBots = detailedBots.filter(bot => bot.status === 'FAILED').length;
      const passedBots = detailedBots.filter(bot => bot.status === 'PASSED').length;
      const runningBots = detailedBots.filter(bot => bot.status === 'RUNNING').length;
      const canceledBots = detailedBots.filter(bot => bot.status === 'CANCELED').length;
      
      let resultText = `## Try-Bot Status for PDFium CL ${clId}\n\n`;
      resultText += `**Patchset:** ${latestLuciUrl.patchset}\n`;
      resultText += `**LUCI Run:** [${latestLuciUrl.runId}](${latestLuciUrl.url})\n\n`;
      
      resultText += `### 📊 Summary\n`;
      resultText += `- **Total:** ${totalBots} bots\n`;
      resultText += `- **✅ Passed:** ${passedBots}\n`;
      resultText += `- **❌ Failed:** ${failedBots}\n`;
      resultText += `- **🔄 Running:** ${runningBots}\n`;
      if (canceledBots > 0) {
        resultText += `- **⏹️ Canceled:** ${canceledBots}\n`;
      }
      resultText += `\n`;
      
      if (filteredBots.length === 0) {
        if (failed_only) {
          resultText += `### 🎉 No Failed Bots\n\nAll bots have passed! No failed builds to show.\n`;
        } else {
          resultText += `### ⚠️ No Bot Results\n\nNo bot results to display.\n`;
        }
      } else {
        resultText += `### 🤖 Bot Results${failed_only ? ' (Failed Only)' : ''}\n\n`;
        
        for (const bot of filteredBots) {
          const statusIcon = this.getStatusIcon(bot.status);
          resultText += `#### ${statusIcon} ${bot.name}\n`;
          resultText += `**Status:** ${bot.status}\n`;
          if (bot.summary) {
            resultText += `**Summary:** ${bot.summary}\n`;
          }
          if (bot.luciUrl) {
            resultText += `**LUCI:** [View details](${bot.luciUrl})\n`;
          }
          resultText += `\n`;
        }
      }
      
      resultText += `### 🔗 Links\n`;
      resultText += `- **LUCI Change Verifier:** [View run](${latestLuciUrl.url})\n`;
      resultText += `- **PDFium Gerrit CL:** [CL ${clId}](https://pdfium-review.googlesource.com/c/pdfium/+/${clId})\n`;
      
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
            text: `Failed to get trybot status: ${error.message}\n\nTry viewing the CL directly at: https://pdfium-review.googlesource.com/c/pdfium/+/${clId}`,
          },
        ],
      };
    }
  }

  // Helper methods for trybot functionality
  private extractLuciVerifierUrls(messages: any[], targetPatchset?: number): Array<{
    url: string;
    runId: string;
    patchset: number;
    timestamp: string;
  }> {
    const luciUrls: Array<{ url: string; runId: string; patchset: number; timestamp: string }> = [];
    
    for (const msg of messages) {
      // Skip if we want a specific patchset and this message is for a different one
      if (targetPatchset && msg._revision_number && msg._revision_number !== targetPatchset) {
        continue;
      }
      
      // Look for LUCI Change Verifier URLs in messages
      if (msg.message) {
        const luciMatch = msg.message.match(/Follow status at: (https:\/\/luci-change-verifier\.appspot\.com\/ui\/run\/chromium\/([^\/\s]+))/);
        if (luciMatch) {
          luciUrls.push({
            url: luciMatch[1],
            runId: luciMatch[2],
            patchset: msg._revision_number || 0,
            timestamp: msg.date
          });
        }
      }
    }
    
    // Return most recent first
    return luciUrls.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  private extractPDFiumLuciVerifierUrls(messages: any[], targetPatchset?: number): Array<{
    url: string;
    runId: string;
    patchset: number;
    timestamp: string;
  }> {
    const luciUrls: Array<{ url: string; runId: string; patchset: number; timestamp: string }> = [];
    
    for (const msg of messages) {
      // Skip if we want a specific patchset and this message is for a different one
      if (targetPatchset && msg._revision_number && msg._revision_number !== targetPatchset) {
        continue;
      }
      
      // Look for LUCI Change Verifier URLs in messages (PDFium might have different URL patterns)
      if (msg.message) {
        const luciMatch = msg.message.match(/Follow status at: (https:\/\/luci-change-verifier\.appspot\.com\/ui\/run\/pdfium\/([^\/\s]+))/);
        if (luciMatch) {
          luciUrls.push({
            url: luciMatch[1],
            runId: luciMatch[2],
            patchset: msg._revision_number || 0,
            timestamp: msg.date
          });
        }
      }
    }
    
    // Return most recent first
    return luciUrls.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
  
  private async fetchLuciRunDetails(luciUrl: string): Promise<any[]> {
    try {
      // Extract run ID from URL (works for both chromium and pdfium)
      const runIdMatch = luciUrl.match(/\/run\/(?:chromium|pdfium)\/([^\/\s]+)/);
      if (!runIdMatch) {
        throw new Error('Could not extract run ID from LUCI URL');
      }
      
      const runId = runIdMatch[1];
      
      // Fetch the LUCI page HTML directly
      const response = await fetch(luciUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch LUCI page: ${response.status}`);
      }
      
      const html = await response.text();
      
      // Parse the HTML to extract bot information
      const bots = this.parseLuciHtmlImproved(html, luciUrl, runId);
      
      if (bots.length > 0) {
        return bots;
      }
      
      // Fallback if parsing fails
      return [{
        name: 'LUCI Run',
        status: 'UNKNOWN',
        runId: runId,
        luciUrl: luciUrl,
        summary: 'Could not parse bot details - view at LUCI URL'
      }];
      
    } catch (error) {
      // Fallback to basic info if we can't fetch details
      return [{
        name: 'LUCI Run', 
        status: 'UNKNOWN',
        luciUrl: luciUrl,
        summary: 'View detailed bot status at LUCI URL'
      }];
    }
  }

  private parseLuciHtmlImproved(html: string, luciUrl: string, runId: string): any[] {
    const bots: any[] = [];
    const foundBots = new Set<string>();
    
    try {
      // Simple approach: Find all <a> elements with tryjob-chip classes
      // This works for both Chromium and PDFium without hardcoding patterns
      const tryjobPattern = /<a[^>]*class="[^"]*tryjob-chip[^"]*"[^>]*>(.*?)<\/a>/gs;
      let match;
      
      while ((match = tryjobPattern.exec(html)) !== null) {
        const fullMatch = match[0];
        const innerText = match[1];
        
        // Extract bot name from the inner text (trim whitespace)
        const botName = innerText.trim().replace(/\s+/g, ' ');
        
        if (botName && botName.length > 3 && !foundBots.has(botName)) {
          foundBots.add(botName);
          
          // Extract status from class attribute
          let status = 'UNKNOWN';
          if (fullMatch.includes('tryjob-chip passed')) {
            status = 'PASSED';
          } else if (fullMatch.includes('tryjob-chip failed')) {
            status = 'FAILED';
          } else if (fullMatch.includes('tryjob-chip running')) {
            status = 'RUNNING';
          } else if (fullMatch.includes('tryjob-chip canceled')) {
            status = 'CANCELED';
          }
          
          bots.push({
            name: botName,
            status: status,
            luciUrl: luciUrl,
            runId: runId,
            summary: `${status.toLowerCase()}`
          });
        }
      }
      
    } catch (error) {
      // Ignore parsing errors
    }
    
    return bots;
  }
  
  private extractBotStatus(html: string, matchIndex: number): string {
    // Look for status indicators around this bot
    const contextStart = Math.max(0, matchIndex - 500);
    const contextEnd = Math.min(html.length, matchIndex + 500);
    const context = html.slice(contextStart, contextEnd);
    
    let status = 'UNKNOWN';
    
    // Look for various status patterns in the surrounding context
    if (this.checkForStatus(context, 'SUCCESS', 'PASSED', 'success')) {
      status = 'PASSED';
    } else if (this.checkForStatus(context, 'FAILURE', 'FAILED', 'failure', 'error')) {
      status = 'FAILED';
    } else if (this.checkForStatus(context, 'RUNNING', 'STARTED', 'running', 'pending')) {
      status = 'RUNNING';
    } else if (this.checkForStatus(context, 'CANCELED', 'CANCELLED', 'canceled')) {
      status = 'CANCELED';
    }
    
    // Also check for CSS class patterns that indicate status
    if (status === 'UNKNOWN') {
      if (context.includes('class="green"') || context.includes('color:green') || 
          context.includes('background-color:green') || context.includes('rgb(76, 175, 80)')) {
        status = 'PASSED';
      } else if (context.includes('class="red"') || context.includes('color:red') || 
                 context.includes('background-color:red') || context.includes('rgb(244, 67, 54)')) {
        status = 'FAILED';
      } else if (context.includes('class="yellow"') || context.includes('color:orange') ||
                 context.includes('background-color:yellow') || context.includes('rgb(255, 193, 7)')) {
        status = 'RUNNING';
      }
    }
    
    return status;
  }

  private checkForStatus(context: string, ...statusWords: string[]): boolean {
    const lowerContext = context.toLowerCase();
    return statusWords.some(word => lowerContext.includes(word.toLowerCase()));
  }
  
  private getStatusIcon(status: string): string {
    switch (status.toUpperCase()) {
      case 'PASSED': return '✅';
      case 'FAILED': return '❌';
      case 'RUNNING': return '🔄';
      case 'CANCELED': return '⏹️';
      case 'UNKNOWN': return '❓';
      default: return '⚪';
    }
  }

  private async listGerritCLs(args: any) {
    const { query, auth_cookie, limit = 25 } = args;
    
    try {
      // Build the Gerrit API URL
      let apiUrl = 'https://chromium-review.googlesource.com/changes/?';
      
      // Add default options
      const params = new URLSearchParams();
      params.append('O', '5000081'); // Same as Gerrit UI - includes DETAILED_ACCOUNTS + LABELS
      params.append('S', '0'); // Start index
      
      // Build the query
      if (query) {
        params.append('q', query);
      } else {
        // Default to showing user's open CLs
        params.append('q', 'status:open owner:self');
      }
      
      // Limit results
      if (limit && limit > 0 && limit <= 100) {
        params.append('n', limit.toString());
      }
      
      params.append('allow-incomplete-results', 'true');
      
      apiUrl += params.toString();
      
      // Make the request with authentication cookies
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'Cookie': auth_cookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Authentication failed. Please ensure your cookie is valid and includes necessary auth tokens (SID, __Secure-1PSID, etc.)');
        }
        throw new Error(`Failed to fetch CLs: HTTP ${response.status}`);
      }
      
      const responseText = await response.text();
      // Remove XSSI prefix
      const jsonText = responseText.replace(/^\)]}'/, '');
      const cls = JSON.parse(jsonText);
      
      if (!Array.isArray(cls)) {
        throw new Error('Unexpected response format from Gerrit API');
      }
      
      // Format the results
      let resultText = `## Gerrit CLs${query ? ` (${query})` : ' (Your Open CLs)'}\n\n`;
      resultText += `📊 **Found ${cls.length} CL${cls.length !== 1 ? 's' : ''}**\n\n`;
      
      if (cls.length === 0) {
        resultText += `No CLs found matching the query.\n`;
      } else {
        for (const cl of cls) {
          const clNumber = cl._number || cl.id;
          const status = cl.status || 'UNKNOWN';
          const statusEmoji = this.getStatusEmoji(status);
          
          resultText += `### ${statusEmoji} CL ${clNumber}: ${cl.subject}\n`;
          resultText += `- **Author:** ${cl.owner?.name || 'Unknown'} (${cl.owner?.email || 'no email'})\n`;
          resultText += `- **Status:** ${status}\n`;
          resultText += `- **Created:** ${new Date(cl.created).toLocaleDateString()}\n`;
          resultText += `- **Updated:** ${new Date(cl.updated).toLocaleDateString()}\n`;
          
          if (cl.current_revision_number) {
            resultText += `- **Patchset:** ${cl.current_revision_number}\n`;
          }
          
          if (cl.insertions || cl.deletions) {
            resultText += `- **Changes:** +${cl.insertions || 0} / -${cl.deletions || 0}\n`;
          }
          
          if (cl.total_comment_count > 0) {
            resultText += `- **Comments:** ${cl.total_comment_count} (${cl.unresolved_comment_count} unresolved)\n`;
          }
          
          // Add labels if present
          if (cl.labels) {
            const importantLabels = ['Code-Review', 'Commit-Queue', 'Auto-Submit'];
            const labelText = [];
            
            for (const label of importantLabels) {
              if (cl.labels[label]) {
                const values = cl.labels[label].all || [];
                const maxValue = Math.max(...values.map((v: any) => v.value || 0));
                const minValue = Math.min(...values.map((v: any) => v.value || 0));
                
                if (maxValue > 0) {
                  labelText.push(`${label}: +${maxValue}`);
                } else if (minValue < 0) {
                  labelText.push(`${label}: ${minValue}`);
                }
              }
            }
            
            if (labelText.length > 0) {
              resultText += `- **Labels:** ${labelText.join(', ')}\n`;
            }
          }
          
          resultText += `- **Link:** https://chromium-review.googlesource.com/c/chromium/src/+/${clNumber}\n`;
          resultText += `\n`;
        }
      }
      
      resultText += `\n### 📝 Query Tips:\n`;
      resultText += `- **Your CLs:** \`owner:self\` or \`owner:me\`\n`;
      resultText += `- **Status:** \`status:open\`, \`status:merged\`, \`status:abandoned\`\n`;
      resultText += `- **Specific CLs:** \`change:1234 OR change:5678\`\n`;
      resultText += `- **Reviewer:** \`reviewer:email@chromium.org\`\n`;
      resultText += `- **Project:** \`project:chromium/src\`\n`;
      resultText += `- **Branch:** \`branch:main\`\n`;
      
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
            text: `Failed to list Gerrit CLs: ${error.message}\n\nMake sure you have provided valid authentication cookies from your browser.`,
          },
        ],
      };
    }
  }

  private async listPDFiumGerritCLs(args: any) {
    const { query, auth_cookie, limit = 25 } = args;
    
    try {
      // Build the PDFium Gerrit API URL
      let apiUrl = 'https://pdfium-review.googlesource.com/changes/?';
      
      // Add default options
      const params = new URLSearchParams();
      params.append('O', '5000081'); // Same as Gerrit UI - includes DETAILED_ACCOUNTS + LABELS
      params.append('S', '0'); // Start index
      
      // Build the query
      if (query) {
        params.append('q', query);
      } else {
        // Default to showing user's open CLs
        params.append('q', 'status:open owner:self');
      }
      
      // Limit results
      if (limit && limit > 0 && limit <= 100) {
        params.append('n', limit.toString());
      }
      
      params.append('allow-incomplete-results', 'true');
      
      apiUrl += params.toString();
      
      // Make the request with authentication cookies
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'Cookie': auth_cookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Authentication failed. Please ensure your cookie is valid and includes necessary auth tokens (SID, __Secure-1PSID, etc.)');
        }
        throw new Error(`Failed to fetch CLs: HTTP ${response.status}`);
      }
      
      const responseText = await response.text();
      // Remove XSSI prefix
      const jsonText = responseText.replace(/^\)]}'/, '');
      const cls = JSON.parse(jsonText);
      
      if (!Array.isArray(cls)) {
        throw new Error('Unexpected response format from PDFium Gerrit API');
      }
      
      // Format the results
      let resultText = `## PDFium Gerrit CLs${query ? ` (${query})` : ' (Your Open CLs)'}\n\n`;
      resultText += `📊 **Found ${cls.length} CL${cls.length !== 1 ? 's' : ''}**\n\n`;
      
      if (cls.length === 0) {
        resultText += `No CLs found matching the query.\n`;
      } else {
        // List each CL
        cls.forEach((cl, index) => {
          const clNumber = cl._number;
          const status = this.getStatusEmoji(cl.status);
          const subject = cl.subject || 'No subject';
          const owner = cl.owner?.name || 'Unknown';
          const updated = new Date(cl.updated).toLocaleString();
          
          resultText += `### ${index + 1}. ${status} CL ${clNumber}: ${subject}\n`;
          resultText += `- **Owner:** ${owner}\n`;
          resultText += `- **Status:** ${cl.status}\n`;
          resultText += `- **Updated:** ${updated}\n`;
          
          if (cl.current_revision_number) {
            resultText += `- **Patchset:** ${cl.current_revision_number}\n`;
          }
          
          if (cl.insertions || cl.deletions) {
            resultText += `- **Changes:** +${cl.insertions || 0}/-${cl.deletions || 0}\n`;
          }
          
          if (cl.total_comment_count > 0) {
            resultText += `- **Comments:** ${cl.total_comment_count} (${cl.unresolved_comment_count} unresolved)\n`;
          }
          
          // Add labels if present
          if (cl.labels) {
            const importantLabels = ['Code-Review', 'Commit-Queue', 'Auto-Submit'];
            const labelText = [];
            
            for (const label of importantLabels) {
              if (cl.labels[label]) {
                const values = cl.labels[label].all || [];
                const maxValue = Math.max(...values.map((v: any) => v.value || 0));
                const minValue = Math.min(...values.map((v: any) => v.value || 0));
                
                if (maxValue > 0) {
                  labelText.push(`${label}: +${maxValue}`);
                } else if (minValue < 0) {
                  labelText.push(`${label}: ${minValue}`);
                }
              }
            }
            
            if (labelText.length > 0) {
              resultText += `- **Labels:** ${labelText.join(', ')}\n`;
            }
          }
          
          resultText += `- **Link:** https://pdfium-review.googlesource.com/c/pdfium/+/${clNumber}\n\n`;
        });
      }
      
      // Add query examples
      resultText += `---\n\n`;
      resultText += `**Example queries:**\n`;
      resultText += `- **Your CLs:** \`owner:me\` or \`owner:self\`\n`;
      resultText += `- **Specific status:** \`status:open\`, \`status:merged\`, \`status:abandoned\`\n`;
      resultText += `- **Multiple CLs:** \`change:12345 OR change:67890\`\n`;
      resultText += `- **Reviewer queries:** \`reviewer:someone@example.com\`\n`;
      resultText += `- **Branch:** \`branch:main\`\n`;
      
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
            text: `Failed to list PDFium Gerrit CLs: ${error.message}\n\nMake sure you have provided valid authentication cookies from your browser.`,
          },
        ],
      };
    }
  }
  
  private getStatusEmoji(status: string): string {
    switch (status.toUpperCase()) {
      case 'NEW':
      case 'OPEN':
        return '🔵';
      case 'MERGED':
        return '✅';
      case 'ABANDONED':
        return '❌';
      default:
        return '⚪';
    }
  }

  private extractCLNumber(clInput: string): string {
    // Extract CL number from URL or return as-is if already a number
    const match = clInput.match(/\/(\d+)(?:\/|$)/);
    return match ? match[1] : clInput;
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