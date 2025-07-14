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
	"regexp"
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
	cookie     string
}

func NewChromiumClient() *ChromiumClient {
	apiKey := os.Getenv("CHROMIUM_SEARCH_API_KEY")
	if apiKey == "" {
		apiKey = defaultAPIKey
	}
	cookie := os.Getenv("CHROMIUM_COOKIE")
	return &ChromiumClient{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		apiKey: apiKey,
		cookie: cookie,
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
	Path           string   `json:"path"`
	Content        string   `json:"content"`
	Lines          []string `json:"lines"`
	Source         string   `json:"source,omitempty"`
	BrowserUrl     string   `json:"browser_url,omitempty"`
	GithubUrl      string   `json:"github_url,omitempty"`
	WebrtcUrl      string   `json:"webrtc_url,omitempty"`
	TotalLines     int      `json:"total_lines"`
	DisplayedLines int      `json:"displayed_lines"`
	LineStart      int      `json:"line_start,omitempty"`
	LineEnd        int      `json:"line_end,omitempty"`
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
	totalLines := len(strings.Split(content, "\n"))
	processedContent, displayedLines, lineStart, lineEnd := processFileContent(content, opts)

	return &FileContent{
		Path:           path,
		Content:        processedContent,
		Lines:          displayedLines,
		Source:         "chromium",
		BrowserUrl:     fmt.Sprintf("%s%s", chromiumBaseURL, path),
		TotalLines:     totalLines,
		DisplayedLines: len(displayedLines),
		LineStart:      lineStart,
		LineEnd:        lineEnd,
	}, nil
}

func processFileContent(content string, opts *FileOptions) (string, []string, int, int) {
	allLines := strings.Split(content, "\n")

	var displayedLines []string
	var lineStart, lineEnd int
	if opts != nil {
		lineStart = opts.LineStart
		lineEnd = opts.LineEnd
	}

	if lineStart > 0 {
		if lineStart > len(allLines) {
			lineStart = len(allLines)
		}
		if lineEnd > 0 {
			if lineEnd > len(allLines) {
				lineEnd = len(allLines)
			}
			if lineEnd < lineStart {
				lineEnd = lineStart
			}
			displayedLines = allLines[lineStart-1 : lineEnd]
		} else {
			displayedLines = allLines[lineStart-1:]
		}
	} else {
		displayedLines = allLines
	}

	return strings.Join(displayedLines, "\n"), displayedLines, lineStart, lineEnd
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
	totalLines := len(strings.Split(content, "\n"))
	processedContent, displayedLines, lineStart, lineEnd := processFileContent(content, opts)

	return &FileContent{
		Path:           path,
		Content:        processedContent,
		Lines:          displayedLines,
		Source:         "v8",
		BrowserUrl:     fmt.Sprintf("%s%s", chromiumBaseURL, path),
		GithubUrl:      fmt.Sprintf("https://github.com/v8/v8/blob/main/%s", v8Path),
		TotalLines:     totalLines,
		DisplayedLines: len(displayedLines),
		LineStart:      lineStart,
		LineEnd:        lineEnd,
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
	totalLines := len(strings.Split(content, "\n"))
	processedContent, displayedLines, lineStart, lineEnd := processFileContent(content, opts)

	return &FileContent{
		Path:           path,
		Content:        processedContent,
		Lines:          displayedLines,
		Source:         "webrtc",
		BrowserUrl:     fmt.Sprintf("%s%s", chromiumBaseURL, path),
		WebrtcUrl:      fmt.Sprintf("%s%s", webrtcGitiles, webrtcPath),
		TotalLines:     totalLines,
		DisplayedLines: len(displayedLines),
		LineStart:      lineStart,
		LineEnd:        lineEnd,
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

// GerritClient handles interactions with a Gerrit host
type GerritClient struct {
	hostname   string
	project    string
	httpClient *http.Client
}

// NewGerritClient creates a new client for a specific Gerrit host
func NewGerritClient(hostname string, project string) *GerritClient {
	return &GerritClient{
		hostname: hostname,
		project:  project,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Gerrit CL status
type GerritCLStatus struct {
	Subject string `json:"subject"`
	Status  string `json:"status"`
	Owner   string `json:"owner"`
	Updated string `json:"updated"`
}

func (g *GerritClient) GetGerritCLStatus(cl string) (*GerritCLStatus, error) {
	url := fmt.Sprintf("https://%s/changes/%s?o=DETAILED_ACCOUNTS", g.hostname, cl)
	resp, err := g.httpClient.Get(url)
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

func (g *GerritClient) GetGerritCLComments(cl string) (*GerritCLComments, error) {
	url := fmt.Sprintf("https://%s/changes/%s/comments", g.hostname, cl)
	resp, err := g.httpClient.Get(url)
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

func (g *GerritClient) GetGerritCLDiff(cl string) (*GerritCLDiff, error) {
	url := fmt.Sprintf("https://%s/changes/%s/revisions/current/patch", g.hostname, cl)
	resp, err := g.httpClient.Get(url)
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

// GerritFile represents a file from a Gerrit CL
type GerritFile struct {
	CLId     string `json:"cl_id"`
	Subject  string `json:"subject"`
	Patchset int    `json:"patchset"`
	Author   string `json:"author"`
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
	Lines    int    `json:"lines"`
}

// extractCLNumber extracts the CL number from a CL URL or returns the input if it's already a number
func (g *GerritClient) extractCLNumber(input string) string {
	// If it's a URL, extract the CL number
	if strings.Contains(input, g.hostname) {
		// Match patterns like /c/chromium/src/+/1234567 or /c/pdfium/+/12345
		re := regexp.MustCompile(`/c/.+?/\+/(\d+)`)
		matches := re.FindStringSubmatch(input)
		if len(matches) > 1 {
			return matches[1]
		}
	}
	// Otherwise assume it's already a CL number
	return input
}

func (g *GerritClient) GetGerritFile(clNumber string, filePath string, patchset int) (*GerritFile, error) {
	// Extract CL number from URL if provided
	clID := g.extractCLNumber(clNumber)
	
	// First, get CL details to find the current patchset if not provided
	clURL := fmt.Sprintf("https://%s/changes/%s/detail", g.hostname, clID)
	req, err := http.NewRequest("GET", clURL, nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch CL details: %s", resp.Status)
	}
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	// Remove XSSI prefix
	body = bytes.TrimPrefix(body, []byte(")]}'\n"))
	
	var clDetails map[string]interface{}
	if err := json.Unmarshal(body, &clDetails); err != nil {
		return nil, err
	}
	
	// Get subject and author
	subject, _ := clDetails["subject"].(string)
	owner, _ := clDetails["owner"].(map[string]interface{})
	authorName, _ := owner["name"].(string)
	
	// Get current patchset if not provided
	if patchset == 0 {
		currentRevision, _ := clDetails["current_revision"].(string)
		revisions, _ := clDetails["revisions"].(map[string]interface{})
		if rev, ok := revisions[currentRevision].(map[string]interface{}); ok {
			if ps, ok := rev["_number"].(float64); ok {
				patchset = int(ps)
			}
		}
	}
	
	// Now fetch the file content
	fileURL := fmt.Sprintf("https://%s/changes/%s/revisions/%d/files/%s/content",
		g.hostname, clID, patchset, url.QueryEscape(filePath))
	
	req2, err := http.NewRequest("GET", fileURL, nil)
	if err != nil {
		return nil, err
	}
	
	resp2, err := g.httpClient.Do(req2)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()
	
	if resp2.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch file content: %s", resp2.Status)
	}
	
	contentBody, err := io.ReadAll(resp2.Body)
	if err != nil {
		return nil, err
	}
	
	// The response is base64 encoded
	decoded, err := base64.StdEncoding.DecodeString(string(contentBody))
	if err != nil {
		return nil, fmt.Errorf("failed to decode file content: %w", err)
	}
	
	lines := strings.Count(string(decoded), "\n") + 1
	
	return &GerritFile{
		CLId:     clID,
		Subject:  subject,
		Patchset: patchset,
		Author:   authorName,
		FilePath: filePath,
		Content:  string(decoded),
		Lines:    lines,
	}, nil
}

// GerritBot represents a try-bot result
type GerritBot struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Summary string `json:"summary"`
	URL     string `json:"url"`
}

// GerritBotsStatus represents try-bot status for a CL
type GerritBotsStatus struct {
	CLId        string       `json:"cl_id"`
	Subject     string       `json:"subject"`
	TotalPassed int          `json:"total_passed"`
	TotalFailed int          `json:"total_failed"`
	TotalRunning int         `json:"total_running"`
	TotalCanceled int        `json:"total_canceled"`
	Bots        []GerritBot  `json:"bots"`
}

func (g *GerritClient) GetGerritBotsStatus(clNumber string, patchset int, failedOnly bool) (*GerritBotsStatus, error) {
	// Extract CL number from URL if provided
	clID := g.extractCLNumber(clNumber)
	
	// First get CL details
	clURL := fmt.Sprintf("https://%s/changes/%s/detail", g.hostname, clID)
	req, err := http.NewRequest("GET", clURL, nil)
	if err != nil {
		return nil, err
	}
	
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch CL details: %s", resp.Status)
	}
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	// Remove XSSI prefix
	body = bytes.TrimPrefix(body, []byte(")]}'\n"))
	
	var clDetails map[string]interface{}
	if err := json.Unmarshal(body, &clDetails); err != nil {
		return nil, err
	}
	
	subject, _ := clDetails["subject"].(string)
	
	// Get messages to find LUCI runs
	messagesURL := fmt.Sprintf("https://%s/changes/%s/messages", g.hostname, clID)
	req2, err := http.NewRequest("GET", messagesURL, nil)
	if err != nil {
		return nil, err
	}
	
	resp2, err := g.httpClient.Do(req2)
	if err != nil {
		return nil, err
	}
	defer resp2.Body.Close()
	
	if resp2.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch messages: %s", resp2.Status)
	}
	
	messagesBody, err := io.ReadAll(resp2.Body)
	if err != nil {
		return nil, err
	}
	
	// Remove XSSI prefix
	messagesBody = bytes.TrimPrefix(messagesBody, []byte(")]}'\n"))
	
	var messages []map[string]interface{}
	if err := json.Unmarshal(messagesBody, &messages); err != nil {
		return nil, err
	}
	
	// Extract LUCI URLs from messages
	luciURLs := g.extractLuciURLs(messages)
	if len(luciURLs) == 0 {
		return &GerritBotsStatus{
			CLId:    clID,
			Subject: subject,
			Bots:    []GerritBot{},
		}, nil
	}
	
	// Get the most recent LUCI run
	luciURL := luciURLs[0]
	
	// Fetch LUCI page
	luciReq, err := http.NewRequest("GET", luciURL, nil)
	if err != nil {
		return nil, err
	}
	
	luciResp, err := g.httpClient.Do(luciReq)
	if err != nil {
		return nil, err
	}
	defer luciResp.Body.Close()
	
	if luciResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch LUCI page: %s", luciResp.Status)
	}
	
	luciBody, err := io.ReadAll(luciResp.Body)
	if err != nil {
		return nil, err
	}
	
	// Parse the HTML to extract bot statuses
	bots := parseLuciHTML(string(luciBody))
	
	// Count statuses
	result := &GerritBotsStatus{
		CLId:    clID,
		Subject: subject,
		Bots:    []GerritBot{},
	}
	
	for _, bot := range bots {
		switch bot.Status {
		case "PASSED":
			result.TotalPassed++
		case "FAILED":
			result.TotalFailed++
		case "RUNNING":
			result.TotalRunning++
		case "CANCELED":
			result.TotalCanceled++
		}
		
		if !failedOnly || bot.Status == "FAILED" {
			result.Bots = append(result.Bots, bot)
		}
	}
	
	return result, nil
}

func (g *GerritClient) extractLuciURLs(messages []map[string]interface{}) []string {
	var urls []string
	re := regexp.MustCompile(fmt.Sprintf(`https://luci-change-verifier\.appspot\.com/ui/run/%s/[^\s]+`, g.project))
	
	for _, msg := range messages {
		message, ok := msg["message"].(string)
		if !ok {
			continue
		}
		
		matches := re.FindAllString(message, -1)
		urls = append(urls, matches...)
	}
	
	// Return in reverse order (most recent first)
	for i, j := 0, len(urls)-1; i < j; i, j = i+1, j-1 {
		urls[i], urls[j] = urls[j], urls[i]
	}
	
	return urls
}

func parseLuciHTML(html string) []GerritBot {
	var bots []GerritBot
	
	// Find all tryjob-chip elements
	re := regexp.MustCompile(`<a[^>]*class="[^"]*tryjob-chip[^"]*"[^>]*>(.*?)</a>`)
	matches := re.FindAllStringSubmatch(html, -1)
	
	for _, match := range matches {
		if len(match) > 1 {
			content := match[1]
			
			// Extract bot name and status
			// The content usually looks like: "bot-name PASSED" or "bot-name FAILED"
			parts := strings.Fields(content)
			if len(parts) >= 2 {
				status := parts[len(parts)-1]
				name := strings.Join(parts[:len(parts)-1], " ")
				
				// Clean up HTML entities
				name = strings.ReplaceAll(name, "&amp;", "&")
				name = strings.ReplaceAll(name, "&lt;", "<")
				name = strings.ReplaceAll(name, "&gt;", ">")
				
				bot := GerritBot{
					Name:   name,
					Status: status,
				}
				
				// Try to extract URL from the anchor tag
				urlRe := regexp.MustCompile(`href="([^"]+)"`)
				if urlMatch := urlRe.FindStringSubmatch(match[0]); len(urlMatch) > 1 {
					bot.URL = urlMatch[1]
					if !strings.HasPrefix(bot.URL, "http") {
						bot.URL = "https://luci-change-verifier.appspot.com" + bot.URL
					}
				}
				
				bots = append(bots, bot)
			}
		}
	}
	
	return bots
}

// Issue details
type Issue struct {
	ID       string `json:"id"`
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
	url := fmt.Sprintf("https://issues.chromium.org/action/issues/%s/events?currentTrackerId=157", issueID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36")
	req.Header.Set("x-krn-client-trusted", "3AvLE6jaDrJhqtaE")
	req.Header.Set("Referer", fmt.Sprintf("https://issues.chromium.org/issues/%s", issueID))
	if c.cookie != "" {
		req.Header.Set("Cookie", c.cookie)
	}

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

	body = bytes.TrimPrefix(body, []byte(")]}'\n"))

	json := gjson.ParseBytes(body)
	
	// The response structure is [["b.ListIssueEventsResponse", null, [[events...]]]]
	events := json.Get("0.2")
	if !events.Exists() || !events.IsArray() || len(events.Array()) == 0 {
		return nil, fmt.Errorf("could not find events array")
	}

	// Look for the first event which contains the issue metadata
	// The metadata is at position 5 in the first event
	firstEvent := events.Array()[0]
	metadata := firstEvent.Get("5")

	issue := &Issue{
		ID: issueID,
	}
	
	// metadata is an array, not an object
	if metadata.IsArray() {
		for _, field := range metadata.Array() {
			fieldName := field.Get("0").String()
			switch fieldName {
			case "title":
				// Structure: ["title", null, [null, ["type.googleapis.com/google.protobuf.StringValue", ["Title"]]]]
				// Path: field[2][1][1][0]
				titleArray := field.Get("2.1.1")
				if titleArray.Exists() && titleArray.IsArray() && len(titleArray.Array()) > 0 {
					issue.Title = titleArray.Array()[0].String()
				}
			case "status":
				// Structure: ["status", null, [null, ["type.googleapis.com/google.protobuf.Int32Value", [2]]]]
				statusArray := field.Get("2.1.1")
				if statusArray.Exists() && statusArray.IsArray() && len(statusArray.Array()) > 0 {
					issue.Status = mapIssueStatus(statusArray.Array()[0].Int())
				}
			case "priority":
				priorityArray := field.Get("2.1.1")
				if priorityArray.Exists() && priorityArray.IsArray() && len(priorityArray.Array()) > 0 {
					issue.Priority = mapIssuePriority(priorityArray.Array()[0].Int())
				}
			case "type":
				typeArray := field.Get("2.1.1")
				if typeArray.Exists() && typeArray.IsArray() && len(typeArray.Array()) > 0 {
					issue.Type = mapIssueType(typeArray.Array()[0].Int())
				}
			case "severity":
				severityArray := field.Get("2.1.1")
				if severityArray.Exists() && severityArray.IsArray() && len(severityArray.Array()) > 0 {
					issue.Severity = mapIssueSeverity(severityArray.Array()[0].Int())
				}
			case "reporter":
				// Structure: ["reporter", null, [null, ["type.googleapis.com/google.devtools.issuetracker.v1.User", [null, "email", ...]]]]
				// Path: field[2][1][1][1] for email
				reporterEmail := field.Get("2.1.1.1")
				if reporterEmail.Exists() {
					issue.Reporter = reporterEmail.String()
				}
			case "assignee":
				assigneeEmail := field.Get("2.1.1.1")
				if assigneeEmail.Exists() {
					issue.Assignee = assigneeEmail.String()
				}
			}
		}
	}

	return issue, nil
}

// IssueSearchResult represents a search result item
type IssueSearchResult struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	Priority string `json:"priority"`
	Type     string `json:"type"`
	Reporter string `json:"reporter"`
	Modified string `json:"modified"`
}

// IssueSearchResults represents search results
type IssueSearchResults struct {
	Results    []IssueSearchResult `json:"results"`
	TotalCount int                 `json:"total_count"`
}

func (c *ChromiumClient) SearchIssues(query string, limit int) (*IssueSearchResults, error) {
	url := "https://issues.chromium.org/action/issues/list"
	
	// Build the payload based on JS implementation
	searchParams := []interface{}{query, "modified_time desc", limit}
	payload := []interface{}{
		nil,
		nil,
		nil,
		nil,
		nil,
		[]string{"157"}, // Track ID for Chromium
		searchParams,
	}
	
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	
	req, err := http.NewRequest("POST", url, bytes.NewReader(jsonPayload))
	if err != nil {
		return nil, err
	}
	
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to search issues: %s\n%s", resp.Status, string(body))
	}
	
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	
	// Remove XSSI prefix
	body = bytes.TrimPrefix(body, []byte(")]}'\n"))
	
	// Parse the response
	jsonData := gjson.ParseBytes(body)
	
	results := &IssueSearchResults{
		Results: []IssueSearchResult{},
	}
	
	// The response structure is complex, need to navigate to the results
	issuesArray := jsonData.Get("0.1")
	if issuesArray.Exists() && issuesArray.IsArray() {
		for _, issue := range issuesArray.Array() {
			result := IssueSearchResult{}
			
			// Extract issue ID
			idValue := issue.Get("0")
			if idValue.Exists() {
				result.ID = fmt.Sprintf("%d", idValue.Int())
			}
			
			// Extract fields from the issue data
			fields := issue.Get("1")
			if fields.Exists() && fields.IsArray() {
				for _, field := range fields.Array() {
					fieldName := field.Get("0").String()
					switch fieldName {
					case "title":
						titleValue := field.Get("2.0.1.1")
						if titleValue.Exists() && titleValue.IsArray() && len(titleValue.Array()) > 0 {
							result.Title = titleValue.Array()[0].String()
						}
					case "status":
						statusValue := field.Get("2.0.1.1")
						if statusValue.Exists() && statusValue.IsArray() && len(statusValue.Array()) > 0 {
							result.Status = mapIssueStatus(statusValue.Array()[0].Int())
						}
					case "priority":
						priorityValue := field.Get("2.0.1.1")
						if priorityValue.Exists() && priorityValue.IsArray() && len(priorityValue.Array()) > 0 {
							result.Priority = mapIssuePriority(priorityValue.Array()[0].Int())
						}
					case "type":
						typeValue := field.Get("2.0.1.1")
						if typeValue.Exists() && typeValue.IsArray() && len(typeValue.Array()) > 0 {
							result.Type = mapIssueType(typeValue.Array()[0].Int())
						}
					case "reporter":
						reporterEmail := field.Get("2.0.1.1.1")
						if reporterEmail.Exists() {
							result.Reporter = reporterEmail.String()
						}
					case "modified_time":
						// Handle timestamp
						modifiedTime := field.Get("2.0.1")
						if modifiedTime.Exists() && modifiedTime.IsArray() && len(modifiedTime.Array()) > 0 {
							seconds := modifiedTime.Array()[0].Int()
							if seconds > 0 {
								result.Modified = time.Unix(seconds, 0).Format("2006-01-02")
							}
						}
					}
				}
			}
			
			if result.ID != "" {
				results.Results = append(results.Results, result)
			}
		}
	}
	
	// Try to get total count
	totalCount := jsonData.Get("0.2")
	if totalCount.Exists() {
		results.TotalCount = int(totalCount.Int())
	} else {
		results.TotalCount = len(results.Results)
	}
	
	return results, nil
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
		return "NOT_FEASIBLE"
	case 7:
		return "INFEASIBLE"
	case 8:
		return "DUPLICATE"
	case 9:
		return "ARCHIVED"
	default:
		return fmt.Sprintf("Unknown(%d)", status)
	}
}

func mapIssuePriority(priority int64) string {
	switch priority {
	case 1:
		return "P0"
	case 2:
		return "P1"
	case 3:
		return "P2"
	case 4:
		return "P3"
	case 5:
		return "P4"
	default:
		return fmt.Sprintf("Unknown(%d)", priority)
	}
}

func mapIssueType(issueType int64) string {
	switch issueType {
	case 1:
		return "Bug"
	case 2:
		return "Feature Request"
	case 3:
		return "Process"
	case 4:
		return "Internal Cleanup"
	case 5:
		return "Vulnerability"
	case 6:
		return "Privacy Issue"
	default:
		return fmt.Sprintf("Unknown(%d)", issueType)
	}
}

func mapIssueSeverity(severity int64) string {
	switch severity {
	case 1:
		return "S0"
	case 2:
		return "S1"
	case 3:
		return "S2"
	case 4:
		return "S3"
	case 5:
		return "S4"
	default:
		return fmt.Sprintf("Unknown(%d)", severity)
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
