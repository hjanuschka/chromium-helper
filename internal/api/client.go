package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	chromiumBaseURL = "https://source.chromium.org/chromium/chromium/src/+/main:"
	gitilesBaseURL  = "https://chromium.googlesource.com/chromium/src/+/refs/heads/main/"
	searchBaseURL   = "https://source.chromium.org/_/chromium/chromium/src/+/"
	githubV8API     = "https://api.github.com/repos/v8/v8/contents/"
	webrtcGitiles   = "https://webrtc.googlesource.com/src/+/main/"
	batchAPIURL     = "https://grimoireoss-pa.clients6.google.com/batch"
	defaultAPIKey   = "AIzaSyCqPSptx9mClE5NU4cpfzr6cgdO_phV1lM"
)

type ChromiumClient struct {
	httpClient *http.Client
	apiKey     string
}

func NewChromiumClient() *ChromiumClient {
	apiKey := os.Getenv("CHROMIUM_SEARCH_API_KEY")
	if apiKey == "" {
		apiKey = defaultAPIKey
	}
	return &ChromiumClient{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		apiKey: apiKey,
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
	// Build search query
	searchQuery := query
	if opts != nil && opts.FilePattern != "" {
		searchQuery = fmt.Sprintf("file:%s %s", opts.FilePattern, searchQuery)
	}
	
	limit := 20
	if opts != nil && opts.Limit > 0 {
		limit = opts.Limit
	}
	
	// Call the Chromium Search API
	apiResponse, err := c.callChromiumSearchAPI(searchQuery, limit)
	if err != nil {
		return nil, err
	}
	
	// Parse the response
	return c.parseChromiumAPIResponse(apiResponse)
}

func (c *ChromiumClient) callChromiumSearchAPI(query string, limit int) (map[string]interface{}, error) {
	// Create search payload
	searchPayload := map[string]interface{}{
		"queryString": query,
		"searchOptions": map[string]interface{}{
			"enableDiagnostics":           false,
			"exhaustive":                  false,
			"numberOfContextLines":        1,
			"pageSize":                    min(limit, 25),
			"pageToken":                   "",
			"pathPrefix":                  "",
			"repositoryScope": map[string]interface{}{
				"root": map[string]interface{}{
					"ossProject":      "chromium",
					"repositoryName":  "chromium/src",
				},
			},
			"retrieveMultibranchResults":  true,
			"savedQuery":                  "",
			"scoringModel":                "",
			"showPersonalizedResults":     false,
			"suppressGitLegacyResults":    false,
		},
		"snippetOptions": map[string]interface{}{
			"minSnippetLinesPerFile": 10,
			"minSnippetLinesPerPage": 60,
			"numberOfContextLines":   1,
		},
	}
	
	// Generate boundary for multipart request
	boundary := fmt.Sprintf("batch%d%d", time.Now().Unix(), time.Now().Nanosecond())
	
	// Create multipart body
	payloadJSON, err := json.Marshal(searchPayload)
	if err != nil {
		return nil, err
	}
	
	multipartBody := strings.Join([]string{
		"--" + boundary,
		"Content-Type: application/http",
		fmt.Sprintf("Content-ID: <response-%s+gapiRequest@googleapis.com>", boundary),
		"",
		fmt.Sprintf("POST /v1/contents/search?alt=json&key=%s", c.apiKey),
		"sessionid: " + generateRandomID(),
		"actionid: " + generateRandomID(),
		"X-JavaScript-User-Agent: google-api-javascript-client/1.1.0",
		"X-Requested-With: XMLHttpRequest",
		"Content-Type: application/json",
		"X-Goog-Encode-Response-If-Executable: base64",
		"",
		string(payloadJSON),
		"--" + boundary + "--",
		"",
	}, "\r\n")
	
	// Make request
	req, err := http.NewRequest("POST", batchAPIURL+"?%24ct=multipart%2Fmixed%3B%20boundary%3D"+boundary, strings.NewReader(multipartBody))
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("accept", "*/*")
	req.Header.Set("accept-language", "en-US,en;q=0.9")
	req.Header.Set("cache-control", "no-cache")
	req.Header.Set("content-type", "text/plain; charset=UTF-8")
	req.Header.Set("origin", "https://source.chromium.org")
	req.Header.Set("pragma", "no-cache")
	req.Header.Set("referer", "https://source.chromium.org/")
	req.Header.Set("sec-fetch-dest", "empty")
	req.Header.Set("sec-fetch-mode", "cors")
	req.Header.Set("sec-fetch-site", "cross-site")
	req.Header.Set("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API request failed: %d %s", resp.StatusCode, resp.Status)
	}
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	// Extract JSON from multipart response
	responseText := string(body)
	jsonStart := strings.Index(responseText, "{")
	jsonEnd := strings.LastIndex(responseText, "}")
	
	if jsonStart < 0 || jsonEnd < 0 || jsonEnd < jsonStart {
		return nil, fmt.Errorf("could not parse API response")
	}
	
	jsonStr := responseText[jsonStart : jsonEnd+1]
	
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil, fmt.Errorf("failed to parse JSON response: %w", err)
	}
	
	return result, nil
}

func (c *ChromiumClient) parseChromiumAPIResponse(apiResponse map[string]interface{}) (*SearchResult, error) {
	result := &SearchResult{
		Query:   "",
		Results: []SearchMatch{},
	}
	
	// Debug: print the response structure
	// fmt.Printf("API Response: %+v\n", apiResponse)
	
	searchResults, ok := apiResponse["searchResults"].([]interface{})
	if !ok {
		return result, nil
	}
	
	for _, searchResult := range searchResults {
		searchResultMap, ok := searchResult.(map[string]interface{})
		if !ok {
			continue
		}
		
		fileSearchResult, ok := searchResultMap["fileSearchResult"].(map[string]interface{})
		if !ok {
			continue
		}
		
		fileSpec, ok := fileSearchResult["fileSpec"].(map[string]interface{})
		if !ok {
			continue
		}
		
		filePath, _ := fileSpec["path"].(string)
		
		// Get snippets
		snippets, ok := fileSearchResult["snippets"].([]interface{})
		if !ok {
			continue
		}
		
		for _, snippet := range snippets {
			snippetMap, ok := snippet.(map[string]interface{})
			if !ok {
				continue
			}
			
			// Get snippet lines
			snippetLines, ok := snippetMap["snippetLines"].([]interface{})
			if !ok {
				continue
			}
			
			// Find the primary match line (the one with ranges)
			var primaryLineNum int
			var contextLines []string
			
			for _, line := range snippetLines {
				lineMap, ok := line.(map[string]interface{})
				if !ok {
					continue
				}
				
				lineText, _ := lineMap["lineText"].(string)
				lineNumStr, _ := lineMap["lineNumber"].(string)
				ranges, hasRanges := lineMap["ranges"].([]interface{})
				
				// Parse line number
				lineNum := 0
				if lineNumStr != "" {
					fmt.Sscanf(lineNumStr, "%d", &lineNum)
				}
				
				if hasRanges && len(ranges) > 0 && primaryLineNum == 0 {
					// This is the primary match line
					primaryLineNum = lineNum
				}
				
				// Add to context
				if hasRanges && len(ranges) > 0 {
					contextLines = append(contextLines, "➤ "+lineText)
				} else {
					contextLines = append(contextLines, "  "+lineText)
				}
			}
			
			if primaryLineNum > 0 {
				result.Results = append(result.Results, SearchMatch{
					File:    filePath,
					Line:    primaryLineNum,
					Content: strings.Join(contextLines, "\n"),
					Context: []string{}, // Context is embedded in Content for now
				})
			}
		}
	}
	
	result.Total = len(result.Results)
	return result, nil
}

func generateRandomID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 12)
	for i := range b {
		b[i] = chars[time.Now().UnixNano()%int64(len(chars))]
	}
	return string(b)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
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
		
		// Heuristic to detect definitions
		content := match.Content
		isDefinition := false
		
		// Check for class/struct/enum definitions
		if strings.Contains(content, "class "+symbol) ||
			strings.Contains(content, "struct "+symbol) ||
			strings.Contains(content, "enum "+symbol) {
			isDefinition = true
			symbolMatch.Type = "class/struct/enum definition"
		}
		
		// Check for function definitions (return_type Symbol::Method or Symbol::Method()
		if strings.Contains(content, symbol+"(") || strings.Contains(content, symbol+" (") {
			// Check if it's preceded by a type (function definition)
			beforeSymbol := strings.Split(content, symbol)[0]
			if strings.Contains(beforeSymbol, "* ") || strings.Contains(beforeSymbol, "& ") ||
				strings.Contains(beforeSymbol, "> ") || strings.Contains(beforeSymbol, " ") {
				// Likely a function definition
				isDefinition = true
				symbolMatch.Type = "function definition"
			}
		}
		
		// Check for constructor definitions
		if strings.Contains(content, symbol+"::"+symbol) {
			isDefinition = true
			symbolMatch.Type = "constructor definition"
		}
		
		// Check for typedef
		if strings.Contains(content, "typedef") && strings.Contains(content, symbol) {
			isDefinition = true
			symbolMatch.Type = "typedef"
		}
		
		if isDefinition {
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