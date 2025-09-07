import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

export class AuthManager {
  private cookieFile: string;

  constructor() {
    // Store cookies in user's home directory
    this.cookieFile = path.join(os.homedir(), '.gerrit-cookie');
  }

  async authenticate(options: { headless?: boolean } = {}): Promise<string> {
    console.log(chalk.cyan('🔐 Starting Gerrit authentication...'));
    console.log(chalk.gray('This will open Chrome for you to sign in to Gerrit.'));
    
    // Try to use the user's actual Chrome browser instead of Playwright's Chromium
    const browser = await chromium.launch({
      headless: false, // Always use headed mode for auth
      channel: 'chrome', // Use real Chrome
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox'
      ]
    });
    
    try {
      const context = await browser.newContext({
        // Use a more complete user agent
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        // Don't indicate automation
        bypassCSP: true
      });
      
      const page = await context.newPage();
      
      console.log(chalk.yellow('\n📋 Please sign in to your Google account in the browser window...'));
      console.log(chalk.gray('Waiting for you to complete sign-in...'));
      console.log(chalk.yellow('\n⚠️  If you see a security warning about the browser:'));
      console.log(chalk.gray('1. Use "ch auth manual" for manual cookie setup instead'));
      console.log(chalk.gray('2. Or try signing in anyway - sometimes it works after a few attempts'));
      
      // Navigate to Gerrit
      await page.goto('https://chromium-review.googlesource.com');
      
      // Wait for authentication - poll for cookies
      let authCookie: any = null;
      let attempts = 0;
      const maxAttempts = 60; // 60 seconds timeout
      
      while (attempts < maxAttempts) {
        await page.waitForTimeout(1000); // Wait 1 second between checks
        
        // Get all cookies
        const cookies = await context.cookies();
        
        // Look for key authentication cookies (need both!)
        const psid1Cookie = cookies.find(cookie => cookie.name === '__Secure-1PSID');
        const psid3Cookie = cookies.find(cookie => cookie.name === '__Secure-3PSID');
        
        // If we have both key cookies, we're authenticated
        if (psid1Cookie && psid3Cookie) {
          authCookie = psid1Cookie; // We'll construct the full cookie string below
          console.log(chalk.green('\n✓ Authentication detected!'));
          break;
        }
        
        attempts++;
      }
      
      if (!authCookie) {
        // Get all cookies for debugging
        const allCookies = await context.cookies();
        console.log(chalk.red('\nAvailable cookies:'));
        allCookies.forEach(cookie => {
          console.log(chalk.gray(`  - ${cookie.name}`));
        });
        
        throw new Error('Authentication timeout. Could not find required cookies (__Secure-1PSID and __Secure-3PSID).');
      }
      
      // Get both cookies and construct the full cookie string
      const cookies = await context.cookies();
      const psid1Cookie = cookies.find(cookie => cookie.name === '__Secure-1PSID');
      const psid3Cookie = cookies.find(cookie => cookie.name === '__Secure-3PSID');
      
      let cookieString = '';
      if (psid1Cookie && psid3Cookie) {
        cookieString = `__Secure-1PSID=${psid1Cookie.value}; __Secure-3PSID=${psid3Cookie.value}`;
      } else {
        throw new Error('Could not find both required cookies');
      }
      
      // Save to file
      await this.saveCookies(cookieString);
      
      console.log(chalk.green(`\n✅ Authentication successful! Cookies saved to ${this.cookieFile}`));
      console.log(chalk.gray('You can now use gerrit list commands without --auth-cookie parameter'));
      
      return cookieString;
      
    } finally {
      await browser.close();
    }
  }

  async getCookies(): Promise<string | null> {
    try {
      const cookies = await fs.readFile(this.cookieFile, 'utf-8');
      return cookies.trim();
    } catch (error) {
      return null;
    }
  }

  async saveCookies(cookies: string): Promise<void> {
    await fs.writeFile(this.cookieFile, cookies, { mode: 0o600 }); // Secure permissions
  }

  async clearCookies(): Promise<void> {
    try {
      await fs.unlink(this.cookieFile);
      console.log(chalk.yellow('🗑️  Cleared saved authentication'));
    } catch (error) {
      // File doesn't exist, that's fine
    }
  }

  async checkAuth(): Promise<boolean> {
    const cookies = await this.getCookies();
    if (!cookies) {
      return false;
    }

    // Test if cookies are still valid by trying a query with owner:self
    // This ensures the authentication works for user-specific queries
    try {
      const response = await fetch('https://chromium-review.googlesource.com/changes/?q=owner:self&n=1', {
        headers: {
          'Cookie': cookies,
          'Accept': 'application/json',
        }
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Helper function to get cookies with fallback
export async function getAuthCookies(providedCookie?: string): Promise<string> {
  // If cookie is provided via parameter, use it
  if (providedCookie) {
    return providedCookie;
  }

  // Otherwise, try to load from saved file
  const authManager = new AuthManager();
  const savedCookies = await authManager.getCookies();
  
  if (savedCookies) {
    // Verify they're still valid
    const isValid = await authManager.checkAuth();
    if (isValid) {
      return savedCookies;
    }
    console.log(chalk.yellow('⚠️  Saved authentication has expired'));
  }

  throw new Error(
    'No authentication found. Please run:\n' +
    chalk.cyan('  ch auth manual') + ' (recommended - requires both __Secure-1PSID and __Secure-3PSID)\n' +
    chalk.cyan('  ch auth login') + ' (may be blocked by Google)\n' +
    'Or provide cookies with --auth-cookie parameter'
  );
}