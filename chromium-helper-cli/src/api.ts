import fetch from 'node-fetch';
import { chromium } from 'playwright';

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  url: string;
  type?: string;
}

export interface XRefResult {
  signature: string;
  definition?: SearchResult;
  declaration?: SearchResult;
  references: SearchResult[];
  overrides: SearchResult[];
  calls: SearchResult[];
}

export class ChromiumSearchError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'ChromiumSearchError';
  }
}

export class GerritAPIError extends Error {
  constructor(message: string, public statusCode?: number, public cause?: Error) {
    super(message);
    this.name = 'GerritAPIError';
  }
}

export interface SearchCodeParams {
  query: string;
  caseSensitive?: boolean;
  language?: string;
  filePattern?: string;
  searchType?: 'content' | 'function' | 'class' | 'symbol' | 'comment';
  excludeComments?: boolean;
  limit?: number;
}

export interface GetFileParams {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface GetGerritCLCommentsParams {
  clNumber: string;
  patchset?: number;
  includeResolved?: boolean;
}

export interface GetGerritCLDiffParams {
  clNumber: string;
  patchset?: number;
  filePath?: string;
}

export interface GetGerritPatchsetFileParams {
  clNumber: string;
  filePath: string;
  patchset?: number;
}

export interface SearchCommitsParams {
  query: string;
  author?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export class ChromiumAPI {
  private apiKey: string;
  private cache = new Map<string, any>();
  private debugMode = false;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.CHROMIUM_SEARCH_API_KEY || 'AIzaSyCqPSptx9mClE5NU4cpfzr6cgdO_phV1lM';
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  private debug(...args: any[]): void {
    if (this.debugMode) {
      console.log(...args);
    }
  }

  async searchCode(params: SearchCodeParams): Promise<SearchResult[]> {
    const { 
      query, 
      caseSensitive = false,
      language,
      filePattern, 
      searchType,
      excludeComments = false,
      limit = 20 
    } = params;
    
    // Build the enhanced search query using Code Search syntax
    let searchQuery = query;
    
    // Add case sensitivity if requested
    if (caseSensitive) {
      searchQuery = `case:yes ${searchQuery}`;
    }
    
    // Add language filter if specified
    if (language) {
      searchQuery = `lang:${language} ${searchQuery}`;
    }
    
    // Add file pattern filter if specified
    if (filePattern) {
      searchQuery = `file:${filePattern} ${searchQuery}`;
    }
    
    // Add search type filter if specified
    if (searchType) {
      switch (searchType) {
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
      if (caseSensitive) searchQuery = `case:yes ${searchQuery}`;
      if (language) searchQuery = `lang:${language} ${searchQuery}`;
      if (filePattern) searchQuery = `file:${filePattern} ${searchQuery}`;
    }
    
    // Add usage filter to exclude comments if requested
    if (excludeComments && !searchType) {
      searchQuery = `usage:${query}`;
      if (caseSensitive) searchQuery = `case:yes ${searchQuery}`;
      if (language) searchQuery = `lang:${language} ${searchQuery}`;
      if (filePattern) searchQuery = `file:${filePattern} ${searchQuery}`;
    }

    try {
      const response = await this.callChromiumSearchAPI(searchQuery, limit);
      return this.parseChromiumAPIResponse(response);
    } catch (error: any) {
      throw new ChromiumSearchError(`Search failed: ${error.message}`, error);
    }
  }

  async findSymbol(symbol: string, filePath?: string): Promise<{
    symbol: string;
    symbolResults: SearchResult[];
    classResults: SearchResult[];
    functionResults: SearchResult[];
    usageResults: SearchResult[];
    estimatedUsageCount?: number;
  }> {
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
      
      return {
        symbol,
        symbolResults: symbolParsed,
        classResults: classParsed,
        functionResults: functionParsed,
        usageResults: usageParsed,
        estimatedUsageCount: usageResults.estimatedResultCount
      };
    } catch (error: any) {
      throw new ChromiumSearchError(`Symbol lookup failed: ${error.message}`, error);
    }
  }

  async getFile(params: GetFileParams): Promise<{
    filePath: string;
    content: string;
    totalLines: number;
    displayedLines: number;
    lineStart?: number;
    lineEnd?: number;
    browserUrl: string;
  }> {
    const { filePath, lineStart, lineEnd } = params;
    
    try {
      // Fetch from Gitiles API
      const gitileUrl = `https://chromium.googlesource.com/chromium/src/+/main/${filePath}?format=TEXT`;
      
      const response = await fetch(gitileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch file: HTTP ${response.status}`);
      }

      // The response is base64 encoded
      const base64Content = await response.text();
      const fileContent = Buffer.from(base64Content, 'base64').toString('utf-8');
      
      // Split into lines for line number processing
      const lines = fileContent.split('\n');
      let displayLines = lines;
      let startLine = 1;
      
      // Apply line range if specified
      if (lineStart) {
        const start = Math.max(1, lineStart) - 1; // Convert to 0-based
        const end = lineEnd ? Math.min(lines.length, lineEnd) : lines.length;
        displayLines = lines.slice(start, end);
        startLine = start + 1;
      }
      
      // Format content with line numbers
      const numberedLines = displayLines.map((line, index) => {
        const lineNum = (startLine + index).toString().padStart(4, ' ');
        return `${lineNum}  ${line}`;
      }).join('\n');
      
      // Create browser URL for reference
      let browserUrl = `https://source.chromium.org/chromium/chromium/src/+/main:${filePath}`;
      if (lineStart) {
        browserUrl += `;l=${lineStart}`;
        if (lineEnd) {
          browserUrl += `-${lineEnd}`;
        }
      }
      
      return {
        filePath,
        content: numberedLines,
        totalLines: lines.length,
        displayedLines: displayLines.length,
        lineStart,
        lineEnd,
        browserUrl
      };
      
    } catch (error: any) {
      throw new ChromiumSearchError(`File fetch failed: ${error.message}`, error);
    }
  }

  async getGerritCLStatus(clNumber: string): Promise<any> {
    try {
      // Extract CL number from URL if needed
      const clNum = this.extractCLNumber(clNumber);
      const gerritUrl = `https://chromium-review.googlesource.com/changes/${clNum}?o=CURRENT_REVISION&o=DETAILED_ACCOUNTS&o=SUBMIT_REQUIREMENTS&o=CURRENT_COMMIT`;
      
      const response = await fetch(gerritUrl);
      if (!response.ok) {
        throw new GerritAPIError(`Failed to fetch CL status: ${response.status}`, response.status);
      }
      
      const text = await response.text();
      // Remove XSSI protection prefix
      const jsonText = text.replace(/^\)\]\}'\n/, '');
      return JSON.parse(jsonText);
      
    } catch (error: any) {
      throw new GerritAPIError(`Gerrit API error: ${error.message}`, undefined, error);
    }
  }

  async getGerritCLComments(params: GetGerritCLCommentsParams): Promise<any> {
    try {
      const clNum = this.extractCLNumber(params.clNumber);
      const gerritUrl = `https://chromium-review.googlesource.com/changes/${clNum}/comments`;
      
      const response = await fetch(gerritUrl);
      if (!response.ok) {
        throw new GerritAPIError(`Failed to fetch CL comments: ${response.status}`, response.status);
      }
      
      const text = await response.text();
      const jsonText = text.replace(/^\)\]\}'\n/, '');
      return JSON.parse(jsonText);
      
    } catch (error: any) {
      throw new GerritAPIError(`Gerrit comments API error: ${error.message}`, undefined, error);
    }
  }

  async getGerritCLDiff(params: GetGerritCLDiffParams): Promise<any> {
    const clId = this.extractCLNumber(params.clNumber);
    
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
      const jsonText = responseText.replace(/^\)\]\}'\n/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = params.patchset || cl.current_revision_number || 1;
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
      const filesJsonText = filesText.replace(/^\)\]\}'\n/, '');
      const filesData = JSON.parse(filesJsonText);
      
      const changedFiles = Object.keys(filesData).filter(f => f !== '/COMMIT_MSG');
      
      const result: any = {
        clId,
        subject: cl.subject,
        patchset: targetPatchset,
        author: cl.owner.name,
        changedFiles,
        filesData,
        revision
      };
      
      if (params.filePath) {
        // Get diff for specific file
        if (!filesData[params.filePath]) {
          result.error = `File ${params.filePath} not found in patchset ${targetPatchset}`;
          return result;
        }
        
        const diffUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(params.filePath)}/diff?base=${targetPatchset-1}&context=ALL&intraline`;
        const diffResponse = await fetch(diffUrl, {
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (diffResponse.ok) {
          const diffText = await diffResponse.text();
          const diffJsonText = diffText.replace(/^\)\]\}'\n/, '');
          result.diffData = JSON.parse(diffJsonText);
        }
      }
      
      return result;
      
    } catch (error: any) {
      throw new GerritAPIError(`Failed to get CL diff: ${error.message}`, undefined, error);
    }
  }

  async getGerritPatchsetFile(params: GetGerritPatchsetFileParams): Promise<any> {
    const clId = this.extractCLNumber(params.clNumber);
    
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
      const jsonText = responseText.replace(/^\)\]\}'\n/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = params.patchset || cl.current_revision_number || 1;
      
      // Get the file content from the patchset
      const fileUrl = `https://chromium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(params.filePath)}/content`;
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'Accept': 'text/plain',
        },
      });
      
      if (!fileResponse.ok) {
        if (fileResponse.status === 404) {
          throw new Error(`File ${params.filePath} not found in patchset ${targetPatchset}`);
        }
        throw new Error(`Failed to fetch file content: ${fileResponse.status}`);
      }
      
      // Gerrit returns base64 encoded content
      const base64Content = await fileResponse.text();
      const content = Buffer.from(base64Content, 'base64').toString('utf-8');
      
      return {
        clId,
        subject: cl.subject,
        patchset: targetPatchset,
        author: cl.owner.name,
        filePath: params.filePath,
        content,
        lines: content.split('\n').length
      };
      
    } catch (error: any) {
      throw new GerritAPIError(`Failed to get file content: ${error.message}`, undefined, error);
    }
  }

  async findOwners(filePath: string): Promise<{
    filePath: string;
    ownerFiles: Array<{
      path: string;
      content: string;
      browserUrl: string;
    }>;
  }> {
    try {
      const ownerFiles = [];
      const pathParts = filePath.split('/');
      
      // Search up the directory tree for OWNERS files
      for (let i = pathParts.length; i > 0; i--) {
        const dirPath = pathParts.slice(0, i).join('/');
        const ownersPath = dirPath ? `${dirPath}/OWNERS` : 'OWNERS';
        
        try {
          const result = await this.getFile({ filePath: ownersPath });
          ownerFiles.push({
            path: ownersPath,
            content: result.content,
            browserUrl: result.browserUrl
          });
        } catch (error) {
          // OWNERS file doesn't exist at this level, continue up the tree
        }
      }
      
      return {
        filePath,
        ownerFiles
      };
      
    } catch (error: any) {
      throw new ChromiumSearchError(`Owners lookup failed: ${error.message}`, error);
    }
  }

  async searchCommits(params: SearchCommitsParams): Promise<any> {
    try {
      let gitileUrl = `https://chromium.googlesource.com/chromium/src/+log/?format=JSON&n=${params.limit || 20}`;
      
      if (params.since) {
        gitileUrl += `&since=${params.since}`;
      }
      if (params.until) {
        gitileUrl += `&until=${params.until}`;
      }
      if (params.author) {
        gitileUrl += `&author=${encodeURIComponent(params.author)}`;
      }
      
      const response = await fetch(gitileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch commits: HTTP ${response.status}`);
      }
      
      const text = await response.text();
      const jsonText = text.replace(/^\)\]\}'\n/, '');
      const result = JSON.parse(jsonText);
      
      // Filter by query if provided
      if (params.query) {
        const query = params.query.toLowerCase();
        result.log = result.log.filter((commit: any) => 
          commit.message.toLowerCase().includes(query) ||
          commit.author.name.toLowerCase().includes(query) ||
          commit.author.email.toLowerCase().includes(query)
        );
      }
      
      return result;
      
    } catch (error: any) {
      throw new ChromiumSearchError(`Commit search failed: ${error.message}`, error);
    }
  }

  async getIssue(issueId: string): Promise<any> {
    try {
      const issueNum = this.extractIssueId(issueId);
      const issueUrl = `https://issues.chromium.org/issues/${issueNum}`;
      
      // Try direct API approach first (much faster than Playwright)
      try {
        const directApiResult = await this.getIssueDirectAPI(issueNum);
        if (directApiResult && (directApiResult.comments?.length > 0 || directApiResult.description?.length > 20)) {
          return {
            issueId: issueNum,
            browserUrl: issueUrl,
            ...directApiResult,
            extractionMethod: 'direct-api'
          };
        } else {
          this.debug(`[DEBUG] Direct API returned insufficient data, falling back to browser`);
        }
      } catch (error) {
        this.debug(`[DEBUG] Direct API failed, falling back to browser: ${error}`);
      }

      // First try HTTP-based extraction for basic info
      let basicInfo = null;
      try {
        const response = await fetch(issueUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        
        if (response.ok) {
          const html = await response.text();
          const jspbMatch = html.match(/defrostedResourcesJspb\s*=\s*(\[.*?\]);/s);
          if (jspbMatch) {
            try {
              const issueData = JSON.parse(jspbMatch[1]);
              basicInfo = this.extractIssueInfo(issueData, issueNum);
            } catch (e) {
              // Continue to browser automation
            }
          }
        }
      } catch (e) {
        // Continue to browser automation
      }
      
      // Use browser automation for comprehensive data extraction
      const browserInfo = await this.extractIssueWithBrowser(issueUrl, issueNum);
      
      // Merge basic info with browser-extracted info
      const mergedInfo = {
        ...basicInfo,
        ...browserInfo,
        // Prefer browser-extracted title if it's more meaningful
        title: (browserInfo.title && browserInfo.title !== 'Unknown' && !browserInfo.title.includes('Issue ')) 
               ? browserInfo.title 
               : basicInfo?.title || browserInfo.title,
        extractionMethod: 'browser-automation'
      };
      
      return {
        issueId: issueNum,
        browserUrl: issueUrl,
        ...mergedInfo
      };
      
    } catch (error: any) {
      const browserUrl = `https://issues.chromium.org/issues/${this.extractIssueId(issueId)}`;
      return {
        issueId: this.extractIssueId(issueId),
        browserUrl,
        error: `Failed to fetch issue details: ${error.message}`,
        message: 'Use the browser URL to view the issue manually.'
      };
    }
  }

  private async callChromiumSearchAPI(query: string, limit: number): Promise<any> {
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
      `POST /v1/contents/search?alt=json&key=${this.apiKey}`,
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
      throw new ChromiumSearchError(`API request failed: ${response.status} ${response.statusText}`);
    }

    const responseText = await response.text();
    
    // Parse the multipart response to extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ChromiumSearchError('Could not parse API response');
    }

    const result = JSON.parse(jsonMatch[0]);
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

  private extractCLNumber(clInput: string): string {
    // Extract CL number from URL or return as-is if already a number
    const match = clInput.match(/\/(\d+)(?:\/|$)/);
    return match ? match[1] : clInput;
  }

  private extractIssueId(issueInput: string): string {
    // Extract issue ID from URL or return as-is if already a number
    const match = issueInput.match(/\/issues\/(\d+)/);
    return match ? match[1] : issueInput;
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

  private extractIssueInfo(issueData: any, issueId: string): any {
    try {
      // The structure can vary, so we need to search through it
      let issueArray = null;
      
      // Try different common structures
      if (issueData?.[1]?.[0]) {
        issueArray = issueData[1][0];
      } else if (issueData?.[0]?.[1]?.[0]) {
        issueArray = issueData[0][1][0];
      } else if (Array.isArray(issueData)) {
        // Search for the issue array in the nested structure
        for (const item of issueData) {
          if (Array.isArray(item)) {
            for (const subItem of item) {
              if (Array.isArray(subItem) && subItem.length > 5) {
                issueArray = subItem;
                break;
              }
            }
            if (issueArray) break;
          }
        }
      }
      
      if (!issueArray) {
        // Try to extract basic info from the raw data string
        const dataStr = JSON.stringify(issueData);
        const titleMatch = dataStr.match(/"([^"]{10,200})"/);
        return {
          title: titleMatch ? titleMatch[1] : 'Issue data found but structure unknown',
          status: 'Unknown',
          priority: 'Unknown',
          type: 'Unknown',
          severity: 'Unknown',
          reporter: 'Unknown',
          assignee: 'Unknown',
          created: 'Unknown',
          modified: 'Unknown',
          relatedCLs: this.extractRelatedCLsFromString(dataStr)
        };
      }

      // Extract basic issue information
      const title = issueArray[1] || issueArray[0] || 'No title';
      const status = this.getStatusText(issueArray[2]?.[0] || issueArray[2]);
      const priority = this.getPriorityText(issueArray[3]?.[0] || issueArray[3]);
      const type = this.getTypeText(issueArray[4]?.[0] || issueArray[4]);
      const severity = this.getSeverityText(issueArray[5]?.[0] || issueArray[5]);
      
      // Extract timestamps
      const created = this.formatTimestamp(issueArray[8] || issueArray[6]);
      const modified = this.formatTimestamp(issueArray[9] || issueArray[7]);
      
      // Extract reporter and assignee
      const reporter = this.extractUserInfo(issueArray[6] || issueArray[10]);
      const assignee = this.extractUserInfo(issueArray[7] || issueArray[11]);
      
      // Look for related CLs in the issue data
      const relatedCLs = this.extractRelatedCLs(issueArray);
      
      return {
        title,
        status,
        priority,
        type,
        severity,
        reporter,
        assignee,
        created,
        modified,
        relatedCLs
      };
    } catch (error) {
      return {
        title: 'Unknown',
        status: 'Unknown',
        error: `Failed to parse issue data: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private getStatusText(status: number): string {
    const statusMap: { [key: number]: string } = {
      1: 'NEW',
      2: 'ASSIGNED',
      3: 'ACCEPTED',
      4: 'FIXED',
      5: 'VERIFIED',
      6: 'INVALID',
      7: 'WONTFIX',
      8: 'DUPLICATE',
      9: 'ARCHIVED'
    };
    return statusMap[status] || `Status ${status}`;
  }

  private getPriorityText(priority: number): string {
    const priorityMap: { [key: number]: string } = {
      0: 'P0',
      1: 'P1', 
      2: 'P2',
      3: 'P3',
      4: 'P4'
    };
    return priorityMap[priority] || `Priority ${priority}`;
  }

  private getTypeText(type: number): string {
    const typeMap: { [key: number]: string } = {
      1: 'Bug',
      2: 'Feature',
      3: 'Task'
    };
    return typeMap[type] || `Type ${type}`;
  }

  private getSeverityText(severity: number): string {
    const severityMap: { [key: number]: string } = {
      0: 'S0',
      1: 'S1',
      2: 'S2', 
      3: 'S3',
      4: 'S4'
    };
    return severityMap[severity] || `Severity ${severity}`;
  }

  private extractUserInfo(userArray: any): string {
    if (!userArray || !Array.isArray(userArray)) {
      return 'Unknown';
    }
    // User info is typically in the first element as an email
    return userArray[0] || 'Unknown';
  }

  private formatTimestamp(timestampArray: any): string {
    if (!timestampArray || !Array.isArray(timestampArray)) {
      return 'Unknown';
    }
    // Timestamp format: [seconds, nanoseconds]
    const seconds = timestampArray[0];
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000).toISOString();
    }
    return 'Unknown';
  }

  private extractRelatedCLs(issueArray: any): string[] {
    return this.extractRelatedCLsFromString(JSON.stringify(issueArray));
  }

  private extractRelatedCLsFromString(str: string): string[] {
    const cls: string[] = [];
    
    // Look through the data for CL references
    const clMatches = str.match(/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/g);
    
    if (clMatches) {
      clMatches.forEach(match => {
        const clNumber = match.match(/\/(\d+)$/)?.[1];
        if (clNumber && !cls.includes(clNumber)) {
          cls.push(clNumber);
        }
      });
    }
    
    // Also look for simple CL number patterns
    const clNumberMatches = str.match(/CL[\s\-\#]*(\d{6,})/gi);
    if (clNumberMatches) {
      clNumberMatches.forEach(match => {
        const clNumber = match.match(/(\d{6,})/)?.[1];
        if (clNumber && !cls.includes(clNumber)) {
          cls.push(clNumber);
        }
      });
    }
    
    return cls;
  }

  private extractIssueFromHTML(html: string, issueId: string): any {
    // Simple HTML extraction as fallback
    let title = `Issue ${issueId}`;
    let status = 'Unknown';
    
    // Try to extract title from page title, avoiding common false positives
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
      const rawTitle = titleMatch[1].replace(/\s*-\s*Chromium\s*$/i, '').trim();
      // Filter out obvious data structure names
      if (rawTitle && 
          !rawTitle.includes('IssueFetchResponse') && 
          !rawTitle.includes('undefined') &&
          !rawTitle.includes('null') &&
          rawTitle.length > 5) {
        title = rawTitle;
      }
    }
    
    // Try multiple approaches to extract meaningful data
    // Look for metadata in script tags
    const scriptMatches = html.match(/<script[^>]*>(.*?)<\/script>/gis);
    if (scriptMatches) {
      for (const script of scriptMatches) {
        // Look for various data patterns
        const summaryMatch = script.match(/"summary"[^"]*"([^"]{10,})/i);
        if (summaryMatch && !summaryMatch[1].includes('b.IssueFetchResponse')) {
          title = summaryMatch[1];
          break;
        }
        
        const titleMatch = script.match(/"title"[^"]*"([^"]{10,})/i);
        if (titleMatch && !titleMatch[1].includes('b.IssueFetchResponse')) {
          title = titleMatch[1];
          break;
        }
      }
    }
    
    // Try to extract status from common patterns
    const statusMatches = [
      /"state"[^"]*"([^"]+)"/i,
      /"status"[^"]*"([^"]+)"/i,
      /status[^a-zA-Z]*([A-Z][A-Za-z]+)/i,
      /Status:\s*([A-Z][A-Za-z]+)/i
    ];
    
    for (const pattern of statusMatches) {
      const match = html.match(pattern);
      if (match && match[1] !== 'Unknown') {
        status = match[1];
        break;
      }
    }
    
    // Extract related CLs from HTML
    const relatedCLs = this.extractRelatedCLsFromString(html);
    
    return {
      title,
      status,
      priority: 'Unknown',
      type: 'Unknown', 
      severity: 'Unknown',
      reporter: 'Unknown',
      assignee: 'Unknown',
      created: 'Unknown',
      modified: 'Unknown',
      relatedCLs,
      note: 'Basic extraction from HTML - for full details use browser URL'
    };
  }

  private async extractIssueWithBrowser(issueUrl: string, issueId: string): Promise<any> {
    let browser = null;
    try {
      // Launch browser
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      // Set up request interception to capture batch API calls
      const capturedRequests: any[] = [];
      const capturedResponses: any[] = [];
      
      // Enable request interception
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        
        // Log all requests for debugging
        if (url.includes('/batch') || url.includes('googleapis.com') || url.includes('issues.chromium.org')) {
          this.debug(`[DEBUG] Intercepted request: ${request.method()} ${url}`);
          
          capturedRequests.push({
            url,
            method: request.method(),
            headers: request.headers(),
            postData: request.postData()
          });
        }
        
        // Continue with the request
        await route.continue();
      });
      
      // Capture responses
      page.on('response', async (response) => {
        const url = response.url();
        
        if (url.includes('/batch') || url.includes('googleapis.com')) {
          this.debug(`[DEBUG] Captured response: ${response.status()} ${url}`);
          
          try {
            const responseText = await response.text();
            capturedResponses.push({
              url,
              status: response.status(),
              headers: response.headers(),
              body: responseText
            });
          } catch (e) {
            this.debug(`[DEBUG] Could not capture response body: ${e}`);
          }
        }
      });
      
      // Navigate to issue page
      await page.goto(issueUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait for page to load and batch requests to complete
      await page.waitForTimeout(5000);
      
      // Try to wait for some common elements that indicate the page has loaded
      try {
        await page.waitForSelector('body', { timeout: 5000 });
      } catch (e) {
        // Continue anyway
      }
      
      // Try to parse batch API responses first
      const batchApiData = this.parseBatchAPIResponses(capturedResponses, issueId);
      
      // Extract issue information using multiple strategies
      const issueInfo = await page.evaluate((issueId: string) => {
        const result = {
          title: `Issue ${issueId}`,
          status: 'Unknown',
          priority: 'Unknown',
          type: 'Unknown',
          severity: 'Unknown',
          reporter: 'Unknown',
          assignee: 'Unknown',
          description: '',
          relatedCLs: [] as string[]
        };
        
        // Strategy 1: Try to find issue title in common selectors
        const titleSelectors = [
          '[data-testid="issue-title"]',
          '.issue-title',
          'h1',
          'h2',
          '[role="heading"]',
          '.MdcTextField-Input',
          '[aria-label*="title"]',
          '[title]',
          '.title',
          'input[type="text"]',
          'textarea'
        ];
        
        for (const selector of titleSelectors) {
          const element = (window as any).document.querySelector(selector);
          if (element && element.textContent && element.textContent.trim().length > 5) {
            const text = element.textContent.trim();
            if (!text.includes('Issue ') && !text.includes('Unknown') && text.length > 10) {
              result.title = text;
              break;
            }
          }
        }
        
        // Strategy 2: Look for status indicators
        const statusSelectors = [
          '[data-testid="status"]',
          '.status',
          '.issue-status',
          '[aria-label*="status"]'
        ];
        
        for (const selector of statusSelectors) {
          const element = (window as any).document.querySelector(selector);
          if (element && element.textContent) {
            const status = element.textContent.trim().toUpperCase();
            if (['NEW', 'ASSIGNED', 'ACCEPTED', 'FIXED', 'VERIFIED', 'INVALID', 'WONTFIX', 'DUPLICATE'].includes(status)) {
              result.status = status;
              break;
            }
          }
        }
        
        // Strategy 3: Extract description content
        const descriptionSelectors = [
          '[data-testid="description"]',
          '.issue-description',
          '.description',
          '[role="textbox"]',
          '.ql-editor',
          '.comment-content'
        ];
        
        for (const selector of descriptionSelectors) {
          const element = (window as any).document.querySelector(selector);
          if (element && element.textContent && element.textContent.trim().length > 20) {
            result.description = element.textContent.trim().substring(0, 500);
            break;
          }
        }
        
        // Strategy 4: Look for metadata in any visible text
        const pageText = (window as any).document.body.textContent || '';
        
        // Try to extract title from page title as fallback
        const pageTitle = (window as any).document.title;
        if (pageTitle && pageTitle.length > 5 && !pageTitle.includes('Chrome') && result.title.includes('Issue ')) {
          result.title = pageTitle.replace(/\s*-.*$/, '').trim();
        }
        
        // Look for priority patterns
        const priorityMatch = pageText.match(/P[0-4]/);
        if (priorityMatch) {
          result.priority = priorityMatch[0];
        }
        
        // Look for type patterns
        const typeMatch = pageText.match(/Type:\s*(Bug|Feature|Task)/i);
        if (typeMatch) {
          result.type = typeMatch[1];
        }
        
        // Look for reporter/assignee patterns
        const reporterMatch = pageText.match(/Reporter:\s*([^\n]+)/i);
        if (reporterMatch) {
          result.reporter = reporterMatch[1].trim();
        }
        
        const assigneeMatch = pageText.match(/Assignee:\s*([^\n]+)/i);
        if (assigneeMatch) {
          result.assignee = assigneeMatch[1].trim();
        }
        
        // Strategy 5: Extract CL references from page
        const clMatches = pageText.match(/(?:CL|chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/)[\s#]*(\d{6,})/g);
        if (clMatches) {
          const cls = new Set<string>();
          clMatches.forEach((match: string) => {
            const clNumber = match.match(/(\d{6,})/)?.[1];
            if (clNumber) {
              cls.add(clNumber);
            }
          });
          result.relatedCLs = Array.from(cls);
        }
        
        return result;
      }, issueId);
      
      // Merge batch API data with extracted data, preferring batch API data when available
      const mergedData = {
        ...issueInfo,
        ...batchApiData,
        batchApiDebug: {
          requestsCaptured: capturedRequests.length,
          responsesCaptured: capturedResponses.length,
          batchRequestsFound: capturedRequests.filter(r => r.url.includes('/batch')).length,
          batchResponsesFound: capturedResponses.filter(r => r.url.includes('/batch')).length
        }
      };
      
      return mergedData;
      
    } catch (error) {
      return {
        title: `Issue ${issueId}`,
        status: 'Unknown',
        error: `Browser extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        note: 'Browser automation failed - data may be incomplete'
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private parseBatchAPIResponses(responses: any[], issueId: string): any {
    const result: any = {};

    for (const response of responses) {
      if (!response.body || (!response.url.includes('/batch') && !response.url.includes('/events'))) {
        continue;
      }

      try {
        this.debug(`[DEBUG] Parsing response from ${response.url}`);
        
        let responseData = response.body;
        
        // Remove the security prefix if present
        if (responseData.startsWith(")]}'")){
          responseData = responseData.substring(4).trim();
        }
        
        // Try to parse as JSON array
        let batchData;
        try {
          batchData = JSON.parse(responseData);
        } catch (e) {
          this.debug(`[DEBUG] Could not parse response as JSON: ${e}`);
          continue;
        }
        
        if (Array.isArray(batchData)) {
          this.extractIssueDataFromBatchArray(batchData, result, issueId);
        }
        
      } catch (error) {
        this.debug(`[DEBUG] Error parsing response: ${error}`);
      }
    }

    this.debug(`[DEBUG] Final extracted batch data:`, result);
    return result;
  }

  private async getIssueDirectAPI(issueId: string): Promise<any> {
    const baseUrl = 'https://issues.chromium.org';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${baseUrl}/issues/${issueId}`
    };

    const result: any = {
      title: undefined,
      status: undefined,
      priority: undefined,
      type: undefined,
      severity: undefined,
      reporter: undefined,
      assignee: undefined,
      description: undefined,
      comments: [],
      relatedCLs: []
    };

    try {
      // 1. Get issue summary/details
      try {
        const summaryResponse = await fetch(`${baseUrl}/action/issues/${issueId}/getSummary`, {
          method: 'POST',
          headers
        });
        
        if (summaryResponse.ok) {
          const summaryText = await summaryResponse.text();
          const summaryData = this.parseResponseData(summaryText);
          if (summaryData) {
            this.extractIssueDataFromBatchArray(summaryData, result, issueId);
          }
        }
      } catch (e) {
        this.debug(`[DEBUG] Summary API failed: ${e}`);
      }

      // 2. Get issue events (contains comments, status changes, etc.)
      try {
        const eventsResponse = await fetch(`${baseUrl}/action/issues/${issueId}/events?currentTrackerId=157`, {
          headers
        });
        
        if (eventsResponse.ok) {
          const eventsText = await eventsResponse.text();
          this.debug(`[DEBUG] Events API successful, length: ${eventsText.length}`);
          
          const eventsData = this.parseResponseData(eventsText);
          if (eventsData) {
            this.debug(`[DEBUG] Processing events data with ${eventsData.length} items`);
            this.extractEventsData(eventsData, result, issueId);
          }
        }
      } catch (e) {
        this.debug(`[DEBUG] Events API failed: ${e}`);
      }

      // 3. Get comments from events (more reliable than batch API)
      try {
        // Try a simpler comments endpoint first
        const commentsResponse = await fetch(`${baseUrl}/action/comments/batch`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([
            ["b.BatchGetIssueCommentsRequest", {
              "issueId": parseInt(issueId),
              "maxComments": 50
            }]
          ])
        });
        
        if (commentsResponse.ok) {
          const commentsText = await commentsResponse.text();
          this.debug(`[DEBUG] Comments batch successful, length: ${commentsText.length}`);
          
          const commentsData = this.parseResponseData(commentsText);
          if (commentsData) {
            this.debug(`[DEBUG] Found ${commentsData.length} top-level items in comments response`);
            this.extractCommentsAndIssueText(commentsData, result, issueId);
          }
        } else {
          this.debug(`[DEBUG] Comments batch failed with ${commentsResponse.status}, trying events API for comments`);
          
          // Extract comments from events API response which we already have
          if (result.comments && result.comments.length === 0) {
            // Parse events for comments instead
            this.extractCommentsFromEventsData(result);
          }
        }
      } catch (e) {
        this.debug(`[DEBUG] Comments extraction failed: ${e}`);
      }

      // Clean up undefined values
      Object.keys(result).forEach(key => {
        if (result[key] === undefined) {
          delete result[key];
        }
      });

      this.debug(`[DEBUG] Direct API extracted data:`, result);
      return result;

    } catch (error) {
      this.debug(`[DEBUG] Direct API extraction failed: ${error}`);
      throw error;
    }
  }

  private parseResponseData(responseText: string): any {
    if (!responseText) return null;
    
    let data = responseText.trim();
    
    // Remove security prefix if present
    if (data.startsWith(")]}'")){
      data = data.substring(4).trim();
    }
    
    try {
      return JSON.parse(data);
    } catch (e) {
      // Try to extract JSON arrays from the response
      const jsonMatch = data.match(/\[\[.*?\]\]/s);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e2) {
          this.debug(`[DEBUG] Could not parse extracted JSON: ${e2}`);
        }
      }
      return null;
    }
  }

  private extractCommentsAndIssueText(commentsData: any, result: any, issueId: string): void {
    if (!Array.isArray(commentsData)) return;
    
    // Parse the response structure - based on what we saw earlier
    // The structure appears to be: [["b.BatchGetIssueCommentsResponse", null, [comments_array]]]
    
    for (const item of commentsData) {
      if (Array.isArray(item) && item.length >= 3) {
        const responseType = item[0];
        const commentsArray = item[2];
        
        if (typeof responseType === 'string' && responseType.includes('BatchGetIssueCommentsResponse') && Array.isArray(commentsArray)) {
          this.debug(`[DEBUG] Found BatchGetIssueCommentsResponse with ${commentsArray.length} items`);
          this.parseCommentsArray(commentsArray, result, issueId);
        }
      }
    }
  }

  private parseCommentsArray(commentsArray: any[], result: any, issueId: string): void {
    if (!result.comments) result.comments = [];
    
    for (const commentData of commentsArray) {
      if (!Array.isArray(commentData)) continue;
      
      try {
        // Based on the structure we observed:
        // Each comment seems to have: [author, null, timestamp, content, ...]
        const comment = this.parseCommentStructure(commentData);
        if (comment && !this.isEmptyMigrationComment(comment)) {
          result.comments.push(comment);
          
          // Extract issue title from first comment if it's the main description
          if (result.comments.length === 1 && comment.content && comment.content.length > 20) {
            // Try to extract a meaningful title from the first few lines
            const lines = comment.content.split('\n');
            const firstLine = lines[0]?.trim();
            if (firstLine && firstLine.length > 10 && firstLine.length < 200 && !result.title) {
              result.title = firstLine;
              this.debug(`[DEBUG] Extracted title from first comment: ${firstLine}`);
            }
            
            // The first comment is usually the issue description
            if (!result.description) {
              result.description = comment.content;
            }
          }
          
          // Extract CL references from comment content
          this.extractCLReferencesFromText(comment.content, result);
        }
      } catch (e) {
        this.debug(`[DEBUG] Error parsing comment: ${e}`);
      }
    }
  }

  private parseCommentStructure(commentData: any[]): any | null {
    if (!Array.isArray(commentData) || commentData.length < 4) return null;
    
    try {
      // Based on observed structure: [author_info, null, timestamp_info, content, ...]
      const authorInfo = commentData[0]; // Usually an email or array with email
      const timestampInfo = commentData[2]; // Usually [seconds, nanoseconds]
      const contentInfo = commentData[3]; // Content or content wrapper
      
      let author = 'Unknown';
      if (typeof authorInfo === 'string') {
        author = authorInfo;
      } else if (Array.isArray(authorInfo) && authorInfo[0]) {
        author = authorInfo[0];
      }
      
      let timestamp = null;
      if (Array.isArray(timestampInfo) && timestampInfo[0]) {
        const seconds = timestampInfo[0];
        if (typeof seconds === 'number') {
          timestamp = new Date(seconds * 1000).toISOString();
        }
      }
      
      let content = '';
      if (typeof contentInfo === 'string') {
        content = contentInfo;
      } else if (Array.isArray(contentInfo)) {
        // Look for content in nested structure
        content = this.extractContentFromStructure(contentInfo);
      }
      
      if (content && content.length > 0) {
        return {
          author,
          timestamp,
          content: this.cleanupCommentContent(content)
        };
      }
      
      return null;
    } catch (e) {
      this.debug(`[DEBUG] Error in parseCommentStructure: ${e}`);
      return null;
    }
  }

  private extractContentFromStructure(structure: any): string {
    if (typeof structure === 'string') return structure;
    if (!Array.isArray(structure)) return '';
    
    let content = '';
    for (const item of structure) {
      if (typeof item === 'string' && item.length > 0) {
        content += item + ' ';
      } else if (Array.isArray(item)) {
        content += this.extractContentFromStructure(item);
      }
    }
    
    return content.trim();
  }

  private cleanupCommentContent(content: string): string {
    // Remove HTML tags and decode entities
    return content
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private extractCLReferencesFromText(text: string, result: any): void {
    if (!text) return;
    
    const clMatches = text.match(/(?:CL|chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/)\s*(\d{6,})/g);
    if (clMatches) {
      if (!result.relatedCLs) result.relatedCLs = [];
      clMatches.forEach(match => {
        const clNumber = match.match(/(\d{6,})/)?.[1];
        if (clNumber && !result.relatedCLs.includes(clNumber)) {
          result.relatedCLs.push(clNumber);
          this.debug(`[DEBUG] Found CL: ${clNumber}`);
        }
      });
    }
  }

  private extractEventsData(eventsData: any[], result: any, issueId: string): void {
    if (!Array.isArray(eventsData)) return;
    
    // Based on the structure you showed, events contain the detailed issue info and comments
    for (const item of eventsData) {
      if (Array.isArray(item) && item.length >= 3) {
        const responseType = item[0];
        const eventsArray = item[2];
        
        if (typeof responseType === 'string' && responseType.includes('ListIssueEventsResponse') && Array.isArray(eventsArray)) {
          this.debug(`[DEBUG] Found ListIssueEventsResponse with ${eventsArray.length} events`);
          this.parseEventsArray(eventsArray, result, issueId);
        }
      }
    }
  }

  private parseEventsArray(eventsArray: any[], result: any, issueId: string): void {
    if (!result.comments) result.comments = [];
    
    this.debug(`[DEBUG] Parsing ${eventsArray.length} events`);
    
    for (let i = 0; i < eventsArray.length; i++) {
      const event = eventsArray[i];
      
      if (!Array.isArray(event)) {
        continue;
      }
      
      try {
        // Look for metadata in event structure first
        // Event structure appears to be: [author, timestamp, content, ..., metadata, ...]
        
        // Try to extract metadata from the later positions in the event
        if (event.length >= 6 && Array.isArray(event[5])) {
          this.extractIssueMetadata(event[5], result);
        }
        
        // Look for content in different positions based on actual structure
        let content = '';
        let author = 'Unknown';
        let timestamp = null;
        
        // Based on the structure we observed:
        // event[2] can be a string (for comments) or complex array (for issue description)  
        // event[0][1] contains the author email  
        // event[1][0] contains the timestamp
        
        if (typeof event[2] === 'string' && event[2].length > 20) {
          content = event[2];
          this.debug(`[DEBUG] Found string content at position 2: ${content.substring(0, 100)}...`);
        } else if (Array.isArray(event[2]) && event[2][0] && typeof event[2][0] === 'string' && event[2][0].length > 20) {
          // For the issue description, the content is in event[2][0]
          content = event[2][0];
          this.debug(`[DEBUG] Found array content at position 2[0]: ${content.substring(0, 100)}...`);
        }
        
        if (content) {
          // Extract author and timestamp based on observed structure
          if (Array.isArray(event[0]) && event[0][1]) {
            author = event[0][1];
          }
          
          if (Array.isArray(event[1]) && event[1][0]) {
            const seconds = event[1][0];
            if (typeof seconds === 'number') {
              timestamp = new Date(seconds * 1000).toISOString();
            }
          }
          
          const comment = {
            author,
            timestamp,
            content: this.cleanupCommentContent(content)
          };
          
          // Skip empty migration comments
          if (!this.isEmptyMigrationComment(comment)) {
            result.comments.push(comment);
          } else {
            this.debug(`[DEBUG] Skipped empty migration comment from ${author}`);
            continue;
          }
          this.debug(`[DEBUG] Added comment from ${author}: ${content.substring(0, 50)}...`);
          
          // Extract CL references from comment content
          this.extractCLReferencesFromText(comment.content, result);
          
          // If this is the first comment, it might be the issue description
          if (result.comments.length === 1 && !result.description) {
            result.description = comment.content;
          }
        }
      } catch (e) {
        this.debug(`[DEBUG] Error parsing event ${i}: ${e}`);
      }
    }
  }

  private parseEventComment(event: any[]): any | null {
    try {
      const authorInfo = event[0];
      const timestampInfo = event[2]; 
      const content = event[3];
      
      let author = 'Unknown';
      if (Array.isArray(authorInfo) && authorInfo[0]) {
        author = authorInfo[0];
      } else if (typeof authorInfo === 'string') {
        author = authorInfo;
      }
      
      let timestamp = null;
      if (Array.isArray(timestampInfo) && timestampInfo[0]) {
        const seconds = timestampInfo[0];
        if (typeof seconds === 'number') {
          timestamp = new Date(seconds * 1000).toISOString();
        }
      }
      
      if (content && content.length > 0) {
        return {
          author,
          timestamp,
          content: this.cleanupCommentContent(content)
        };
      }
      
      return null;
    } catch (e) {
      this.debug(`[DEBUG] Error in parseEventComment: ${e}`);
      return null;
    }
  }

  private extractIssueMetadata(metadataArray: any[], result: any): void {
    if (!Array.isArray(metadataArray)) return;
    
    this.debug(`[DEBUG] Extracting metadata from array with ${metadataArray.length} items`);
    
    for (const item of metadataArray) {
      if (!Array.isArray(item) || item.length < 2) continue;
      
      const fieldName = item[0];
      this.debug(`[DEBUG] Processing metadata field: ${fieldName}`, JSON.stringify(item, null, 2).substring(0, 300));
      
      try {
        if (typeof fieldName === 'string') {
          switch (fieldName) {
            case 'title':
              // Structure: ["title", null, [null, ["type.googleapis.com/google.protobuf.StringValue", ["Actual Title"]]]]
              const titleValue = this.extractNestedProtobufValue(item, 'StringValue');
              if (titleValue) {
                result.title = titleValue;
                this.debug(`[DEBUG] Found title: ${result.title}`);
              }
              break;
              
            case 'status':
              // Structure: ["status", null, [null, ["type.googleapis.com/google.protobuf.Int32Value", [1]]]]
              const statusValue = this.extractNestedProtobufValue(item, 'Int32Value');
              if (typeof statusValue === 'number') {
                result.status = this.getStatusText(statusValue);
                this.debug(`[DEBUG] Found status: ${result.status} (${statusValue})`);
              }
              break;
              
            case 'priority':
              const priorityValue = this.extractNestedProtobufValue(item, 'Int32Value');
              if (typeof priorityValue === 'number') {
                result.priority = this.getPriorityText(priorityValue);
                this.debug(`[DEBUG] Found priority: ${result.priority} (${priorityValue})`);
              }
              break;
              
            case 'type':
              const typeValue = this.extractNestedProtobufValue(item, 'Int32Value');
              if (typeof typeValue === 'number') {
                result.type = this.getTypeText(typeValue);
                this.debug(`[DEBUG] Found type: ${result.type} (${typeValue})`);
              }
              break;
              
            case 'severity':
              const severityValue = this.extractNestedProtobufValue(item, 'Int32Value');
              if (typeof severityValue === 'number') {
                result.severity = this.getSeverityText(severityValue);
                this.debug(`[DEBUG] Found severity: ${result.severity} (${severityValue})`);
              }
              break;
              
            case 'reporter':
              // Structure: ["reporter", null, [null, ["type.googleapis.com/google.devtools.issuetracker.v1.User", [null, "email@domain.com", ...]]]]
              const reporterUser = this.extractUserFromProtobuf(item);
              if (reporterUser) {
                result.reporter = reporterUser;
                this.debug(`[DEBUG] Found reporter: ${result.reporter}`);
              }
              break;
              
            case 'assignee':
              const assigneeUser = this.extractUserFromProtobuf(item);
              if (assigneeUser) {
                result.assignee = assigneeUser;
                this.debug(`[DEBUG] Found assignee: ${result.assignee}`);
              }
              break;
          }
        }
      } catch (e) {
        this.debug(`[DEBUG] Error parsing metadata field ${fieldName}: ${e}`);
      }
    }
  }

  private extractNestedProtobufValue(item: any[], valueType: string): any {
    // Navigate the nested protobuf structure to find the actual value
    // Typical structure: [fieldName, null, [null, [protobuf_type, [actual_value]]]]
    
    if (!Array.isArray(item) || item.length < 3) return null;
    
    const nestedArray = item[2];
    if (!Array.isArray(nestedArray) || nestedArray.length < 2) return null;
    
    const protobufWrapper = nestedArray[1];
    if (!Array.isArray(protobufWrapper) || protobufWrapper.length < 2) return null;
    
    const protobufType = protobufWrapper[0];
    const value = protobufWrapper[1];
    
    if (typeof protobufType === 'string' && protobufType.includes(valueType) && Array.isArray(value)) {
      // For StringValue and Int32Value, the actual value is in value[0]
      // For User, the email is typically in value[0]
      return value[0];
    }
    
    return null;
  }

  private extractUserFromProtobuf(item: any[]): string | null {
    // User structure: ["reporter", null, [null, ["type.googleapis.com/google.devtools.issuetracker.v1.User", [null, "email@domain.com", ...]]]]
    
    if (!Array.isArray(item) || item.length < 3) return null;
    
    const nestedArray = item[2];
    if (!Array.isArray(nestedArray) || nestedArray.length < 2) return null;
    
    const protobufWrapper = nestedArray[1];
    if (!Array.isArray(protobufWrapper) || protobufWrapper.length < 2) return null;
    
    const protobufType = protobufWrapper[0];
    const userArray = protobufWrapper[1];
    
    if (typeof protobufType === 'string' && protobufType.includes('User') && Array.isArray(userArray)) {
      // User array structure: [null, "email@domain.com", numeric_id, [permissions]]
      // The email is at position 1
      if (userArray.length > 1 && typeof userArray[1] === 'string') {
        return userArray[1];
      }
    }
    
    return null;
  }

  private extractCommentsFromEventsData(result: any): void {
    this.debug(`[DEBUG] Attempting to extract comments from events data`);
  }

  private extractIssueDataFromBatchArray(batchArray: any[], result: any, issueId: string): void {
    for (const item of batchArray) {
      if (Array.isArray(item)) {
        this.extractIssueDataFromBatchArray(item, result, issueId);
      } else if (typeof item === 'string') {
        // Look for meaningful strings like titles, descriptions, etc.
        if (item.length > 20 && !item.includes('Response') && !item.includes('b.')) {
          if (!result.title && item.length < 200) {
            result.title = item;
            this.debug(`[DEBUG] Found title: ${item}`);
          } else if (!result.description && item.length > 50) {
            result.description = item.substring(0, 500);
            this.debug(`[DEBUG] Found description: ${item.substring(0, 100)}...`);
          }
          
          // Extract CL references
          this.extractCLReferencesFromText(item, result);
        }
      } else if (typeof item === 'object' && item !== null) {
        // Look for structured data patterns that might contain issue info
        if (typeof item[0] === 'string') {
          const potentialTitle = item[0];
          if (potentialTitle && potentialTitle.length > 20 && potentialTitle.length < 200 && !result.title) {
            result.title = potentialTitle;
            this.debug(`[DEBUG] Found structured title: ${potentialTitle}`);
          }
        }
      }
    }
  }

  private isEmptyMigrationComment(comment: any): boolean {
    if (!comment || !comment.content) return false;
    
    const content = comment.content.toLowerCase().trim();
    return content === "[empty comment from monorail migration]" || 
           content === "empty comment from monorail migration" ||
           content.includes("empty comment from monorail migration");
  }

  // PDFium Gerrit operations
  async getPdfiumGerritCLStatus(clNumber: string): Promise<any> {
    try {
      // Extract CL number from URL if needed
      const clNum = this.extractCLNumber(clNumber);
      const gerritUrl = `https://pdfium-review.googlesource.com/changes/${clNum}?o=CURRENT_REVISION&o=DETAILED_ACCOUNTS&o=SUBMIT_REQUIREMENTS&o=CURRENT_COMMIT`;
      
      const response = await fetch(gerritUrl);
      if (!response.ok) {
        throw new GerritAPIError(`Failed to fetch PDFium CL status: ${response.status}`, response.status);
      }
      
      const text = await response.text();
      // Remove XSSI protection prefix
      const jsonText = text.replace(/^\)\]\}'\n/, '');
      return JSON.parse(jsonText);
      
    } catch (error: any) {
      throw new GerritAPIError(`PDFium Gerrit API error: ${error.message}`, undefined, error);
    }
  }

  async getPdfiumGerritCLComments(params: GetGerritCLCommentsParams): Promise<any> {
    try {
      const clNum = this.extractCLNumber(params.clNumber);
      const gerritUrl = `https://pdfium-review.googlesource.com/changes/${clNum}/comments`;
      
      const response = await fetch(gerritUrl);
      if (!response.ok) {
        throw new GerritAPIError(`Failed to fetch PDFium CL comments: ${response.status}`, response.status);
      }
      
      const text = await response.text();
      const jsonText = text.replace(/^\)\]\}'\n/, '');
      return JSON.parse(jsonText);
      
    } catch (error: any) {
      throw new GerritAPIError(`PDFium Gerrit comments API error: ${error.message}`, undefined, error);
    }
  }

  async getPdfiumGerritCLDiff(params: GetGerritCLDiffParams): Promise<any> {
    const clId = this.extractCLNumber(params.clNumber);
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://pdfium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
      const clResponse = await fetch(clDetailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!clResponse.ok) {
        throw new Error(`Failed to fetch PDFium CL details: ${clResponse.status}`);
      }
      
      const responseText = await clResponse.text();
      const jsonText = responseText.replace(/^\)\]\}'\n/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`PDFium CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = params.patchset || cl.current_revision_number || 1;
      const revision = cl.revisions[cl.current_revision];
      
      // Get the files list first to understand what changed
      const filesUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files`;
      const filesResponse = await fetch(filesUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!filesResponse.ok) {
        throw new Error(`Failed to fetch PDFium files: ${filesResponse.status}`);
      }
      
      const filesText = await filesResponse.text();
      const filesJsonText = filesText.replace(/^\)\]\}'\n/, '');
      const filesData = JSON.parse(filesJsonText);
      
      const changedFiles = Object.keys(filesData).filter(f => f !== '/COMMIT_MSG');
      
      const result: any = {
        clId,
        subject: cl.subject,
        patchset: targetPatchset,
        author: cl.owner.name,
        changedFiles,
        filesData,
        revision,
        isPdfium: true
      };
      
      if (params.filePath) {
        // Get diff for specific file
        if (!filesData[params.filePath]) {
          result.error = `File ${params.filePath} not found in PDFium patchset ${targetPatchset}`;
          return result;
        }
        
        const diffUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(params.filePath)}/diff?base=${targetPatchset-1}&context=ALL&intraline`;
        const diffResponse = await fetch(diffUrl, {
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (diffResponse.ok) {
          const diffText = await diffResponse.text();
          const diffJsonText = diffText.replace(/^\)\]\}'\n/, '');
          result.diffData = JSON.parse(diffJsonText);
        }
      }
      
      return result;
      
    } catch (error: any) {
      throw new GerritAPIError(`Failed to get PDFium CL diff: ${error.message}`, undefined, error);
    }
  }

  async getPdfiumGerritPatchsetFile(params: GetGerritPatchsetFileParams): Promise<any> {
    const clId = this.extractCLNumber(params.clNumber);
    
    try {
      // First get CL details to know current patchset if not specified
      const clDetailsUrl = `https://pdfium-review.googlesource.com/changes/?q=change:${clId}&o=CURRENT_REVISION`;
      const clResponse = await fetch(clDetailsUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!clResponse.ok) {
        throw new Error(`Failed to fetch PDFium CL details: ${clResponse.status}`);
      }
      
      const responseText = await clResponse.text();
      const jsonText = responseText.replace(/^\)\]\}'\n/, '');
      const clData = JSON.parse(jsonText);
      
      if (!clData || clData.length === 0) {
        throw new Error(`PDFium CL ${clId} not found`);
      }
      
      const cl = clData[0];
      const targetPatchset = params.patchset || cl.current_revision_number || 1;
      
      // Get the file content from the patchset
      const fileUrl = `https://pdfium-review.googlesource.com/changes/${clId}/revisions/${targetPatchset}/files/${encodeURIComponent(params.filePath)}/content`;
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'Accept': 'text/plain',
        },
      });
      
      if (!fileResponse.ok) {
        if (fileResponse.status === 404) {
          throw new Error(`File ${params.filePath} not found in PDFium patchset ${targetPatchset}`);
        }
        throw new Error(`Failed to fetch PDFium file content: ${fileResponse.status}`);
      }
      
      // Gerrit returns base64 encoded content
      const base64Content = await fileResponse.text();
      const content = Buffer.from(base64Content, 'base64').toString('utf-8');
      
      return {
        clId,
        subject: cl.subject,
        patchset: targetPatchset,
        author: cl.owner.name,
        filePath: params.filePath,
        content,
        lines: content.split('\n').length,
        isPdfium: true
      };
      
    } catch (error: any) {
      throw new GerritAPIError(`Failed to get PDFium file content: ${error.message}`, undefined, error);
    }
  }

  async searchIssues(query: string, options: { limit?: number; startIndex?: number } = {}): Promise<any> {
    const { limit = 50, startIndex = 0 } = options;
    
    this.debug(`[DEBUG] Searching issues with query: "${query}", limit: ${limit}, startIndex: ${startIndex}`);
    
    try {
      const baseUrl = 'https://issues.chromium.org';
      const endpoint = '/action/issues/list';
      
      // Based on the curl command structure: [null,null,null,null,null,["157"],["pkasting","modified_time desc",50,"start_index:0"]]
      const searchParams = [query, "modified_time desc", limit];
      if (startIndex > 0) {
        searchParams.push(`start_index:${startIndex}`);
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
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      this.debug(`[DEBUG] Raw response length: ${text.length} characters`);
      
      // Strip the XSSI protection prefix ")]}'\n" if present
      let cleanText = text;
      if (text.startsWith(")]}'\n")) {
        cleanText = text.substring(5);
        this.debug(`[DEBUG] Stripped XSSI protection prefix`);
      } else if (text.startsWith(")]}'")) {
        cleanText = text.substring(4);
        this.debug(`[DEBUG] Stripped alternative XSSI protection prefix`);
      }
      
      // Parse the response (should be JSON)
      const data = JSON.parse(cleanText);
      this.debug(`[DEBUG] Parsed response structure:`, typeof data, Array.isArray(data));
      this.debug(`[DEBUG] Response top-level structure:`, data.length ? `Array of ${data.length} items` : 'Not an array');
      
      // Extract issues from the response
      const issues = this.parseIssueSearchResults(data, query);
      
      return {
        query,
        total: issues.length,
        issues,
        searchUrl: `${baseUrl}/issues?q=${encodeURIComponent(query)}`
      };
      
    } catch (error) {
      this.debug(`[ERROR] Issue search failed:`, error);
      throw new ChromiumSearchError(
        `Failed to search issues: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private parseIssueSearchResults(data: any, query: string): any[] {
    this.debug(`[DEBUG] Parsing issue search results for query: "${query}"`);
    
    const issues: any[] = [];
    
    // The response structure is: [{ 0: "b.IssueSearchResponse", ..., 6: [[[issueData, ...]], ...] }]
    try {
      if (data && data[0] && data[0][6] && Array.isArray(data[0][6])) {
        const issueContainer = data[0][6];
        this.debug(`[DEBUG] Found issue container with ${issueContainer.length} items`);
        
        for (let i = 0; i < issueContainer.length; i++) {
          const item = issueContainer[i];
          
          if (Array.isArray(item)) {
            // Check if this is a direct issue array
            if (item.length > 5 && typeof item[1] === 'number' && item[1] > 1000000) {
              const issue = this.parseIssueFromProtobufArray(item);
              if (issue) {
                issues.push(issue);
                this.debug(`[DEBUG] Parsed issue: ${issue.issueId}`);
              }
            }
            // Check if this contains nested issue arrays - look through all positions
            else if (item.length > 0) {
              for (let j = 0; j < item.length; j++) {
                if (Array.isArray(item[j]) && item[j].length > 5) {
                  // Check if this looks like an issue array (has issue ID at position 1)
                  if (typeof item[j][1] === 'number' && item[j][1] > 1000000) {
                    const issue = this.parseIssueFromProtobufArray(item[j]);
                    if (issue) {
                      issues.push(issue);
                      this.debug(`[DEBUG] Parsed issue: ${issue.issueId}`);
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        this.debug(`[DEBUG] Expected structure not found in response`);
      }
    } catch (error) {
      this.debug(`[DEBUG] Error parsing issue search results:`, error);
    }
    
    this.debug(`[DEBUG] Found ${issues.length} issues in search results`);
    
    return issues.map(issue => this.normalizeIssueSearchResult(issue));
  }

  private parseIssueFromProtobufArray(arr: any[]): any | null {
    try {
      // Based on the structure observed:
      // [null, issueId, [nested_data], timestamp1, timestamp2, null, null, null, status_num, [priority], ...]
      
      const issue: any = {};
      
      // Issue ID is at position 1 (this appears to be the correct main issue ID)
      if (arr[1] && typeof arr[1] === 'number') {
        issue.issueId = arr[1].toString();
      }
      
      // Nested issue data is at position 2
      if (arr[2] && Array.isArray(arr[2]) && arr[2].length > 5) {
        const nestedData = arr[2];
        
        // Don't override the main issue ID with the nested one
        // The nested ID might be different (internal ID vs public ID)
        
        // Title at nestedData[5]
        if (nestedData[5] && typeof nestedData[5] === 'string') {
          issue.title = nestedData[5];
        }
        
        // Reporter at nestedData[6] - format: [null, "email", 1]
        if (nestedData[6] && Array.isArray(nestedData[6]) && nestedData[6][1]) {
          issue.reporter = nestedData[6][1];
        }
        
        // Assignee at nestedData[7] - format: [null, "email", 1]
        if (nestedData[7] && Array.isArray(nestedData[7]) && nestedData[7][1]) {
          issue.assignee = nestedData[7][1];
        }
        
        // Status (numeric) might be at position 1, 2, 3, or 4
        if (typeof nestedData[1] === 'number') {
          issue.statusNum = nestedData[1];
          issue.status = this.getIssueStatusFromNumber(nestedData[1]);
        }
        
        // Priority (numeric) might be at position 2
        if (typeof nestedData[2] === 'number') {
          issue.priorityNum = nestedData[2];
          issue.priority = `P${nestedData[2]}`;
        }
        
        // Type (numeric) might be at position 3
        if (typeof nestedData[3] === 'number') {
          issue.typeNum = nestedData[3];
          issue.type = this.getIssueTypeFromNumber(nestedData[3]);
        }
        
        // Severity (numeric) might be at position 4
        if (typeof nestedData[4] === 'number') {
          issue.severityNum = nestedData[4];
          issue.severity = `S${nestedData[4]}`;
        }
      }
      
      // Timestamps
      if (arr[3] && typeof arr[3] === 'number') {
        issue.created = new Date(arr[3] * 1000).toISOString();
      }
      
      if (arr[4] && Array.isArray(arr[4]) && arr[4][0]) {
        issue.modified = new Date(arr[4][0] * 1000).toISOString();
      }
      
      // Status and priority might also be in later positions
      if (arr[8] && typeof arr[8] === 'number') {
        issue.statusNum = arr[8];
        issue.status = this.getIssueStatusFromNumber(arr[8]);
      }
      
      if (arr[9] && Array.isArray(arr[9]) && arr[9][0]) {
        issue.priorityNum = arr[9][0];
        issue.priority = `P${arr[9][0]}`;
      }
      
      if (issue.issueId) {
        issue.browserUrl = `https://issues.chromium.org/issues/${issue.issueId}`;
        return issue;
      }
      
      return null;
    } catch (error) {
      this.debug(`[DEBUG] Error parsing single issue:`, error);
      return null;
    }
  }

  private getIssueStatusFromNumber(statusNum: number): string {
    // Common status mappings (may need adjustment based on actual data)
    const statusMap: { [key: number]: string } = {
      1: 'NEW',
      2: 'ASSIGNED', 
      3: 'ACCEPTED',
      4: 'FIXED',
      5: 'VERIFIED',
      6: 'CLOSED',
      7: 'DUPLICATE',
      8: 'WontFix',
      9: 'Invalid'
    };
    
    return statusMap[statusNum] || `Status${statusNum}`;
  }

  private getIssueTypeFromNumber(typeNum: number): string {
    // Common type mappings (may need adjustment based on actual data)
    const typeMap: { [key: number]: string } = {
      1: 'Bug',
      2: 'Feature',
      3: 'Task',
      4: 'Enhancement'
    };
    
    return typeMap[typeNum] || `Type${typeNum}`;
  }

  private looksLikeIssueObject(obj: any): boolean {
    // Check if object has properties that look like issue fields
    if (typeof obj !== 'object' || obj === null) return false;
    
    const keys = Object.keys(obj);
    const issueKeys = ['id', 'title', 'status', 'priority', 'type', 'reporter', 'assignee', 'created', 'modified'];
    
    return issueKeys.some(key => keys.includes(key)) || 
           keys.some(key => key.toLowerCase().includes('issue'));
  }

  private looksLikeIssueData(arr: any[]): boolean {
    // Check if array contains issue-like data structures
    if (!Array.isArray(arr) || arr.length === 0) return false;
    
    // Look for nested arrays that might contain issue IDs (numeric strings)
    return arr.some(item => {
      if (Array.isArray(item)) {
        return item.some(subItem => {
          if (typeof subItem === 'string' && /^\d{9,}$/.test(subItem)) {
            return true; // Looks like an issue ID
          }
          return false;
        });
      }
      return false;
    });
  }

  private extractIssuesFromArray(arr: any[]): any[] {
    const issues: any[] = [];
    
    // Parse the nested array structure to extract issue information
    for (const item of arr) {
      if (Array.isArray(item)) {
        const issueData = this.parseIssueFromNestedArray(item);
        if (issueData) {
          issues.push(issueData);
        }
      }
    }
    
    return issues;
  }

  private parseIssueFromNestedArray(arr: any[]): any | null {
    // Try to extract issue information from nested array structure
    // The exact structure depends on the API response format
    
    let issueId: string | null = null;
    let title: string | null = null;
    let status: string | null = null;
    let priority: string | null = null;
    let reporter: string | null = null;
    let assignee: string | null = null;
    let created: string | null = null;
    let modified: string | null = null;
    
    const traverse = (item: any) => {
      if (Array.isArray(item)) {
        item.forEach(traverse);
      } else if (typeof item === 'string') {
        // Look for issue ID pattern
        if (/^\d{9,}$/.test(item) && !issueId) {
          issueId = item;
        }
        // Look for email patterns
        else if (item.includes('@') && item.includes('.')) {
          if (!reporter) {
            reporter = item;
          } else if (!assignee && item !== reporter) {
            assignee = item;
          }
        }
        // Look for status/priority patterns
        else if (/^(NEW|ASSIGNED|FIXED|VERIFIED|CLOSED|DUPLICATE|WontFix|Invalid)$/i.test(item)) {
          status = item;
        }
        else if (/^P[0-4]$/.test(item)) {
          priority = item;
        }
        // Look for title (longer text that doesn't match other patterns)
        else if (item.length > 20 && item.length < 200 && !title && 
                 !item.includes('http') && !item.includes('@')) {
          title = item;
        }
        // Look for timestamps
        else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(item)) {
          if (!created) {
            created = item;
          } else if (!modified) {
            modified = item;
          }
        }
      }
    };
    
    traverse(arr);
    
    if (issueId) {
      return {
        issueId,
        title: title || `Issue ${issueId}`,
        status: status || 'Unknown',
        priority: priority || 'Unknown',
        reporter,
        assignee,
        created,
        modified,
        browserUrl: `https://issues.chromium.org/issues/${issueId}`
      };
    }
    
    return null;
  }

  private normalizeIssueSearchResult(issue: any): any {
    // Normalize the issue object to a consistent format
    return {
      issueId: issue.issueId || issue.id || 'Unknown',
      title: issue.title || 'No title available',
      status: issue.status || 'Unknown',
      priority: issue.priority || 'Unknown',
      reporter: issue.reporter || null,
      assignee: issue.assignee || null,
      created: issue.created || null,
      modified: issue.modified || null,
      browserUrl: issue.browserUrl || `https://issues.chromium.org/issues/${issue.issueId || issue.id}`
    };
  }

}
