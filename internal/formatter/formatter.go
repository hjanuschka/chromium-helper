package formatter

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/olekukonko/tablewriter"
	"github.com/ttacon/chalk"
)

var (
	fileColor   = chalk.Cyan
	lineColor   = chalk.Yellow
	matchColor  = chalk.Green
	headerColor = chalk.Magenta
	dirColor    = chalk.Blue
	sizeColor   = chalk.White
	sourceColor = chalk.Red
)

// Search results formatting
func PrintSearchResultsTable(result *api.SearchResult) {
	if len(result.Results) == 0 {
		fmt.Println(chalk.Yellow.Color("No results found"))
		return
	}

	fmt.Printf("%s\n\n", chalk.Cyan.Color(fmt.Sprintf("Found %d results:", len(result.Results))))

	for i, match := range result.Results {
		greenBold := chalk.Green.NewStyle().WithTextStyle(chalk.Bold)
		fmt.Printf("%s\n", greenBold.Style(fmt.Sprintf("%d. %s:%d", i+1, match.File, match.Line)))
		fmt.Printf("%s\n", chalk.White.Color("───────────────────────────────"))
		fmt.Println(match.Content)
		url := fmt.Sprintf("https://source.chromium.org/chromium/chromium/src/+/main:%s;l=%d", match.File, match.Line)
		fmt.Printf("%s\n\n", chalk.Blue.Color(fmt.Sprintf("🔗 %s", url)))
	}
}

func PrintSearchResultsPlain(result *api.SearchResult) {
	PrintSearchResultsTable(result)
}

// File content formatting
func PrintFileContentTable(content *api.FileContent) {
	boldCyan := chalk.Cyan.NewStyle().WithTextStyle(chalk.Bold)
	gray := chalk.White.NewStyle()
	yellow := chalk.Yellow.NewStyle()
	blue := chalk.Blue.NewStyle()

	fmt.Printf("%s\n", boldCyan.Style(fmt.Sprintf("File: %s", content.Path)))
	fmt.Printf("%s\n", gray.Style(fmt.Sprintf("Total lines: %d | Displayed: %d", content.TotalLines, content.DisplayedLines)))

	if content.LineStart > 0 {
		lineEndStr := ""
		if content.LineEnd > 0 {
			lineEndStr = fmt.Sprintf("-%d", content.LineEnd)
		} else {
			lineEndStr = "+"
		}
		fmt.Printf("%s\n", gray.Style(fmt.Sprintf("Lines: %d%s", content.LineStart, lineEndStr)))
	}

	if content.Source != "" {
		fmt.Printf("%s\n", yellow.Style(fmt.Sprintf("📌 Source: %s", getSourceDescription(content.Source))))
	}

	fmt.Printf("%s\n", blue.Style(fmt.Sprintf("🔗 %s", content.BrowserUrl)))
	if content.GithubUrl != "" {
		fmt.Printf("%s\n", blue.Style(fmt.Sprintf("🔗 GitHub: %s", content.GithubUrl)))
	}
	if content.WebrtcUrl != "" {
		fmt.Printf("%s\n", blue.Style(fmt.Sprintf("🔗 WebRTC: %s", content.WebrtcUrl)))
	}

	fmt.Println()
	fmt.Printf("%s\n", gray.Style("Content:"))
	fmt.Printf("%s\n", strings.Repeat("─", 80))

	for i, line := range content.Lines {
		lineNum := content.LineStart + i
		if content.LineStart == 0 {
			lineNum = i + 1
		}
		fmt.Printf("%s %s\n", gray.Style(fmt.Sprintf("%4d:", lineNum)), line)
	}
	fmt.Printf("%s\n", strings.Repeat("─", 80))
}

func PrintFileContentPlain(content *api.FileContent) {
	PrintFileContentTable(content) // Same formatting for plain and table for files
}

// Symbol results formatting
func PrintSymbolResultsTable(result *api.SymbolResult) {
	fmt.Printf("\nSymbol: %s\n", result.Symbol)
	fmt.Printf("Found %d definitions and %d references\n\n",
		len(result.Definitions), len(result.References))

	if len(result.Definitions) > 0 {
		fmt.Println("Definitions:")
		table := tablewriter.NewWriter(os.Stdout)
		table.SetHeader([]string{"File", "Line", "Type", "Content"})
		table.SetAutoWrapText(false)

		for _, def := range result.Definitions {
			table.Append([]string{
				def.File,
				fmt.Sprintf("%d", def.Line),
				def.Type,
				strings.TrimSpace(def.Content),
			})
		}

		table.Render()
		fmt.Println()
	}

	if len(result.References) > 0 {
		fmt.Println("References:")
		table := tablewriter.NewWriter(os.Stdout)
		table.SetHeader([]string{"File", "Line", "Content"})
		table.SetAutoWrapText(false)

		for _, ref := range result.References {
			table.Append([]string{
				ref.File,
				fmt.Sprintf("%d", ref.Line),
				strings.TrimSpace(ref.Content),
			})
		}

		table.Render()
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
		for _, ref := range result.References {
			fmt.Printf("%s:%d: %s\n",
				ref.File, ref.Line,
				strings.TrimSpace(ref.Content))
		}
	}
}

// Folder listing formatting
func PrintFolderContentTable(content *api.FolderContent) {
	fmt.Printf("\nContents of %s\n", content.Path)

	if content.Source != "" && content.Source != "chromium" {
		fmt.Printf("Source: %s\n", getSourceDescription(content.Source))
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
			"[DIR]",
			fmt.Sprintf("%s/", dir.Name),
			"-",
		})
	}

	// Then files
	for _, file := range files {
		table.Append([]string{
			"[FILE]",
			file.Name,
			formatSize(file.Size),
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

// Gerrit CL File formatting
func PrintGerritFile(file *api.GerritFile) {
	fmt.Printf("\nFile: %s\n", file.FilePath)
	fmt.Printf("CL: %s - %s\n", file.CLId, file.Subject)
	fmt.Printf("Patchset: %d | Author: %s | Lines: %d\n\n", file.Patchset, file.Author, file.Lines)

	lines := strings.Split(file.Content, "\n")
	for i, line := range lines {
		fmt.Printf("%4d  %s\n", i+1, line)
	}
}

// Gerrit CL Bots formatting
func PrintGerritBotsStatus(status *api.GerritBotsStatus) {
	fmt.Printf("\nTry-Bot Status for CL %s\n", status.CLId)
	if status.Subject != "" {
		fmt.Printf("Subject: %s\n\n", status.Subject)
	}

	fmt.Printf("Summary: ")
	if status.TotalPassed > 0 {
		fmt.Printf("✓ %d passed ", status.TotalPassed)
	}
	if status.TotalFailed > 0 {
		fmt.Printf("✗ %d failed ", status.TotalFailed)
	}
	if status.TotalRunning > 0 {
		fmt.Printf("⟳ %d running ", status.TotalRunning)
	}
	if status.TotalCanceled > 0 {
		fmt.Printf("○ %d canceled ", status.TotalCanceled)
	}
	fmt.Println("\n")

	if len(status.Bots) == 0 {
		fmt.Println("No try-bot results found")
		return
	}

	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Bot Name", "Status", "URL"})
	table.SetAutoWrapText(false)
	table.SetColWidth(50)

	for _, bot := range status.Bots {
		statusStr := bot.Status
		switch bot.Status {
		case "PASSED":
			statusStr = "✓ PASSED"
		case "FAILED":
			statusStr = "✗ FAILED"
		case "RUNNING":
			statusStr = "⟳ RUNNING"
		case "CANCELED":
			statusStr = "○ CANCELED"
		}

		table.Append([]string{
			bot.Name,
			statusStr,
			bot.URL,
		})
	}

	table.Render()
}

func PrintIssueDetails(issue *api.Issue) {
	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"Field", "Value"})

	table.Append([]string{"ID", issue.ID})
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

// Issue search results formatting
func PrintIssueSearchResults(results *api.IssueSearchResults) {
	if len(results.Results) == 0 {
		fmt.Println("No issues found")
		return
	}

	fmt.Printf("Found %d issues (showing %d)\n\n", results.TotalCount, len(results.Results))

	table := tablewriter.NewWriter(os.Stdout)
	table.SetHeader([]string{"ID", "Title", "Status", "Priority", "Type", "Reporter", "Modified"})
	table.SetAutoWrapText(true)
	table.SetColWidth(50)

	for _, issue := range results.Results {
		table.Append([]string{
			issue.ID,
			truncateString(issue.Title, 50),
			issue.Status,
			issue.Priority,
			issue.Type,
			issue.Reporter,
			issue.Modified,
		})
	}

	table.Render()
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// Owners formatting
func PrintOwnersTable(result *api.OwnersResult) {
	fmt.Printf("\nOWNERS for: %s\n", result.FilePath)

	if len(result.OwnerFiles) == 0 {
		fmt.Println("No OWNERS files found.")
		return
	}

	for _, ownerFile := range result.OwnerFiles {
		fmt.Printf("\nOWNERS File: %s\n", ownerFile.Path)
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