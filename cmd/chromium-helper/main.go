package main

import (
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/cli"
	"github.com/spf13/cobra"
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "chromium-helper",
		Short: "CLI tool for searching and exploring Chromium source code",
		Long: `Chromium Helper is a command-line tool that provides easy access to the Chromium source code
through Google's official CodeSearch API. Search code, find symbols, browse files, and track changes.`,
		Version: "1.2.3",
	}

	// Global flags
	var outputFormat string
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "format", "f", "table", "Output format: table, plain, json")

	// Add commands
	rootCmd.AddCommand(cli.NewSearchCommand())
	rootCmd.AddCommand(cli.NewFileCommand())
	rootCmd.AddCommand(cli.NewSymbolCommand())
	rootCmd.AddCommand(cli.NewListFolderCommand())
	rootCmd.AddCommand(cli.NewGerritCommand())
	rootCmd.AddCommand(cli.NewIssueCommand())
	rootCmd.AddCommand(cli.NewCommitCommand())
	rootCmd.AddCommand(cli.NewOwnersCommand())
	rootCmd.AddCommand(cli.NewAIGuideCommand())

	// Execute
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}