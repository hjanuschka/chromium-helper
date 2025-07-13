package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const (
	chromiumBaseURL = "https://source.chromium.org/chromium/chromium/src/+/main:"
	gitilesBaseURL  = "https://chromium.googlesource.com/chromium/src/+/refs/heads/main/"
	searchBaseURL   = "https://source.chromium.org/_/chromium/chromium/src/+/"
	githubV8API     = "https://api.github.com/repos/v8/v8/contents/"
	webrtcGitiles   = "https://webrtc.googlesource.com/src/+/main/"
)

type ChromiumClient struct {
	httpClient *http.Client
}

func NewChromiumClient() *ChromiumClient {
	return &ChromiumClient{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Search types
type SearchOptions struct {
	FilePattern string
	Limit       int
	Exact       bool
}

type SearchResult struct {
	Query   string        `json:"query"`
	Results []SearchMatch `json:"results"`
	Total   int           `json:"total"`
}

type SearchMatch struct {
	File    string   `json:"file"`
	Line    int      `json:"line"`
	Content string   `json:"content"`
	Context []string `json:"context,omitempty"`
}

func (c *ChromiumClient) SearchCode(query string, opts *SearchOptions) (*SearchResult, error) {
	// Build search URL
	params := url.Values{}
	params.Set("q", query)
	
	if opts != nil {
		if opts.FilePattern != "" {
			params.Set("file", opts.FilePattern)
		}
		if opts.Exact {
			params.Set("type", "exact")
		}
	}
	
	searchURL := fmt.Sprintf("%ssearch?%s", searchBaseURL, params.Encode())
	
	// Make request
	resp, err := c.httpClient.Get(searchURL)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search failed with status %d", resp.StatusCode)
	}
	
	// Parse response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	// Remove XSSI prefix if present
	jsonStr := strings.TrimPrefix(string(body), ")]}'\n")
	
	var apiResp struct {
		SearchResponse []struct {
			Matches []struct {
				Path     string `json:"path"`
				LineNum  int    `json:"line_num"`
				Line     string `json:"line"`
				Context  struct {
					Before []string `json:"before"`
					After  []string `json:"after"`
				} `json:"context"`
			} `json:"matches"`
		} `json:"search_response"`
	}
	
	if err := json.Unmarshal([]byte(jsonStr), &apiResp); err != nil {
		// Fallback to HTML parsing if JSON fails
		return c.parseSearchHTML(string(body), query, opts)
	}
	
	// Convert to our format
	result := &SearchResult{
		Query:   query,
		Results: []SearchMatch{},
	}
	
	count := 0
	limit := 100
	if opts != nil && opts.Limit > 0 {
		limit = opts.Limit
	}
	
	for _, resp := range apiResp.SearchResponse {
		for _, match := range resp.Matches {
			if count >= limit {
				break
			}
			
			result.Results = append(result.Results, SearchMatch{
				File:    match.Path,
				Line:    match.LineNum,
				Content: strings.TrimSpace(match.Line),
				Context: append(match.Context.Before, match.Context.After...),
			})
			count++
		}
	}
	
	result.Total = len(result.Results)
	return result, nil
}

func (c *ChromiumClient) parseSearchHTML(html, query string, opts *SearchOptions) (*SearchResult, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, err
	}
	
	result := &SearchResult{
		Query:   query,
		Results: []SearchMatch{},
	}
	
	// Parse search results from HTML
	doc.Find(".search-result").Each(func(i int, s *goquery.Selection) {
		if opts != nil && opts.Limit > 0 && i >= opts.Limit {
			return
		}
		
		file := s.Find(".file-path").Text()
		lineStr := s.Find(".line-number").Text()
		content := s.Find(".code-line").Text()
		
		var line int
		fmt.Sscanf(lineStr, "%d", &line)
		
		result.Results = append(result.Results, SearchMatch{
			File:    file,
			Line:    line,
			Content: strings.TrimSpace(content),
		})
	})
	
	result.Total = len(result.Results)
	return result, nil
}

// File operations
type FileOptions struct {
	LineStart int
	LineEnd   int
}

type FileContent struct {
	Path    string   `json:"path"`
	Content string   `json:"content"`
	Lines   []string `json:"lines"`
	Source  string   `json:"source,omitempty"` // "chromium", "v8", "webrtc"
}

func (c *ChromiumClient) GetFile(path string, opts *FileOptions) (*FileContent, error) {
	normalizedPath := strings.TrimPrefix(path, "/")
	
	// Check if this is a submodule
	if strings.HasPrefix(normalizedPath, "v8/") {
		return c.getV8File(normalizedPath, opts)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/webrtc/") {
		return c.getWebRTCFile(normalizedPath, opts)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/devtools-frontend/") {
		return c.getDevtoolsFile(normalizedPath, opts)
	}
	
	// Regular Chromium file
	return c.getChromiumFile(normalizedPath, opts)
}

func (c *ChromiumClient) getChromiumFile(path string, opts *FileOptions) (*FileContent, error) {
	fileURL := fmt.Sprintf("%s%s?format=TEXT", gitilesBaseURL, path)
	
	resp, err := c.httpClient.Get(fileURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("file not found: %s", path)
	}
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	// Decode base64
	decoded, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return nil, err
	}
	
	content := string(decoded)
	lines := strings.Split(content, "\n")
	
	// Apply line range if specified
	if opts != nil && opts.LineStart > 0 && opts.LineEnd > 0 {
		if opts.LineStart > len(lines) {
			return nil, fmt.Errorf("line start %d exceeds file length %d", opts.LineStart, len(lines))
		}
		if opts.LineEnd > len(lines) {
			opts.LineEnd = len(lines)
		}
		lines = lines[opts.LineStart-1 : opts.LineEnd]
		content = strings.Join(lines, "\n")
	}
	
	return &FileContent{
		Path:    path,
		Content: content,
		Lines:   lines,
		Source:  "chromium",
	}, nil
}

func (c *ChromiumClient) getV8File(path string, opts *FileOptions) (*FileContent, error) {
	v8Path := strings.TrimPrefix(path, "v8/")
	
	req, err := http.NewRequest("GET", githubV8API+v8Path, nil)
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("file not found in V8: %s", path)
	}
	
	var githubFile struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	
	if err := json.NewDecoder(resp.Body).Decode(&githubFile); err != nil {
		return nil, err
	}
	
	if githubFile.Encoding != "base64" {
		return nil, fmt.Errorf("unexpected encoding: %s", githubFile.Encoding)
	}
	
	// Remove newlines from base64 content
	githubFile.Content = strings.ReplaceAll(githubFile.Content, "\n", "")
	
	decoded, err := base64.StdEncoding.DecodeString(githubFile.Content)
	if err != nil {
		return nil, err
	}
	
	content := string(decoded)
	lines := strings.Split(content, "\n")
	
	// Apply line range if specified
	if opts != nil && opts.LineStart > 0 && opts.LineEnd > 0 {
		if opts.LineStart > len(lines) {
			return nil, fmt.Errorf("line start %d exceeds file length %d", opts.LineStart, len(lines))
		}
		if opts.LineEnd > len(lines) {
			opts.LineEnd = len(lines)
		}
		lines = lines[opts.LineStart-1 : opts.LineEnd]
		content = strings.Join(lines, "\n")
	}
	
	return &FileContent{
		Path:    path,
		Content: content,
		Lines:   lines,
		Source:  "v8",
	}, nil
}

func (c *ChromiumClient) getWebRTCFile(path string, opts *FileOptions) (*FileContent, error) {
	webrtcPath := strings.TrimPrefix(path, "third_party/webrtc/")
	
	fileURL := fmt.Sprintf("%s%s?format=TEXT", webrtcGitiles, webrtcPath)
	
	resp, err := c.httpClient.Get(fileURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("file not found in WebRTC: %s", path)
	}
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	decoded, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return nil, err
	}
	
	content := string(decoded)
	lines := strings.Split(content, "\n")
	
	// Apply line range if specified
	if opts != nil && opts.LineStart > 0 && opts.LineEnd > 0 {
		if opts.LineStart > len(lines) {
			return nil, fmt.Errorf("line start %d exceeds file length %d", opts.LineStart, len(lines))
		}
		if opts.LineEnd > len(lines) {
			opts.LineEnd = len(lines)
		}
		lines = lines[opts.LineStart-1 : opts.LineEnd]
		content = strings.Join(lines, "\n")
	}
	
	return &FileContent{
		Path:    path,
		Content: content,
		Lines:   lines,
		Source:  "webrtc",
	}, nil
}

func (c *ChromiumClient) getDevtoolsFile(path string, opts *FileOptions) (*FileContent, error) {
	// DevTools uses the same Gitiles as Chromium
	return c.getChromiumFile(path, opts)
}

// Symbol search
type SymbolOptions struct {
	Type        string // "definition", "declaration", "call", "all"
	FilePattern string
}

type SymbolResult struct {
	Symbol      string        `json:"symbol"`
	Definitions []SymbolMatch `json:"definitions"`
	References  []SymbolMatch `json:"references"`
}

type SymbolMatch struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Type    string `json:"type"`
	Content string `json:"content"`
}

func (c *ChromiumClient) FindSymbol(symbol string, opts *SymbolOptions) (*SymbolResult, error) {
	query := fmt.Sprintf("symbol:%s", symbol)
	
	searchOpts := &SearchOptions{
		Limit: 100,
	}
	
	if opts != nil {
		if opts.Type != "" && opts.Type != "all" {
			query += fmt.Sprintf(" type:%s", opts.Type)
		}
		searchOpts.FilePattern = opts.FilePattern
	}
	
	searchResult, err := c.SearchCode(query, searchOpts)
	if err != nil {
		return nil, err
	}
	
	result := &SymbolResult{
		Symbol:      symbol,
		Definitions: []SymbolMatch{},
		References:  []SymbolMatch{},
	}
	
	// Categorize results
	for _, match := range searchResult.Results {
		symbolMatch := SymbolMatch{
			File:    match.File,
			Line:    match.Line,
			Content: match.Content,
			Type:    "reference", // Default
		}
		
		// Simple heuristic to detect definitions
		if strings.Contains(match.Content, "class "+symbol) ||
			strings.Contains(match.Content, "struct "+symbol) ||
			strings.Contains(match.Content, "enum "+symbol) ||
			strings.Contains(match.Content, "typedef") {
			symbolMatch.Type = "definition"
			result.Definitions = append(result.Definitions, symbolMatch)
		} else {
			result.References = append(result.References, symbolMatch)
		}
	}
	
	return result, nil
}

// List folder
type FolderEntry struct {
	Name  string `json:"name"`
	Type  string `json:"type"` // "file" or "dir"
	Size  int64  `json:"size,omitempty"`
}

type FolderContent struct {
	Path    string        `json:"path"`
	Entries []FolderEntry `json:"entries"`
	Source  string        `json:"source,omitempty"`
}

func (c *ChromiumClient) ListFolder(path string) (*FolderContent, error) {
	normalizedPath := strings.TrimPrefix(strings.TrimSuffix(path, "/"), "/")
	
	// Check for submodules
	if strings.HasPrefix(normalizedPath, "v8/") || normalizedPath == "v8" {
		return c.listV8Folder(normalizedPath)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/webrtc/") || normalizedPath == "third_party/webrtc" {
		return c.listWebRTCFolder(normalizedPath)
	}
	
	// Regular Chromium folder
	return c.listChromiumFolder(normalizedPath)
}

func (c *ChromiumClient) listChromiumFolder(path string) (*FolderContent, error) {
	treeURL := fmt.Sprintf("%s%s/?format=JSON", gitilesBaseURL, path)
	
	resp, err := c.httpClient.Get(treeURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		// Check if it might be a submodule subdirectory
		if resp.StatusCode == http.StatusNotFound {
			if strings.HasPrefix(path, "v8/") {
				return c.listV8Folder(path)
			}
			if strings.HasPrefix(path, "third_party/webrtc/") {
				return c.listWebRTCFolder(path)
			}
		}
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
	
	result := &FolderContent{
		Path:    path,
		Entries: []FolderEntry{},
		Source:  "chromium",
	}
	
	for _, e := range data.Entries {
		entryType := "file"
		if e.Type == "tree" {
			entryType = "dir"
		}
		result.Entries = append(result.Entries, FolderEntry{
			Name: e.Name,
			Type: entryType,
			Size: e.Size,
		})
	}
	
	return result, nil
}

func (c *ChromiumClient) listV8Folder(path string) (*FolderContent, error) {
	v8Path := strings.TrimPrefix(path, "v8/")
	if v8Path == "v8" {
		v8Path = ""
	}
	
	apiURL := githubV8API + v8Path
	
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	
	resp, err := c.httpClient.Do(req)
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
	
	result := &FolderContent{
		Path:    path,
		Entries: []FolderEntry{},
		Source:  "v8",
	}
	
	for _, item := range items {
		entryType := "file"
		if item.Type == "dir" {
			entryType = "dir"
		}
		result.Entries = append(result.Entries, FolderEntry{
			Name: item.Name,
			Type: entryType,
			Size: item.Size,
		})
	}
	
	return result, nil
}

func (c *ChromiumClient) listWebRTCFolder(path string) (*FolderContent, error) {
	webrtcPath := strings.TrimPrefix(path, "third_party/webrtc/")
	if webrtcPath == "third_party/webrtc" {
		webrtcPath = ""
	}
	
	treeURL := fmt.Sprintf("%s%s/?format=JSON", webrtcGitiles, webrtcPath)
	
	resp, err := c.httpClient.Get(treeURL)
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
	
	result := &FolderContent{
		Path:    path,
		Entries: []FolderEntry{},
		Source:  "webrtc",
	}
	
	for _, e := range data.Entries {
		entryType := "file"
		if e.Type == "tree" {
			entryType = "dir"
		}
		result.Entries = append(result.Entries, FolderEntry{
			Name: e.Name,
			Type: entryType,
			Size: e.Size,
		})
	}
	
	return result, nil
}