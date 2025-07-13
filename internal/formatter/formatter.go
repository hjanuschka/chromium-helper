package formatter

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/olekukonko/tablewriter"
)

var (
	fileColor    = color.New(color.FgCyan)
	lineColor    = color.New(color.FgYellow)
	matchColor   = color.New(color.FgGreen, color.Bold)
	headerColor  = color.New(color.FgMagenta, color.Bold)
	dirColor     = color.New(color.FgBlue, color.Bold)
	sizeColor    = color.New(color.FgWhite, color.Faint)
	sourceColor  = color.New(color.FgRed)
)

// Search results formatting
func PrintSearchResultsTable(result *api.SearchResult) {
	fmt.Printf("\n%s\n", headerColor.Sprintf("Search Results for: %s", result.Query))
	fmt.Printf("Found %d matches\n\n", result.Total)
	
	if len(result.Results) == 0 {
		fmt.Println("No results found.")
		return
	}
	
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"File", "Line", "Content"})
	table.SetAutoWrapText(false)
	table.SetRowLine(true)
	
	for _, match := range result.Results {
		table.Append([]string{
			fileColor.Sprint(match.File),
			lineColor.Sprint(match.Line),
			strings.TrimSpace(match.Content),
		})
	}
	
	table.Render()
}

func PrintSearchResultsPlain(result *api.SearchResult) {
	fmt.Printf("Search Results for: %s\n", result.Query)
	fmt.Printf("Found %d matches\n\n", result.Total)
	
	for _, match := range result.Results {
		fmt.Printf("%s:%d: %s\n", 
			match.File, 
			match.Line, 
			strings.TrimSpace(match.Content))
	}
}

// File content formatting
func PrintFileContentTable(content *api.FileContent) {
	fmt.Printf("\n%s\n", headerColor.Sprintf("File: %s", content.Path))
	
	if content.Source != "" && content.Source != "chromium" {
		fmt.Printf("%s\n", sourceColor.Sprintf("Source: %s", getSourceDescription(content.Source)))
	}
	
	totalLines := len(content.Lines)
	fmt.Printf("Total lines: %d\n\n", totalLines)
	
	// Print content with line numbers
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Line", "Content"})
	table.SetAutoWrapText(false)
	table.SetBorder(false)
	table.SetColumnSeparator("|")
	
	for i, line := range content.Lines {
		lineNum := i + 1
		table.Append([]string{
			lineColor.Sprintf("%4d", lineNum),
			line,
		})
	}
	
	table.Render()
}

func PrintFileContentPlain(content *api.FileContent) {
	fmt.Printf("File: %s\n", content.Path)
	
	if content.Source != "" && content.Source != "chromium" {
		fmt.Printf("Source: %s\n", getSourceDescription(content.Source))
	}
	
	fmt.Printf("Total lines: %d\n\n", len(content.Lines))
	
	for i, line := range content.Lines {
		fmt.Printf("%4d %s\n", i+1, line)
	}
}

// Symbol results formatting
func PrintSymbolResultsTable(result *api.SymbolResult) {
	fmt.Printf("\n%s\n", headerColor.Sprintf("Symbol: %s", result.Symbol))
	fmt.Printf("Found %d definitions and %d references\n\n", 
		len(result.Definitions), len(result.References))
	
	if len(result.Definitions) > 0 {
		fmt.Println(headerColor.Sprint("Definitions:"))
		table := tablewriter.NewWriter(os.Stdout)
		table.SetHeader([]string{"File", "Line", "Type", "Content"})
		table.SetAutoWrapText(false)
			
		for _, def := range result.Definitions {
			table.Append([]string{
				fileColor.Sprint(def.File),
				lineColor.Sprint(def.Line),
				def.Type,
				strings.TrimSpace(def.Content),
			})
		}
		
		table.Render()
		fmt.Println()
	}
	
	if len(result.References) > 0 && len(result.References) <= 10 {
		fmt.Println(headerColor.Sprint("References (first 10):"))
		table := tablewriter.NewWriter(os.Stdout)
		table.SetHeader([]string{"File", "Line", "Content"})
		table.SetAutoWrapText(false)
			
		count := 0
		for _, ref := range result.References {
			if count >= 10 {
				break
			}
			table.Append([]string{
				fileColor.Sprint(ref.File),
				lineColor.Sprint(ref.Line),
				strings.TrimSpace(ref.Content),
			})
			count++
		}
		
		table.Render()
		
		if len(result.References) > 10 {
			fmt.Printf("\n... and %d more references\n", len(result.References)-10)
		}
	}
}

func PrintSymbolResultsPlain(result *api.SymbolResult) {
	fmt.Printf("Symbol: %s\n", result.Symbol)
	fmt.Printf("Found %d definitions and %d references\n\n", 
		len(result.Definitions), len(result.References))
	
	if len(result.Definitions) > 0 {
		fmt.Println("Definitions:")
		for _, def := range result.Definitions {
			fmt.Printf("%s:%d (%s): %s\n", 
				def.File, def.Line, def.Type, 
				strings.TrimSpace(def.Content))
		}
		fmt.Println()
	}
	
	if len(result.References) > 0 {
		fmt.Println("References:")
		count := 0
		for _, ref := range result.References {
			if count >= 10 {
				fmt.Printf("... and %d more references\n", len(result.References)-10)
				break
			}
			fmt.Printf("%s:%d: %s\n", 
				ref.File, ref.Line, 
				strings.TrimSpace(ref.Content))
			count++
		}
	}
}

// Folder listing formatting
func PrintFolderContentTable(content *api.FolderContent) {
	fmt.Printf("\n%s\n", headerColor.Sprintf("Contents of %s", content.Path))
	
	if content.Source != "" && content.Source != "chromium" {
		fmt.Printf("%s\n", sourceColor.Sprintf("Source: %s", getSourceDescription(content.Source)))
	}
	
	fmt.Printf("Total entries: %d\n\n", len(content.Entries))
	
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Type", "Name", "Size"})
	table.SetAutoWrapText(false)
	
	// Separate directories and files
	var dirs, files []api.FolderEntry
	for _, entry := range content.Entries {
		if entry.Type == "dir" {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}
	}
	
	// Print directories first
	for _, dir := range dirs {
		table.Append([]string{
			dirColor.Sprint("[DIR]"),
			dirColor.Sprintf("%s/", dir.Name),
			"-",
		})
	}
	
	// Then files
	for _, file := range files {
		table.Append([]string{
			"[FILE]",
			file.Name,
			sizeColor.Sprint(formatSize(file.Size)),
		})
	}
	
	table.Render()
}

func PrintFolderContentPlain(content *api.FolderContent) {
	fmt.Printf("Contents of %s:\n", content.Path)
	
	if content.Source != "" && content.Source != "chromium" {
		fmt.Printf("Source: %s\n", getSourceDescription(content.Source))
	}
	
	fmt.Printf("Total entries: %d\n\n", len(content.Entries))
	
	// Separate directories and files
	var dirs, files []api.FolderEntry
	for _, entry := range content.Entries {
		if entry.Type == "dir" {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}
	}
	
	// Print directories first
	for _, dir := range dirs {
		fmt.Printf("[DIR]  %s/\n", dir.Name)
	}
	
	// Then files
	for _, file := range files {
		fmt.Printf("[FILE] %s (%s)\n", file.Name, formatSize(file.Size))
	}
}

// Helper functions
func getSourceDescription(source string) string {
	switch source {
	case "v8":
		return "V8 JavaScript Engine (GitHub)"
	case "webrtc":
		return "WebRTC (Gitiles)"
	case "devtools":
		return "Chrome DevTools Frontend"
	default:
		return source
	}
}

func formatSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

func PrintCommitResultsTable(result *api.CommitResult) {
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Hash", "Author", "Date", "Subject"})
	table.SetAutoWrapText(true)
	table.SetRowLine(true)

	for _, commit := range result.Commits {
		hash := commit.Hash[:12]
		subject := strings.Split(commit.Subject, "\n")[0]
		date := strings.Split(commit.Date, " ")[0]
		table.Append([]string{
			hash,
			commit.Author,
			date,
			subject,
		})
	}

	table.Render()
}

func PrintCommitResultsPlain(result *api.CommitResult) {
	for _, commit := range result.Commits {
		hash := commit.Hash[:12]
		subject := strings.Split(commit.Subject, "\n")[0]
		date := strings.Split(commit.Date, " ")[0]
		fmt.Printf("%s %s %s %s\n", hash, commit.Author, date, subject)
	}
}


// Gerrit CL Status formatting
func PrintGerritCLStatus(status *api.GerritCLStatus) {
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Subject", "Status", "Owner", "Updated"})
	table.Append([]string{
		status.Subject,
		status.Status,
		status.Owner,
		status.Updated,
	})
	table.Render()
}

// Gerrit CL Comments formatting
func PrintGerritCLComments(comments *api.GerritCLComments) {
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Author", "Updated", "Message"})
	table.SetAutoWrapText(true)
	table.SetRowLine(true)

	for _, comment := range comments.Comments {
		table.Append([]string{
			comment.Author.Name,
			comment.Updated.Format("2006-01-02"),
			strings.TrimSpace(comment.Message),
		})
	}

	table.Render()
}

// Gerrit CL Diff formatting
func PrintGerritCLDiff(diff *api.GerritCLDiff) {
	fmt.Println(diff.Diff)
}

func PrintIssueDetails(issue *api.Issue) {
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Field", "Value"})
	table.SetAutoWrapText(false)

	data := [][]string{
		{"Title", issue.Title},
		{"Status", issue.Status},
		{"Priority", issue.Priority},
		{"Type", issue.Type},
		{"Severity", issue.Severity},
		{"Reporter", issue.Reporter},
		{"Assignee", issue.Assignee},
		{"Created", issue.Created},
		{"Modified", issue.Modified},
	}

	for _, v := range data {
		table.Append(v)
	}

	table.Render()
}

// Owners formatting
func PrintOwnersTable(result *api.OwnersResult) {
	fmt.Printf("\n%s\n", headerColor.Sprintf("OWNERS for: %s", result.FilePath))

	if len(result.OwnerFiles) == 0 {
		fmt.Println("No OWNERS files found.")
		return
	}

	for _, ownerFile := range result.OwnerFiles {
		fmt.Printf("\n%s\n", fileColor.Sprintf("OWNERS File: %s", ownerFile.Path))
		fmt.Println(strings.Repeat("-", 40))
		fmt.Println(ownerFile.Content)
	}
}

func PrintOwnersJSON(result *api.OwnersResult) {
	// Simple JSON output for now
	type aikenOutput struct {
		FilePath   string           `json:"file_path"`
		OwnerFiles []api.OwnersFile `json:"owner_files"`
	}

	output := aikenOutput{
		FilePath:   result.FilePath,
		OwnerFiles: result.OwnerFiles,
	}

	out, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		fmt.Printf("Error formatting JSON: %v\n", err)
		return
	}
	fmt.Println(string(out))
}



