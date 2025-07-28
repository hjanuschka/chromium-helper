import chalk from 'chalk';
import { execSync } from 'child_process';
import { AuthManager } from './auth.js';

export async function showCookieHelp(): Promise<void> {
  console.log(chalk.bold.cyan('\n🍪 How to Get Your Gerrit Authentication Cookies\n'));
  
  console.log(chalk.yellow('Method 1: Interactive Manual Setup (Recommended)'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log('Run: ' + chalk.green('ch auth manual'));
  console.log('This will guide you through extracting and saving cookies interactively.\n');
  
  console.log(chalk.yellow('Method 2: Automated Browser Login'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log('Run: ' + chalk.green('ch auth login'));
  console.log('This will open a browser for automatic sign-in.');
  console.log(chalk.red('Note: May be blocked by Google security checks.\n'));
  
  console.log(chalk.yellow('Method 3: Manual Cookie Extraction'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log('1. Open Chrome/Edge and sign in to: ' + chalk.blue('https://chromium-review.googlesource.com'));
  console.log('2. Open Developer Tools (F12)');
  console.log('3. Go to the ' + chalk.bold('Application') + ' tab');
  console.log('4. In the left sidebar, expand ' + chalk.bold('Cookies') + ' > ' + chalk.bold('https://chromium-review.googlesource.com'));
  console.log('5. Look for ONE of these cookies:');
  console.log(chalk.green('   - __Secure-1PSID (recommended)'));
  console.log(chalk.green('   - __Secure-3PSID (alternative)'));
  console.log('6. Copy the cookie value');
  console.log('7. Use with --auth-cookie or run ' + chalk.green('ch auth manual') + ' to save it\n');
  
  console.log(chalk.yellow('Method 4: Browser Extension Helper'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log('Install a cookie export extension like:');
  console.log('- ' + chalk.blue('EditThisCookie') + ' (Chrome/Edge)');
  console.log('- ' + chalk.blue('Cookie Quick Manager') + ' (Firefox)');
  console.log('Then export cookies for chromium-review.googlesource.com\n');
}

export async function setupCookieScript(): Promise<void> {
  const authManager = new AuthManager();
  
  console.log(chalk.cyan('\n📝 Creating cookie extraction helper...\n'));
  
  const script = `#!/bin/bash
# Gerrit Cookie Extractor
# This script helps you get cookies from Chrome

echo "🍪 Gerrit Cookie Extractor"
echo "========================="
echo ""
echo "This script will help you extract authentication cookies from Chrome."
echo "Make sure you're signed in to https://chromium-review.googlesource.com"
echo ""
read -p "Press Enter to open Gerrit in your browser..."

# Open Gerrit
open https://chromium-review.googlesource.com || xdg-open https://chromium-review.googlesource.com

echo ""
echo "Please sign in if you haven't already, then:"
echo "1. Open Developer Tools (F12)"
echo "2. Go to Application tab > Cookies"
echo "3. Find the cookies for chromium-review.googlesource.com"
echo ""
echo "Enter the cookie values below (or press Ctrl+C to cancel):"
echo ""

read -p "SID value: " sid
read -p "__Secure-1PSID value: " psid1
read -p "__Secure-3PSID value: " psid3

if [ -z "$sid" ] || [ -z "$psid1" ] || [ -z "$psid3" ]; then
    echo "❌ Error: All cookie values are required"
    exit 1
fi

# Combine cookies
cookies="SID=$sid; __Secure-1PSID=$psid1; __Secure-3PSID=$psid3"

# Save to file
echo "$cookies" > ~/.gerrit-cookie
chmod 600 ~/.gerrit-cookie

echo ""
echo "✅ Cookies saved to ~/.gerrit-cookie"
echo "You can now use 'ch gerrit list' without --auth-cookie!"
`;

  const scriptPath = '/tmp/gerrit-cookie-helper.sh';
  await import('fs').then(fs => fs.promises.writeFile(scriptPath, script, { mode: 0o755 }));
  
  console.log(chalk.green('✓ Created helper script at: ' + scriptPath));
  console.log(chalk.gray('\nYou can run it with: bash ' + scriptPath));
  console.log(chalk.gray('Or make it executable: chmod +x ' + scriptPath + ' && ' + scriptPath));
}