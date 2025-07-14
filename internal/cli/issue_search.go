package cli

import (
	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"

	"github.com/spf13/cobra"
)

func NewIssueSearchCmd(client *api.ChromiumClient) *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "issue-search <query>",
		Short: "Search for Chromium issues",
		Long: `Search for Chromium issues/bugs using a query string.

Examples:
  chromium-helper issue-search "memory leak"
  chromium-helper issue-search "navigation crash" --limit 10
  chromium-helper issue-search "type:bug priority:p1"`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			results, err := client.SearchIssues(args[0], limit)
			if err != nil {
				return err
			}

			formatter.PrintIssueSearchResults(results)

			return nil
		},
	}

	cmd.Flags().IntVarP(&limit, "limit", "l", 20, "Maximum number of results")

	return cmd
}