package main

import (
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
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

	client := api.NewChromiumClient()

	// Add commands
	rootCmd.AddCommand(cli.NewSearchCommand(client))
	rootCmd.AddCommand(cli.NewFileCommand(client))
	rootCmd.AddCommand(cli.NewSymbolCommand(client))
	rootCmd.AddCommand(cli.NewListFolderCommand(client))
	rootCmd.AddCommand(cli.NewGerritCommand(client))
	rootCmd.AddCommand(cli.NewIssueCmd(client))
	rootCmd.AddCommand(cli.NewCommitsCommand(client))
	rootCmd.AddCommand(cli.NewOwnersCmd(client))
	rootCmd.AddCommand(cli.NewAIGuideCommand(client))

	// Execute
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}