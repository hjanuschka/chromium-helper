# Release Notes - v1.4.1

## 🐛 Bug Fixes

### Fixed Gerrit Authentication Issue
- Resolved critical authentication issue where `gerrit list` command would fail even when `auth status` showed valid authentication
- The problem was that single cookie authentication was insufficient for user-specific queries (e.g., `owner:self`)

## 🔧 Authentication Improvements

### Enhanced Cookie Requirements
- **Updated `auth manual` command** to collect three essential cookies:
  - `SID` - Main session identifier
  - `__Secure-1PSID` - Secure session cookie 1
  - `__Secure-3PSID` - Secure session cookie 2
- All three cookies are now required for full Gerrit functionality

### Better User Experience
- Improved instructions in `auth manual` command:
  - Now recommends using Chrome in incognito mode
  - Clearer steps for finding the required cookies
  - Better guidance on which domain to look for cookies
- Enhanced error messages to clearly indicate when authentication is incomplete
- Updated `auth status` to properly validate user-specific queries

## 🛠 Technical Changes

### API Improvements
- Removed problematic User-Agent headers that were causing 403 errors
- Added proper redirect handling (`redirect: 'manual'`) to detect authentication failures
- Simplified query options to use `O=81` instead of complex `O=5000081` parameter
- Fixed authentication validation to test with `owner:self` queries

## 📝 Migration Guide

### For Users Upgrading from v1.4.0
1. Clear existing authentication: `ch auth logout`
2. Re-authenticate using `ch auth manual`
3. Provide all three required cookies when prompted:
   - SID
   - __Secure-1PSID
   - __Secure-3PSID

### Getting the Required Cookies
1. Open Chrome in **incognito mode**
2. Sign in to https://chromium-review.googlesource.com
3. Open Developer Tools (F12)
4. Navigate to Application > Cookies > chromium-review.googlesource.com
5. Find the three cookies from the `.googlesource.com` domain
6. Run `ch auth manual` and enter the cookie values

## ✅ Verification
After authentication, both commands should work:
- `ch auth status` - Should show "Authentication is valid"
- `ch gerrit list` - Should successfully list your CLs

## 🎉 Result
The fix ensures that the CLI can properly authenticate with Gerrit and retrieve user-specific CLs, including queries with `owner:self` parameter.