package cli

import (
	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"

	"github.com/spf13/cobra"
)

func NewGerritBotsCmd(gerritClient *api.GerritClient) *cobra.Command {
	var patchset int
	var failedOnly bool

	cmd := &cobra.Command{
		Use:   "bots <cl>",
		Short: "Get try-bot status for CL",
		Long: `Get the try-bot (LUCI) status for a Chromium Gerrit CL.

Examples:
  chromium-helper gerrit bots 6267351
  chromium-helper gerrit bots 6267351 --failed-only
  chromium-helper gerrit bots https://chromium-review.googlesource.com/c/chromium/src/+/6267351`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			status, err := gerritClient.GetGerritBotsStatus(args[0], patchset, failedOnly)
			if err != nil {
				return err
			}

			formatter.PrintGerritBotsStatus(status)

			return nil
		},
	}

	cmd.Flags().IntVarP(&patchset, "patchset", "p", 0, "Specific patchset number (default: latest)")
	cmd.Flags().BoolVar(&failedOnly, "failed-only", false, "Show only failed bots")

	return cmd
}