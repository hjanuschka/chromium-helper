package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/tidwall/gjson"
)

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
	
	// The response structure is: [{ 0: "b.IssueSearchResponse", ..., 6: [[[issueData, ...]], ...] }]
	issuesContainer := jsonData.Get("0.6")
	if issuesContainer.Exists() && issuesContainer.IsArray() {
		for _, item := range issuesContainer.Array() {
			// Check if this item contains issue arrays
			if item.IsArray() {
				for _, issueData := range item.Array() {
					// Check if this looks like an issue array
					if issueData.IsArray() && issueData.Get("1").Exists() {
						issueID := issueData.Get("1").Int()
						if issueID > 1000000 { // Valid issue IDs are typically > 1000000
							result := IssueSearchResult{}
							result.ID = fmt.Sprintf("%d", issueID)
							
							// Nested issue data is at position 2
							nestedData := issueData.Get("2")
							if nestedData.Exists() && nestedData.IsArray() {
								// Title at nestedData[5]
								if nestedData.Get("5").Exists() {
									result.Title = nestedData.Get("5").String()
								}
								
								// Reporter at nestedData[6] - format: [null, "email", 1]
								if nestedData.Get("6").Exists() && nestedData.Get("6").IsArray() {
									if nestedData.Get("6.1").Exists() {
										result.Reporter = nestedData.Get("6.1").String()
									}
								}
								
								// Status (numeric) might be at position 1
								if nestedData.Get("1").Exists() {
									statusVal := nestedData.Get("1").Int()
									if statusVal > 0 {
										result.Status = mapIssueStatus(statusVal)
									}
								}
								
								// Priority (numeric) might be at position 2
								if nestedData.Get("2").Exists() {
									priorityVal := nestedData.Get("2").Int()
									if priorityVal > 0 {
										result.Priority = mapIssuePriority(priorityVal)
									}
								}
								
								// Type (numeric) might be at position 3
								if nestedData.Get("3").Exists() {
									typeVal := nestedData.Get("3").Int()
									if typeVal > 0 {
										result.Type = mapIssueType(typeVal)
									}
								}
							}
							
							// Also check direct positions in the main array
							// Status at position 8
							if result.Status == "" && issueData.Get("8").Exists() {
								statusVal := issueData.Get("8").Int()
								result.Status = mapIssueStatus(statusVal)
							}
							
							// Priority at position 9 - format: [priority_value]
							if result.Priority == "" && issueData.Get("9").Exists() && issueData.Get("9").IsArray() {
								if issueData.Get("9.0").Exists() {
									priorityVal := issueData.Get("9.0").Int()
									result.Priority = mapIssuePriority(priorityVal)
								}
							}
							
							// Modified time at position 4 - format: [seconds]
							if result.Modified == "" && issueData.Get("4").Exists() && issueData.Get("4").IsArray() {
								if issueData.Get("4.0").Exists() {
									seconds := issueData.Get("4.0").Int()
									if seconds > 0 {
										t := time.Unix(seconds, 0)
										result.Modified = t.Format("2006-01-02")
									}
								}
							}
							
							if result.ID != "" {
								results.Results = append(results.Results, result)
							}
						}
					}
				}
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