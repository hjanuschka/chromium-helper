package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	chromiumBaseURL = "https://source.chromium.org/chromium/chromium/src/+/main:"
	gitilesBaseURL  = "https://chromium.googlesource.com/chromium/src/+/refs/heads/main/"
	searchBaseURL   = "https://source.chromium.org/_/chromium/chromium/src/+/"
)

type ChromiumServer struct {
	server *mcp.Server
}

func NewChromiumServer() *ChromiumServer {
	server := mcp.NewServer(&mcp.Implementation{
		Name: "chromium-codesearch-mcp",
	}, &mcp.ServerOptions{
		Instructions: "Search and explore the Chromium codebase using Google's official CodeSearch API",
	})

	cs := &ChromiumServer{server: server}
	cs.registerTools()
	return cs
}

func (cs *ChromiumServer) registerTools() {
	// Search Chromium Code
	type SearchArgs struct {
		Query       string `json:"query" mcp:"search query using cs.chromium.org syntax"`
		FilePattern string `json:"file_pattern,omitempty" mcp:"filter by file pattern (e.g., '*.cc', 'browser/*.h')"`
	}
	type SearchResult struct {
		Results []struct {
			File    string   `json:"file"`
			Line    int      `json:"line"`
			Content string   `json:"content"`
			Context []string `json:"context,omitempty"`
		} `json:"results"`
		Query string `json:"query"`
	}

	mcp.AddTool(cs.server, &mcp.Tool{
		Name:        "search_chromium_code",
		Description: "Search for code patterns in the Chromium source code repository",
	}, func(ctx context.Context, ss *mcp.ServerSession, params *mcp.CallToolParamsFor[SearchArgs]) (*mcp.CallToolResultFor[SearchResult], error) {
		results, err := cs.searchChromiumCode(params.Arguments.Query, params.Arguments.FilePattern)
		if err != nil {
			return &mcp.CallToolResultFor[SearchResult]{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error searching code: %v", err)}},
				IsError: true,
			}, nil
		}

		result := SearchResult{
			Query: params.Arguments.Query,
		}
		for _, r := range results {
			result.Results = append(result.Results, struct {
				File    string   `json:"file"`
				Line    int      `json:"line"`
				Content string   `json:"content"`
				Context []string `json:"context,omitempty"`
			}{
				File:    r.File,
				Line:    r.Line,
				Content: r.Content,
				Context: r.Context,
			})
		}

		text := fmt.Sprintf("Found %d matches for query: %s", len(result.Results), params.Arguments.Query)
		if len(result.Results) > 0 {
			text += "\n\nTop results:\n"
			for i, m := range result.Results {
				if i >= 10 {
					text += fmt.Sprintf("\n... and %d more results", len(result.Results)-10)
					break
				}
				text += fmt.Sprintf("\n%s:%d\n%s\n", m.File, m.Line, m.Content)
			}
		}

		return &mcp.CallToolResultFor[SearchResult]{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
			StructuredContent: result,
		}, nil
	})

	// Find Chromium Symbol
	type SymbolArgs struct {
		Symbol      string `json:"symbol" mcp:"symbol name to find (e.g., 'Browser::Create', 'RenderFrameHost')"`
		Type        string `json:"type,omitempty" mcp:"symbol type: 'definition', 'declaration', 'call', or 'all' (default: 'all')"`
		FilePattern string `json:"file_pattern,omitempty" mcp:"filter by file pattern"`
	}
	type SymbolResult struct {
		Symbol      string `json:"symbol"`
		Definitions []struct {
			File    string `json:"file"`
			Line    int    `json:"line"`
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"definitions"`
		References []struct {
			File    string `json:"file"`
			Line    int    `json:"line"`
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"references"`
	}

	mcp.AddTool(cs.server, &mcp.Tool{
		Name:        "find_chromium_symbol",
		Description: "Find symbol definitions, declarations, and references in Chromium",
	}, func(ctx context.Context, ss *mcp.ServerSession, params *mcp.CallToolParamsFor[SymbolArgs]) (*mcp.CallToolResultFor[SymbolResult], error) {
		symbolType := params.Arguments.Type
		if symbolType == "" {
			symbolType = "all"
		}

		results, err := cs.findChromiumSymbol(params.Arguments.Symbol, symbolType, params.Arguments.FilePattern)
		if err != nil {
			return &mcp.CallToolResultFor[SymbolResult]{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error finding symbol: %v", err)}},
				IsError: true,
			}, nil
		}

		symbolResult := SymbolResult{
			Symbol: params.Arguments.Symbol,
		}
		for _, r := range results {
			match := struct {
				File    string `json:"file"`
				Line    int    `json:"line"`
				Type    string `json:"type"`
				Content string `json:"content"`
			}{
				File:    r.File,
				Line:    r.Line,
				Type:    r.Type,
				Content: r.Content,
			}
			if r.Type == "definition" || r.Type == "declaration" {
				symbolResult.Definitions = append(symbolResult.Definitions, match)
			} else {
				symbolResult.References = append(symbolResult.References, match)
			}
		}

		text := fmt.Sprintf("Symbol: %s\n", params.Arguments.Symbol)
		text += fmt.Sprintf("Found %d definitions/declarations and %d references\n", len(symbolResult.Definitions), len(symbolResult.References))
		
		if len(symbolResult.Definitions) > 0 {
			text += "\nDefinitions:\n"
			for i, d := range symbolResult.Definitions {
				if i >= 5 {
					text += fmt.Sprintf("... and %d more\n", len(symbolResult.Definitions)-5)
					break
				}
				text += fmt.Sprintf("%s:%d (%s)\n%s\n", d.File, d.Line, d.Type, d.Content)
			}
		}

		return &mcp.CallToolResultFor[SymbolResult]{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
			StructuredContent: symbolResult,
		}, nil
	})

	// Get Chromium File
	type FileArgs struct {
		Path        string `json:"path" mcp:"file path in Chromium source (e.g., 'base/memory/ref_counted.h')"`
		LineStart   int    `json:"line_start,omitempty" mcp:"starting line number (1-based)"`
		LineEnd     int    `json:"line_end,omitempty" mcp:"ending line number (inclusive)"`
	}
	type FileResult struct {
		Path    string   `json:"path"`
		Content string   `json:"content"`
		Lines   []string `json:"lines,omitempty"`
	}

	mcp.AddTool(cs.server, &mcp.Tool{
		Name:        "get_chromium_file",
		Description: "Get the contents of a specific file from the Chromium source tree",
	}, func(ctx context.Context, ss *mcp.ServerSession, params *mcp.CallToolParamsFor[FileArgs]) (*mcp.CallToolResultFor[FileResult], error) {
		content, lines, err := cs.getChromiumFile(params.Arguments.Path, params.Arguments.LineStart, params.Arguments.LineEnd)
		if err != nil {
			return &mcp.CallToolResultFor[FileResult]{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error fetching file: %v", err)}},
				IsError: true,
			}, nil
		}

		text := fmt.Sprintf("File: %s\n", params.Arguments.Path)
		if params.Arguments.LineStart > 0 {
			text += fmt.Sprintf("Lines %d-%d:\n", params.Arguments.LineStart, params.Arguments.LineEnd)
		}
		text += content

		return &mcp.CallToolResultFor[FileResult]{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
			StructuredContent: FileResult{
				Path:    params.Arguments.Path,
				Content: content,
				Lines:   lines,
			},
		}, nil
	})

	// List Chromium Folder
	type ListFolderArgs struct {
		Path string `json:"path" mcp:"folder path in Chromium source (e.g., 'base/memory/')"`
	}
	type ListFolderResult struct {
		Path    string `json:"path"`
		Entries []struct {
			Name string `json:"name"`
			Type string `json:"type"` // "file" or "dir"
			Size int64  `json:"size,omitempty"`
		} `json:"entries"`
	}

	mcp.AddTool(cs.server, &mcp.Tool{
		Name:        "list_chromium_folder",
		Description: "List files and folders in a Chromium source directory",
	}, func(ctx context.Context, ss *mcp.ServerSession, params *mcp.CallToolParamsFor[ListFolderArgs]) (*mcp.CallToolResultFor[ListFolderResult], error) {
		entries, err := cs.listChromiumFolder(params.Arguments.Path)
		if err != nil {
			return &mcp.CallToolResultFor[ListFolderResult]{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Error listing folder: %v", err)}},
				IsError: true,
			}, nil
		}

		text := fmt.Sprintf("Contents of %s:\n\n", params.Arguments.Path)
		for _, entry := range entries {
			if entry.Type == "dir" {
				text += fmt.Sprintf("[DIR]  %s/\n", entry.Name)
			} else {
				text += fmt.Sprintf("[FILE] %s\n", entry.Name)
			}
		}

		return &mcp.CallToolResultFor[ListFolderResult]{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
			StructuredContent: ListFolderResult{
				Path:    params.Arguments.Path,
				Entries: cs.convertEntries(entries),
			},
		}, nil
	})

	// TODO: Add remaining tools (Gerrit, Issues, Commits, Owners) following the same pattern
}

func (cs *ChromiumServer) searchChromiumCode(query, filePattern string) ([]searchResult, error) {
	// Implementation would go here - make HTTP request to Chromium search API
	// This is a simplified example
	searchURL := fmt.Sprintf("%ssearch?q=%s", searchBaseURL, url.QueryEscape(query))
	if filePattern != "" {
		searchURL += "&file=" + url.QueryEscape(filePattern)
	}

	resp, err := http.Get(searchURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Parse results (actual implementation would parse the JSON response)
	var results []searchResult
	// ... parsing logic ...
	
	return results, nil
}

func (cs *ChromiumServer) findChromiumSymbol(symbol, symbolType, filePattern string) ([]symbolResult, error) {
	// Implementation for symbol search
	query := fmt.Sprintf("symbol:%s", symbol)
	if symbolType != "all" {
		query += fmt.Sprintf(" type:%s", symbolType)
	}
	
	// Use searchChromiumCode with symbol-specific query
	searchResults, err := cs.searchChromiumCode(query, filePattern)
	if err != nil {
		return nil, err
	}

	// Convert search results to symbol results
	var results []symbolResult
	for _, sr := range searchResults {
		results = append(results, symbolResult{
			File:    sr.File,
			Line:    sr.Line,
			Type:    "reference", // Would be determined by parsing
			Content: sr.Content,
		})
	}
	
	return results, nil
}

func (cs *ChromiumServer) getChromiumFile(path string, lineStart, lineEnd int) (string, []string, error) {
	// Check if this is a submodule
	normalizedPath := strings.TrimPrefix(path, "/")
	
	if strings.HasPrefix(normalizedPath, "v8/") {
		return cs.getV8FileViaGitHub(normalizedPath)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/webrtc/") {
		return cs.getWebRTCFileViaGitiles(normalizedPath)
	}

	// Regular Chromium file
	fileURL := fmt.Sprintf("%s%s?format=TEXT", gitilesBaseURL, normalizedPath)
	
	resp, err := http.Get(fileURL)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("file not found: %s", path)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, err
	}

	// Decode base64
	decoded, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return "", nil, err
	}

	content := string(decoded)
	lines := strings.Split(content, "\n")

	// Apply line range if specified
	if lineStart > 0 && lineEnd > 0 {
		if lineStart > len(lines) {
			return "", nil, fmt.Errorf("line start %d exceeds file length %d", lineStart, len(lines))
		}
		if lineEnd > len(lines) {
			lineEnd = len(lines)
		}
		lines = lines[lineStart-1 : lineEnd]
		content = strings.Join(lines, "\n")
	}

	return content, lines, nil
}

func (cs *ChromiumServer) getV8FileViaGitHub(path string) (string, []string, error) {
	// Remove v8/ prefix
	v8Path := strings.TrimPrefix(path, "v8/")
	
	apiURL := fmt.Sprintf("https://api.github.com/repos/v8/v8/contents/%s", v8Path)
	
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", nil, err
	}
	
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("file not found in V8: %s", path)
	}

	var githubFile struct {
		Content string `json:"content"`
		Encoding string `json:"encoding"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&githubFile); err != nil {
		return "", nil, err
	}

	if githubFile.Encoding != "base64" {
		return "", nil, fmt.Errorf("unexpected encoding: %s", githubFile.Encoding)
	}

	decoded, err := base64.StdEncoding.DecodeString(githubFile.Content)
	if err != nil {
		return "", nil, err
	}

	content := string(decoded)
	lines := strings.Split(content, "\n")

	return content, lines, nil
}

func (cs *ChromiumServer) getWebRTCFileViaGitiles(path string) (string, []string, error) {
	// Remove third_party/webrtc/ prefix
	webrtcPath := strings.TrimPrefix(path, "third_party/webrtc/")
	
	fileURL := fmt.Sprintf("https://webrtc.googlesource.com/src/+/main/%s?format=TEXT", webrtcPath)
	
	resp, err := http.Get(fileURL)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("file not found in WebRTC: %s", path)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, err
	}

	decoded, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return "", nil, err
	}

	content := string(decoded)
	lines := strings.Split(content, "\n")

	return content, lines, nil
}

type FileEntry struct {
	Name string
	Type string
	Size int64
}

func (cs *ChromiumServer) listChromiumFolder(path string) ([]FileEntry, error) {
	normalizedPath := strings.TrimPrefix(strings.TrimSuffix(path, "/"), "/")
	
	// Check for submodules
	if strings.HasPrefix(normalizedPath, "v8/") || normalizedPath == "v8" {
		return cs.listV8FolderViaGitHub(normalizedPath)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/webrtc/") || normalizedPath == "third_party/webrtc" {
		return cs.listWebRTCFolderViaGitiles(normalizedPath)
	}

	// Regular Chromium folder
	treeURL := fmt.Sprintf("%s%s/?format=JSON", gitilesBaseURL, normalizedPath)
	
	resp, err := http.Get(treeURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("folder not found: %s", path)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Remove XSSI prefix
	jsonStr := strings.TrimPrefix(string(body), ")]}'\n")

	var data struct {
		Entries []struct {
			Name string `json:"name"`
			Type string `json:"type"`
			Size int64  `json:"size"`
		} `json:"entries"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, err
	}

	var entries []FileEntry
	for _, e := range data.Entries {
		entryType := "file"
		if e.Type == "tree" {
			entryType = "dir"
		}
		entries = append(entries, FileEntry{
			Name: e.Name,
			Type: entryType,
			Size: e.Size,
		})
	}

	return entries, nil
}

func (cs *ChromiumServer) listV8FolderViaGitHub(path string) ([]FileEntry, error) {
	v8Path := strings.TrimPrefix(path, "v8/")
	if v8Path == "v8" {
		v8Path = ""
	}
	
	apiURL := fmt.Sprintf("https://api.github.com/repos/v8/v8/contents/%s", v8Path)
	
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("folder not found in V8: %s", path)
	}

	var items []struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Size int64  `json:"size"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, err
	}

	var entries []FileEntry
	for _, item := range items {
		entryType := "file"
		if item.Type == "dir" {
			entryType = "dir"
		}
		entries = append(entries, FileEntry{
			Name: item.Name,
			Type: entryType,
			Size: item.Size,
		})
	}

	return entries, nil
}

func (cs *ChromiumServer) listWebRTCFolderViaGitiles(path string) ([]FileEntry, error) {
	webrtcPath := strings.TrimPrefix(path, "third_party/webrtc/")
	if webrtcPath == "third_party/webrtc" {
		webrtcPath = ""
	}
	
	treeURL := fmt.Sprintf("https://webrtc.googlesource.com/src/+/main/%s/?format=JSON", webrtcPath)
	
	resp, err := http.Get(treeURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("folder not found in WebRTC: %s", path)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Remove XSSI prefix
	jsonStr := strings.TrimPrefix(string(body), ")]}'\n")

	var data struct {
		Entries []struct {
			Name string `json:"name"`
			Type string `json:"type"`
			Size int64  `json:"size"`
		} `json:"entries"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, err
	}

	var entries []FileEntry
	for _, e := range data.Entries {
		entryType := "file"
		if e.Type == "tree" {
			entryType = "dir"
		}
		entries = append(entries, FileEntry{
			Name: e.Name,
			Type: entryType,
			Size: e.Size,
		})
	}

	return entries, nil
}

// Types for internal use
type searchResult struct {
	File    string
	Line    int
	Content string
	Context []string
}

type symbolResult struct {
	File    string
	Line    int
	Type    string
	Content string
}

func (cs *ChromiumServer) convertEntries(entries []FileEntry) []struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size,omitempty"`
} {
	result := make([]struct {
		Name string `json:"name"`
		Type string `json:"type"`
		Size int64  `json:"size,omitempty"`
	}, len(entries))
	for i, e := range entries {
		result[i].Name = e.Name
		result[i].Type = e.Type
		result[i].Size = e.Size
	}
	return result
}

func main() {
	ctx := context.Background()
	
	cs := NewChromiumServer()
	
	// Create stdio transport  
	transport := mcp.NewLoggingTransport(mcp.NewStdioTransport(), os.Stderr)
	
	// Run the server
	if err := cs.server.Run(ctx, transport); err != nil && err != context.Canceled {
		log.Fatalf("Server error: %v", err)
	}
}