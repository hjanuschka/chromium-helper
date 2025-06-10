# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please follow these steps:

1. **Do NOT open a public issue** for security vulnerabilities
2. **Email the maintainers** directly with details
3. **Allow time for assessment** - we aim to respond within 48 hours
4. **Coordinate disclosure** - we'll work with you on timing

### What to Include

Please include the following information in your report:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Suggested fixes (if any)
- Your contact information

### Response Timeline

- **Initial Response**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix Development**: Depends on severity
- **Public Disclosure**: After fix is released

## Security Considerations

### API Key Security

This project uses Google's public CodeSearch API key that is:
- **Publicly available** in the browser at source.chromium.org
- **Read-only access** to public Chromium source code
- **Rate-limited** by Google's infrastructure
- **Not a secret** - it's intentionally public

Users can override this with their own API key using the `CHROMIUM_SEARCH_API_KEY` environment variable.

### Data Privacy

- **No personal data collection**: This tool only accesses public Chromium source code
- **Local execution**: All processing happens locally on your machine
- **No data transmission**: No user data is sent to third parties beyond Google's public APIs
- **Logging**: Structured logs are written to stderr only and contain no sensitive information

### Network Security

- **HTTPS only**: All API requests use HTTPS
- **Public APIs only**: Only accesses publicly available Google APIs
- **No authentication**: No credentials or personal tokens are required or stored

## Best Practices for Users

1. **Review code** before running from source
2. **Use environment variables** for any custom API keys
3. **Keep dependencies updated** with `npm audit`
4. **Report issues** through proper channels

## Dependency Security

We regularly monitor and update dependencies for security vulnerabilities:

- Run `npm audit` to check for known vulnerabilities
- Dependencies are kept minimal for reduced attack surface
- Regular security updates are applied

Thank you for helping keep this project secure! 🔒