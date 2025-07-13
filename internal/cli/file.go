package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewFileCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "file <path> [line_start[-line_end]]",
		Short: "Get the contents of a file from Chromium source",
		Long: `Get the contents of a specific file from the Chromium source tree.
Supports Git submodules (V8, WebRTC, DevTools).

Examples:
  chromium-helper file base/memory/ref_counted.h
  chromium-helper file content/browser/renderer_host/render_frame_host_impl.cc 100-150
  chromium-helper file v8/src/api/api.cc
  chromium-helper file third_party/webrtc/api/peer_connection_interface.h`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			format, _ := cmd.Flags().GetString("format")
			
			var opts api.FileOptions
			
			// Parse line range if provided
			if len(args) > 1 {
				lineRange := args[1]
				if strings.Contains(lineRange, "-") {
					parts := strings.Split(lineRange, "-")
					if len(parts) == 2 {
						if start, err := strconv.Atoi(parts[0]); err == nil {
							opts.LineStart = start
						}
						if end, err := strconv.Atoi(parts[1]); err == nil {
							opts.LineEnd = end
						}
					}
				} else if line, err := strconv.Atoi(lineRange); err == nil {
					opts.LineStart = line
					opts.LineEnd = line
				}
			}
			
			// Create API client
			client := api.NewChromiumClient()
			
			// Get file content
			content, err := client.GetFile(path, &opts)
			if err != nil {
				return fmt.Errorf("failed to get file: %w", err)
			}
			
			// Format output
			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(content)
			case "plain":
				formatter.PrintFileContentPlain(content)
			default:
				formatter.PrintFileContentTable(content)
			}
			
			return nil
		},
	}
	
	return cmd
}