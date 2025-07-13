package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewSearchCommand(client *api.ChromiumClient) *cobra.Command {
	var filePattern string
	var limit int
	var exact bool
	
	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search for code patterns in Chromium source",
		Long: `Search for code patterns in the Chromium source code repository.
		
Examples:
  chromium-helper search "LOG(INFO)"
  chromium-helper search "class Browser" --file="*.h"
  chromium-helper search "::Create" --exact
  chromium-helper search "TODO" --file="content/**/*.cc" --limit=50`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := args[0]
			format, _ := cmd.Flags().GetString("format")
			
						
			// Perform search
			results, err := client.SearchCode(query, &api.SearchOptions{
				FilePattern: filePattern,
				Limit:       limit,
				Exact:       exact,
			})
			if err != nil {
				return fmt.Errorf("search failed: %w", err)
			}
			
			// Format output
			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(results)
			case "plain":
				formatter.PrintSearchResultsPlain(results)
			default:
				formatter.PrintSearchResultsTable(results)
			}
			
			return nil
		},
	}
	
	cmd.Flags().StringVarP(&filePattern, "file", "p", "", "Filter by file pattern (e.g., '*.cc', 'browser/*.h')")
	cmd.Flags().IntVarP(&limit, "limit", "l", 20, "Maximum number of results")
	cmd.Flags().BoolVarP(&exact, "exact", "e", false, "Exact match only")
	
	return cmd
}