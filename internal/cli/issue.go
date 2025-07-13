package cli

import (
	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"

	"github.com/spf13/cobra"
)

func NewIssueCmd(client *api.ChromiumClient) *cobra.Command {
	return &cobra.Command{
		Use:   "issue <issue_number>",
		Short: "Get details about a Chromium issue",
		Long: `Get details about a Chromium issue/bug from crbug.com.

Examples:
  chromium-helper issue 1234567
  chromium-helper issue 40118868`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
						issue, err := client.GetIssue(args[0])
			if err != nil {
				return err
			}

			formatter.PrintIssueDetails(issue)

			return nil
		},
	}
}