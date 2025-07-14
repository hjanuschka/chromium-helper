#!/bin/bash

# Test script to compare Go and JS CLI outputs

echo "Testing search command..."
./go-chromium-helper search "test" > go_search_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js search "test" > js_search_output.txt 2>/dev/null
diff go_search_output.txt js_search_output.txt

echo "Testing file command..."
./go-chromium-helper file "DEPS" > go_file_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js file "DEPS" > js_file_output.txt 2>/dev/null
diff go_file_output.txt js_file_output.txt

echo "Testing symbol command..."
./go-chromium-helper symbol "main" > go_symbol_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js symbol "main" > js_symbol_output.txt 2>/dev/null
diff go_symbol_output.txt js_symbol_output.txt

echo "Testing gerrit status command..."
# Using a recent, valid CL
./go-chromium-helper gerrit status 5918248 > go_gerrit_status_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js gerrit status 5918248 > js_gerrit_status_output.txt 2>/dev/null
diff go_gerrit_status_output.txt js_gerrit_status_output.txt

echo "Testing commits command..."
./go-chromium-helper commits "test" > go_commits_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js commits "test" > js_commits_output.txt 2>/dev/null
diff go_commits_output.txt js_commits_output.txt

echo "Testing owners command..."
./go-chromium-helper owners "DEPS" > go_owners_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js owners "DEPS" > js_owners_output.txt 2>/dev/null
diff go_owners_output.txt js_owners_output.txt

echo "Testing issue command..."
./go-chromium-helper issue 392931073 > go_issue_output.txt 2>/dev/null
node chromium-helper-cli/dist/index.js issue 392931073 > js_issue_output.txt 2>/dev/null
diff go_issue_output.txt js_issue_output.txt

# PDFium is Go-only, so no comparison
