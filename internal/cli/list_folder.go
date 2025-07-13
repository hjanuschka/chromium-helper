package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewListFolderCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list-folder <path>",
		Aliases: []string{"ls"},
		Short:   "List files and folders in a Chromium source directory",
		Long: `List files and folders in a Chromium source directory.
Supports Git submodules (V8, WebRTC, DevTools).

Examples:
  chromium-helper list-folder base/
  chromium-helper ls content/browser/
  chromium-helper list-folder v8/src/
  chromium-helper ls third_party/webrtc/api/`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			format, _ := cmd.Flags().GetString("format")
			
			// Create API client
			client := api.NewChromiumClient()
			
			// List folder contents
			content, err := client.ListFolder(path)
			if err != nil {
				return fmt.Errorf("failed to list folder: %w", err)
			}
			
			// Format output
			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(content)
			case "plain":
				formatter.PrintFolderContentPlain(content)
			default:
				formatter.PrintFolderContentTable(content)
			}
			
			return nil
		},
	}
	
	return cmd
}