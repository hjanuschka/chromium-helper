package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewSymbolCommand(client *api.ChromiumClient) *cobra.Command {
	var symbolType string
	var filePattern string
	
	cmd := &cobra.Command{
		Use:   "symbol <symbol_name>",
		Short: "Find symbol definitions and references",
		Long: `Find symbol definitions, declarations, and references in Chromium.

Examples:
  chromium-helper symbol Browser::Create
  chromium-helper symbol RenderFrameHost --type=definition
  chromium-helper symbol NavigationController --file="content/**/*.h"`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			symbol := args[0]
			format, _ := cmd.Flags().GetString("format")
			
						
			// Find symbol
			result, err := client.FindSymbol(symbol, &api.SymbolOptions{
				Type:        symbolType,
				FilePattern: filePattern,
			})
			if err != nil {
				return fmt.Errorf("symbol search failed: %w", err)
			}
			
			// Format output
			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(result)
			case "plain":
				formatter.PrintSymbolResultsPlain(result)
			default:
				formatter.PrintSymbolResultsTable(result)
			}
			
			return nil
		},
	}
	
	cmd.Flags().StringVarP(&symbolType, "type", "t", "all", "Symbol type: definition, declaration, call, or all")
	cmd.Flags().StringVarP(&filePattern, "file", "p", "", "Filter by file pattern")
	
	return cmd
}