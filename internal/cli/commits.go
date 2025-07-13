package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewCommitsCommand(client *api.ChromiumClient) *cobra.Command {
	var limit int
	
	cmd := &cobra.Command{
		Use:   "commits <query>",
		Short: "Search Chromium commit history",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := args[0]
			format, _ := cmd.Flags().GetString("format")
			
						
			result, err := client.SearchCommits(query, limit)
			if err != nil {
				return fmt.Errorf("commit search failed: %w", err)
			}
			
			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(result)
			case "plain":
				formatter.PrintCommitResultsPlain(result)
			default:
				formatter.PrintCommitResultsTable(result)
			}
			
			return nil
		},
	}
	
	cmd.Flags().IntVarP(&limit, "limit", "l", 20, "Limit the number of results")
	
	return cmd
}
