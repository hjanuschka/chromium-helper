package cli

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

func NewAIGuideCommand() *cobra.Command {
	return &cobra.Command{
		Use:     "ai",
		Aliases: []string{"--ai"},
		Short:   "Show AI assistant usage guide",
		Long:    `Display a comprehensive guide for using chromium-helper with AI assistants.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			printAIGuide()
			return nil
		},
	}
}

func printAIGuide() {
	headerColor := color.New(color.FgMagenta, color.Bold)
	sectionColor := color.New(color.FgCyan, color.Bold)
	codeColor := color.New(color.FgGreen)
	
	fmt.Println()
	headerColor.Println("🤖 AI Assistant Integration Guide")
	fmt.Println()
	
	fmt.Println("This tool is designed to work seamlessly with AI assistants like Claude, ChatGPT, and Copilot.")
	fmt.Println("The structured output helps AI assistants understand and process Chromium source code effectively.")
	fmt.Println()
	
	sectionColor.Println("📋 Quick Start for AI Assistants")
	fmt.Println()
	fmt.Println("When helping users navigate Chromium source code, use these commands:")
	fmt.Println()
	
	// Search examples
	sectionColor.Println("1. Code Search")
	fmt.Println("   Find specific patterns, functions, or text in the codebase:")
	codeColor.Println("   chromium-helper search \"LOG(INFO)\"")
	codeColor.Println("   chromium-helper search \"class Browser\" --file=\"*.h\"")
	codeColor.Println("   chromium-helper search \"RenderFrameHost::\" --limit=50")
	fmt.Println()
	
	// Symbol search examples
	sectionColor.Println("2. Symbol Search")
	fmt.Println("   Locate symbol definitions and references:")
	codeColor.Println("   chromium-helper symbol Browser::Create")
	codeColor.Println("   chromium-helper symbol NavigationController --type=definition")
	fmt.Println()
	
	// File operations
	sectionColor.Println("3. File Operations")
	fmt.Println("   Read specific files or portions of files:")
	codeColor.Println("   chromium-helper file content/browser/browser_main.cc")
	codeColor.Println("   chromium-helper file base/memory/ref_counted.h 50-100")
	fmt.Println()
	
	// List folder
	sectionColor.Println("4. Directory Browsing")
	fmt.Println("   List contents of directories:")
	codeColor.Println("   chromium-helper ls content/browser/")
	codeColor.Println("   chromium-helper list-folder v8/src/")
	fmt.Println()
	
	// Submodule support
	sectionColor.Println("5. Git Submodules")
	fmt.Println("   Seamlessly access V8, WebRTC, and DevTools:")
	codeColor.Println("   chromium-helper file v8/src/api/api.cc")
	codeColor.Println("   chromium-helper ls third_party/webrtc/")
	fmt.Println()
	
	// Output formats
	sectionColor.Println("📊 Output Formats")
	fmt.Println()
	fmt.Println("   --format=table  : Human-readable tables (default)")
	fmt.Println("   --format=plain  : Simple text output")
	fmt.Println("   --format=json   : Structured JSON for parsing")
	fmt.Println()
	
	// Best practices
	sectionColor.Println("💡 Best Practices for AI Assistants")
	fmt.Println()
	fmt.Println("1. Start with search to understand code structure")
	fmt.Println("2. Use symbol search to find implementations")
	fmt.Println("3. Read specific files for detailed analysis")
	fmt.Println("4. Use JSON output for structured data processing")
	fmt.Println("5. Combine multiple queries for comprehensive analysis")
	fmt.Println()
	
	// Example workflow
	sectionColor.Println("🔄 Example Workflow")
	fmt.Println()
	fmt.Println("To understand how navigation works in Chromium:")
	fmt.Println()
	codeColor.Println("1. chromium-helper search \"NavigationController\" --file=\"*.h\" --limit=10")
	fmt.Println("   → Find the main header files")
	fmt.Println()
	codeColor.Println("2. chromium-helper symbol NavigationController::LoadURL")
	fmt.Println("   → Locate the implementation")
	fmt.Println()
	codeColor.Println("3. chromium-helper file content/browser/navigation_controller_impl.cc 100-200")
	fmt.Println("   → Read the specific implementation")
	fmt.Println()
	
	// Integration tips
	sectionColor.Println("🔧 Integration Tips")
	fmt.Println()
	fmt.Println("• Use the tool's structured output to provide accurate code references")
	fmt.Println("• Include file paths and line numbers in your responses")
	fmt.Println("• Leverage JSON output for data analysis and summaries")
	fmt.Println("• Chain commands together for comprehensive code exploration")
	fmt.Println()
	
	headerColor.Println("Happy coding! 🚀")
	fmt.Println()
}