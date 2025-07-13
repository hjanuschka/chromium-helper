package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func NewIssueCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "issue <issue_number>",
		Short: "Get details about a Chromium issue",
		Long: `Get details about a Chromium issue/bug from crbug.com.

Examples:
  chromium-helper issue 1234567
  chromium-helper issue 40118868`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			// TODO: Implement issue lookup
			fmt.Println("Issue lookup functionality will be implemented in the Go version")
			return nil
		},
	}
}