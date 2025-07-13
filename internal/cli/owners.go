package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func NewOwnersCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "owners <file_path>",
		Short: "Find code owners for a file or directory",
		Long: `Find code owners and reviewers for a specific file or directory in Chromium.

Examples:
  chromium-helper owners content/browser/
  chromium-helper owners chrome/browser/ui/views/frame/browser_view.cc`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			// TODO: Implement owners lookup
			fmt.Println("Owners lookup functionality will be implemented in the Go version")
			return nil
		},
	}
}