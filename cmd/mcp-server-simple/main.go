package main

import (
	"context"
	"log"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	server := mcp.NewServer(&mcp.Implementation{
		Name: "chromium-codesearch-mcp",
	}, &mcp.ServerOptions{
		Instructions: "Search and explore the Chromium codebase",
	})

	// Add a simple test tool
	type TestArgs struct {
		Message string `json:"message" mcp:"test message"`
	}

	mcp.AddTool(server, &mcp.Tool{
		Name:        "test",
		Description: "Test tool",
	}, func(ctx context.Context, ss *mcp.ServerSession, params *mcp.CallToolParamsFor[TestArgs]) (*mcp.CallToolResultFor[struct{}], error) {
		return &mcp.CallToolResultFor[struct{}]{
			Content: []mcp.Content{
				&mcp.TextContent{Text: "Received: " + params.Arguments.Message},
			},
		}, nil
	})

	transport := mcp.NewLoggingTransport(mcp.NewStdioTransport(), os.Stderr)
	
	if err := server.Run(context.Background(), transport); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}