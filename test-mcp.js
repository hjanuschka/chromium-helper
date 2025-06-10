#!/usr/bin/env node

import { spawn } from 'child_process';

function testMCPServer() {
  console.log('Testing Chromium CodeSearch MCP Server...');
  
  const server = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Test the list tools request
  const listToolsRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  };

  let responseData = '';
  
  server.stdout.on('data', (data) => {
    responseData += data.toString();
    console.log('Server response:', data.toString());
  });

  server.stderr.on('data', (data) => {
    console.error('Server error:', data.toString());
  });

  server.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });

  // Send the request
  setTimeout(() => {
    console.log('Sending list tools request...');
    server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    
    // Close after a short delay
    setTimeout(() => {
      server.kill();
      console.log('Test completed');
    }, 2000);
  }, 1000);
}

testMCPServer();