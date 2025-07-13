package cli

import (
	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
	"log"
)

func NewOwnersCmd(client *api.ChromiumClient) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "owners <file_path>",
		Short: "Find owners for a file in the Chromium codebase",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			filePath := args[0]
			format, _ := cmd.Flags().GetString("format")

			owners, err := client.FindOwners(filePath)
			if err != nil {
				log.Fatalf("Failed to find owners: %v", err)
			}

			switch format {
			case "json":
				formatter.PrintOwnersJSON(owners)
			default:
				formatter.PrintOwnersTable(owners)
			}
		},
	}
	return cmd
}
