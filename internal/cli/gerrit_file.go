package cli

import (
	"github.com/hjanuschka/chromium-helper/internal/api"
	"github.com/hjanuschka/chromium-helper/internal/formatter"

	"github.com/spf13/cobra"
)

func NewGerritFileCmd(gerritClient *api.GerritClient) *cobra.Command {
	var patchset int

	cmd := &cobra.Command{
		Use:   "file <cl> <path>",
		Short: "Get file content from CL patchset",
		Long: `Get the content of a specific file from a Gerrit CL patchset.

Examples:
  chromium-helper gerrit file 5918248 content/browser/browser_main.cc
  chromium-helper gerrit file 5918248 base/memory/ref_counted.h --patchset 2
  chromium-helper gerrit file https://chromium-review.googlesource.com/c/chromium/src/+/5918248 README.md`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			file, err := gerritClient.GetGerritFile(args[0], args[1], patchset)
			if err != nil {
				return err
			}

			formatter.PrintGerritFile(file)

			return nil
		},
	}

	cmd.Flags().IntVarP(&patchset, "patchset", "p", 0, "Specific patchset number (default: latest)")

	return cmd
}