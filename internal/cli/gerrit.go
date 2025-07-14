package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"
	"github.com/spf13/cobra"
)

func NewGerritCommand(gerritClient *api.GerritClient) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "gerrit",
		Short: "Interact with Chromium Gerrit CLs",
		Long:  `View and interact with Chromium Gerrit code reviews.`,
	}

	cmd.AddCommand(newGerritStatusCommand(gerritClient))
	cmd.AddCommand(newGerritCommentsCommand(gerritClient))
	cmd.AddCommand(newGerritDiffCommand(gerritClient))
	cmd.AddCommand(NewGerritFileCmd(gerritClient))
	cmd.AddCommand(NewGerritBotsCmd(gerritClient))

	return cmd
}

func newGerritStatusCommand(gerritClient *api.GerritClient) *cobra.Command {
	return &cobra.Command{
		Use:   "status <cl_number>",
		Short: "Get status of a Gerrit CL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := args[0]
			format, _ := cmd.Flags().GetString("format")

			result, err := gerritClient.GetGerritCLStatus(cl)
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

func newGerritCommentsCommand(gerritClient *api.GerritClient) *cobra.Command {
	return &cobra.Command{
		Use:   "comments <cl_number>",
		Short: "Get comments on a Gerrit CL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := args[0]
			format, _ := cmd.Flags().GetString("format")

			result, err := gerritClient.GetGerritCLComments(cl)
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

func newGerritDiffCommand(gerritClient *api.GerritClient) *cobra.Command {
	return &cobra.Command{
		Use:   "diff <cl_number>",
		Short: "Get diff of a Gerrit CL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := args[0]
			format, _ := cmd.Flags().GetString("format")

			result, err := gerritClient.GetGerritCLDiff(cl)
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
