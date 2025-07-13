package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewGerritCommand(client *api.ChromiumClient) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "gerrit",
		Short: "Interact with Chromium Gerrit CLs",
		Long:  `View and interact with Chromium Gerrit code reviews.`,
	}
	
	cmd.AddCommand(newGerritStatusCommand(client))
	cmd.AddCommand(newGerritCommentsCommand(client))
	cmd.AddCommand(newGerritDiffCommand(client))
	
	return cmd
}

func newGerritStatusCommand(client *api.ChromiumClient) *cobra.Command {
	return &cobra.Command{
		Use:   "status <cl_number>",
		Short: "Get status of a Gerrit CL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := args[0]
			format, _ := cmd.Flags().GetString("format")

			
			result, err := client.GetGerritCLStatus(cl)
			if err != nil {
				return fmt.Errorf("gerrit status failed: %w", err)
			}

			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(result)
			default:
				formatter.PrintGerritCLStatus(result)
			}

			return nil
		},
	}
}

func newGerritCommentsCommand(client *api.ChromiumClient) *cobra.Command {
	return &cobra.Command{
		Use:   "comments <cl_number>",
		Short: "Get comments on a Gerrit CL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := args[0]
			format, _ := cmd.Flags().GetString("format")

			
			result, err := client.GetGerritCLComments(cl)
			if err != nil {
				return fmt.Errorf("gerrit comments failed: %w", err)
			}

			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(result)
			default:
				formatter.PrintGerritCLComments(result)
			}

			return nil
		},
	}
}

func newGerritDiffCommand(client *api.ChromiumClient) *cobra.Command {
	return &cobra.Command{
		Use:   "diff <cl_number>",
		Short: "Get diff of a Gerrit CL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := args[0]
			format, _ := cmd.Flags().GetString("format")

			
			result, err := client.GetGerritCLDiff(cl)
			if err != nil {
				return fmt.Errorf("gerrit diff failed: %w", err)
			}

			switch format {
			case "json":
				encoder := json.NewEncoder(os.Stdout)
				encoder.SetIndent("", "  ")
				return encoder.Encode(result)
			default:
				formatter.PrintGerritCLDiff(result)
			}

			return nil
		},
	}
}
