package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tidwall/gjson"
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
	searchQuery := query
	if opts != nil && opts.FilePattern != "" {
		searchQuery = fmt.Sprintf("file:%s %s", opts.FilePattern, searchQuery)
	}
	
	limit := 20
	if opts != nil && opts.Limit > 0 {
		limit = opts.Limit
	}
	
	apiResponse, err := c.callChromiumSearchAPI(searchQuery, limit)
	if err != nil {
		return nil, err
	}
	
	return c.parseChromiumAPIResponse(apiResponse)
}

func (c *ChromiumClient) callChromiumSearchAPI(query string, limit int) (map[string]interface{}, error) {
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
	
	boundary := fmt.Sprintf("batch%d%d", time.Now().Unix(), time.Now().Nanosecond())
	
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
		
		snippets, ok := fileSearchResult["snippets"].([]interface{})
		if !ok {
			continue
		}
		
		for _, snippet := range snippets {
			snippetMap, ok := snippet.(map[string]interface{})
			if !ok {
				continue
			}
			
			snippetLines, ok := snippetMap["snippetLines"].([]interface{})
			if !ok {
				continue
			}
			
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
				
				lineNum := 0
				if lineNumStr != "" {
					fmt.Sscanf(lineNumStr, "%d", &lineNum)
				}
				
				if hasRanges && len(ranges) > 0 && primaryLineNum == 0 {
					primaryLineNum = lineNum
				}
				
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
					Context: []string{},
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
	Source  string   `json:"source,omitempty"`
}

func (c *ChromiumClient) GetFile(path string, opts *FileOptions) (*FileContent, error) {
	normalizedPath := strings.TrimPrefix(path, "/")
	
	if strings.HasPrefix(normalizedPath, "v8/") {
		return c.getV8File(normalizedPath, opts)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/webrtc/") {
		return c.getWebRTCFile(normalizedPath, opts)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/devtools-frontend/") {
		return c.getDevtoolsFile(normalizedPath, opts)
	}
	
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
	
	decoded, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return nil, err
	}
	
	content := string(decoded)
	lines := strings.Split(content, "\n")
	
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
	
	githubFile.Content = strings.ReplaceAll(githubFile.Content, "\n", "")
	
	decoded, err := base64.StdEncoding.DecodeString(githubFile.Content)
	if err != nil {
		return nil, err
	}
	
	content := string(decoded)
	lines := strings.Split(content, "\n")
	
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
	return c.getChromiumFile(path, opts)
}

// Symbol search
type SymbolOptions struct {
	Type        string
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
	
	for _, match := range searchResult.Results {
		symbolMatch := SymbolMatch{
			File:    match.File,
			Line:    match.Line,
			Content: match.Content,
			Type:    "reference",
		}
		
		content := match.Content
		isDefinition := false
		
		if strings.Contains(content, "class "+symbol) ||
			strings.Contains(content, "struct "+symbol) ||
			strings.Contains(content, "enum "+symbol) {
			isDefinition = true
			symbolMatch.Type = "class/struct/enum definition"
		}
		
		if strings.Contains(content, symbol+"(") || strings.Contains(content, symbol+" (") {
			beforeSymbol := strings.Split(content, symbol)[0]
			if strings.Contains(beforeSymbol, "* ") || strings.Contains(beforeSymbol, "& ") ||
				strings.Contains(beforeSymbol, "> ") || strings.Contains(beforeSymbol, " ") {
				isDefinition = true
				symbolMatch.Type = "function definition"
			}
		}
		
		if strings.Contains(content, symbol+"::"+symbol) {
			isDefinition = true
			symbolMatch.Type = "constructor definition"
		}
		
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
	Type  string `json:"type"`
	Size  int64  `json:"size,omitempty"`
}

type FolderContent struct {
	Path    string        `json:"path"`
	Entries []FolderEntry `json:"entries"`
	Source  string        `json:"source,omitempty"`
}

func (c *ChromiumClient) ListFolder(path string) (*FolderContent, error) {
	normalizedPath := strings.TrimPrefix(strings.TrimSuffix(path, "/"), "/")
	
	if strings.HasPrefix(normalizedPath, "v8/") || normalizedPath == "v8" {
		return c.listV8Folder(normalizedPath)
	}
	
	if strings.HasPrefix(normalizedPath, "third_party/webrtc/") || normalizedPath == "third_party/webrtc" {
		return c.listWebRTCFolder(normalizedPath)
	}
	
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

// Commit search
type Commit struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

type CommitResult struct {
	Query   string   `json:"query"`
	Commits []Commit `json:"commits"`
}

func (c *ChromiumClient) SearchCommits(query string, limit int) (*CommitResult, error) {
	baseURL := "https://chromium.googlesource.com/chromium/src/+log/main"
	params := url.Values{}
	params.Add("format", "JSON")
	params.Add("n", fmt.Sprintf("%d", limit))
	params.Add("grep", query)

	resp, err := c.httpClient.Get(fmt.Sprintf("%s?%s", baseURL, params.Encode()))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch commits: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	jsonStr := strings.TrimPrefix(string(body), ")]}'\n")

	result := &CommitResult{
		Query:   query,
		Commits: []Commit{},
	}

	gjson.Get(jsonStr, "log").ForEach(func(key, value gjson.Result) bool {
		commit := Commit{
			Hash:    value.Get("commit").String(),
			Author:  value.Get("author.name").String(),
			Date:    value.Get("committer.time").String(),
			Subject: value.Get("message").String(),
		}
		result.Commits = append(result.Commits, commit)
		return true
	})

	return result, nil
}

// Gerrit CL status
type GerritCLStatus struct {
	Subject string `json:"subject"`
	Status  string `json:"status"`
	Owner   string `json:"owner"`
	Updated string `json:"updated"`
}

func (c *ChromiumClient) GetGerritCLStatus(cl string) (*GerritCLStatus, error) {
	url := fmt.Sprintf("https://chromium-review.googlesource.com/changes/%s?o=DETAILED_ACCOUNTS", cl)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch CL status: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	jsonStr := strings.TrimPrefix(string(body), ")]}'\n")

	owner := gjson.Get(jsonStr, "owner.name").String()
	if owner == "" {
		owner = gjson.Get(jsonStr, "owner.email").String()
	}

	updated, _ := time.Parse("2006-01-02 15:04:05.000000000", gjson.Get(jsonStr, "updated").String())

	status := &GerritCLStatus{
		Subject: gjson.Get(jsonStr, "subject").String(),
		Status:  gjson.Get(jsonStr, "status").String(),
		Owner:   owner,
		Updated: updated.Format("2006-01-02"),
	}

	return status, nil
}

// Gerrit CL comments
type GerritComment struct {
	Author struct {
		Name string `json:"name"`
	} `json:"author"`
	Updated time.Time `json:"updated"`
	Message string    `json:"message"`
}
func (g *GerritComment) UnmarshalJSON(data []byte) error {
	type Alias GerritComment
	aux := &struct {
		Updated string `json:"updated"`
		*Alias
	}{
		Alias: (*Alias)(g),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	t, err := time.Parse("2006-01-02 15:04:05.000000000", aux.Updated)
	if err != nil {
		return err
	}
	g.Updated = t
	return nil
}



type GerritCLComments struct {
	Comments []GerritComment `json:"comments"`
}

func (c *ChromiumClient) GetGerritCLComments(cl string) (*GerritCLComments, error) {
	url := fmt.Sprintf("https://chromium-review.googlesource.com/changes/%s/comments", cl)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch CL comments: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Remove XSSI prefix
	jsonBody := bytes.TrimPrefix(body, []byte(")]}'\n"))

	var comments GerritCLComments
	// The response is a map of file paths to comment arrays. We need to flatten this.
	var rawComments map[string][]GerritComment
	if err := json.Unmarshal(jsonBody, &rawComments); err != nil {
		return nil, fmt.Errorf("failed to decode CL comments: %w", err)
	}

	for _, fileComments := range rawComments {
		for _, comment := range fileComments {
			comments.Comments = append(comments.Comments, comment)
		}
	}

	return &comments, nil
}

// Gerrit CL diff
type GerritCLDiff struct {
	Diff string `json:"diff"`
}

func (c *ChromiumClient) GetGerritCLDiff(cl string) (*GerritCLDiff, error) {
	url := fmt.Sprintf("https://chromium-review.googlesource.com/changes/%s/revisions/current/patch", cl)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch CL diff: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	decoded, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return nil, fmt.Errorf("failed to decode CL diff: %w", err)
	}

	diff := &GerritCLDiff{
		Diff: string(decoded),
	}

	return diff, nil
}

// Issue details
type Issue struct {
	Title    string `json:"title"`
	Status   string `json:"status"`
	Priority string `json:"priority"`
	Type     string `json:"type"`
	Severity string `json:"severity"`
	Reporter string `json:"reporter"`
	Assignee string `json:"assignee"`
	Created  string `json:"created"`
	Modified string `json:"modified"`
}

func (c *ChromiumClient) GetIssue(issueID string) (*Issue, error) {
	url := fmt.Sprintf("https://issues.chromium.org/action/issues/%s/getSummary", issueID)
	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", fmt.Sprintf("https://issues.chromium.org/issues/%s", issueID))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch issue details: %s\n%s", resp.Status, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	body = bytes.TrimPrefix(body, []byte(")]}'"))

	var data []interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("failed to unmarshal issue details: %w\n%s", err, string(body))
	}

	events, ok := safeGet(data, "2").([]interface{})
	if !ok {
		return nil, fmt.Errorf("could not find events array")
	}

	if len(events) == 0 {
		return nil, fmt.Errorf("no events found")
	}

	firstEvent, ok := events[0].([]interface{})
	if !ok {
		return nil, fmt.Errorf("first event is not an array")
	}

	metadata, ok := safeGet(firstEvent, "5").([]interface{})
	if !ok {
		return nil, fmt.Errorf("could not find metadata array")
	}

	issue := &Issue{}
	for _, item := range metadata {
		field, ok := item.([]interface{})
		if !ok || len(field) < 1 {
			continue
		}
		fieldName, ok := field[0].(string)
		if !ok {
			continue
		}

		switch fieldName {
		case "title":
			issue.Title = safeGetString(field, "2.1.0")
		case "status":
			issue.Status = mapIssueStatus(int64(safeGetInt(field, "2.1.0")))
		case "priority":
			issue.Priority = mapIssuePriority(int64(safeGetInt(field, "2.1.0")))
		case "type":
			issue.Type = mapIssueType(int64(safeGetInt(field, "2.1.0")))
		case "severity":
			issue.Severity = mapIssueSeverity(int64(safeGetInt(field, "2.1.0")))
		case "reporter":
			issue.Reporter = safeGetString(field, "2.1.1")
		case "assignee":
			issue.Assignee = safeGetString(field, "2.1.1")
		}
	}

	return issue, nil
}

func safeGet(data interface{}, path string) interface{} {
	parts := strings.Split(path, ".")
	current := data
	for _, part := range parts {
		idx, err := strconv.Atoi(part)
		if err != nil {
			return nil
		}
		arr, ok := current.([]interface{})
		if !ok || len(arr) <= idx {
			return nil
		}
		current = arr[idx]
	}
	return current
}

func safeGetString(data interface{}, path string) string {
	val := safeGet(data, path)
	s, _ := val.(string)
	return s
}

func safeGetInt(data interface{}, path string) float64 {
	val := safeGet(data, path)
	f, _ := val.(float64)
	return f
}

func mapIssueStatus(status int64) string {
	switch status {
	case 1:
		return "NEW"
	case 2:
		return "ASSIGNED"
	case 3:
		return "ACCEPTED"
	case 4:
		return "FIXED"
	case 5:
		return "VERIFIED"
	case 6:
		return "INVALID"
	case 7:
		return "WONTFIX"
	case 8:
		return "DUPLICATE"
	case 9:
		return "ARCHIVED"
	default:
		return "Unknown"
	}
}

func mapIssuePriority(priority int64) string {
	switch priority {
	case 0:
		return "P0"
	case 1:
		return "P1"
	case 2:
		return "P2"
	case 3:
		return "P3"
	case 4:
		return "P4"
	default:
		return "Unknown"
	}
}

func mapIssueType(issueType int64) string {
	switch issueType {
	case 1:
		return "Bug"
	case 2:
		return "Feature"
	case 3:
		return "Task"
	default:
		return "Unknown"
	}
}

func mapIssueSeverity(severity int64) string {
	switch severity {
	case 0:
		return "S0"
	case 1:
		return "S1"
	case 2:
		return "S2"
	case 3:
		return "S3"
	case 4:
		return "S4"
	default:
		return "Unknown"
	}
}

// Owners
type OwnersFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type OwnersResult struct {
	FilePath   string       `json:"file_path"`
	OwnerFiles []OwnersFile `json:"owner_files"`
}

func (c *ChromiumClient) FindOwners(filePath string) (*OwnersResult, error) {
	result := &OwnersResult{
		FilePath:   filePath,
		OwnerFiles: []OwnersFile{},
	}

	pathParts := strings.Split(filePath, "/")
	for i := len(pathParts); i > 0; i-- {
		dirPath := strings.Join(pathParts[:i], "/")
		ownersPath := fmt.Sprintf("%s/OWNERS", dirPath)
		if dirPath == "" {
			ownersPath = "OWNERS"
		}

		fileContent, err := c.GetFile(ownersPath, nil)
		if err == nil {
			result.OwnerFiles = append(result.OwnerFiles, OwnersFile{
				Path:    ownersPath,
				Content: fileContent.Content,
			})
		}
	}

	return result, nil
}








