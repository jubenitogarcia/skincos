# Security Policy

## 🔒 Security Overview

The WhatsApp API Monorepo takes security seriously. This document outlines our security policies, procedures, and best practices for maintaining a secure codebase.

## 🚨 Supported Versions

We actively maintain security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | ✅ Yes             |
| 1.x.x   | ⚠️ Critical fixes only |
| < 1.0   | ❌ No              |

## 🛡️ Security Features

### API Security
- **Rate Limiting**: Token bucket algorithm prevents API abuse
- **CORS Protection**: Configurable cross-origin resource sharing
- **Helmet Integration**: Security headers for HTTP responses
- **Input Validation**: Joi schema validation for all endpoints
- **JWT Authentication**: Secure token-based authentication

### Infrastructure Security
- **Docker Isolation**: Containerized deployment with minimal attack surface
- **SSL/TLS Encryption**: Automatic Let's Encrypt certificates via Traefik
- **Environment Variables**: Secure configuration management
- **Network Segmentation**: Docker networks for service isolation

### Data Protection
- **Encryption at Rest**: Sensitive data encrypted in storage
- **Secure Storage**: WhatsApp session data properly secured
- **Backup Security**: Encrypted backup procedures
- **Access Controls**: Role-based access to sensitive operations

## 🔐 Authentication & Authorization

### API Keys
- Use strong, randomly generated API keys
- Rotate keys regularly (recommended: every 90 days)
- Store keys securely using environment variables
- Never commit keys to version control

### WhatsApp Authentication
- QR code authentication with session persistence
- Secure session storage with encryption
- Automatic session recovery and validation
- Rate-limited authentication attempts

## 🚫 Security Best Practices

### Development
- **Dependency Scanning**: Regular dependency security audits
- **Code Review**: All changes require security review
- **Static Analysis**: ESLint security rules enforcement
- **Secret Management**: Use `.env` files, never hardcode secrets

### Deployment
- **Container Security**: Minimal base images with security updates
- **Network Security**: Firewall rules and network isolation
- **Monitoring**: Security event logging and alerting
- **Updates**: Regular security patches and updates

### Operational
- **Access Control**: Principle of least privilege
- **Logging**: Security events logged for audit
- **Backup Security**: Encrypted backups with secure storage
- **Incident Response**: Documented security incident procedures

## 🔍 Security Configuration

### Environment Variables
```bash
# Required security configuration
NODE_ENV=production
API_KEY=your-secure-api-key
JWT_SECRET=your-jwt-secret
WEBHOOK_SECRET=your-webhook-secret

# Optional security features
RATE_LIMIT_ENABLED=true
CORS_ORIGIN=https://yourdomain.com
SSL_CERT_EMAIL=admin@yourdomain.com
```

### Docker Security
```yaml
# Recommended docker-compose.yml security settings
security_opt:
  - no-new-privileges:true
read_only: true
tmpfs:
  - /tmp
cap_drop:
  - ALL
cap_add:
  - CHOWN
  - SETGID
  - SETUID
```

## 🚨 Reporting Security Vulnerabilities

### How to Report

If you discover a security vulnerability, please follow responsible disclosure:

1. **DO NOT** create a public GitHub issue
2. **DO NOT** discuss the vulnerability publicly
3. **DO** send details to: security@whatsappapimonorepo.com
4. **DO** provide detailed information about the vulnerability

### What to Include

Please include the following information:
- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **24 hours**: Initial response acknowledging receipt
- **72 hours**: Initial assessment and severity classification
- **7 days**: Detailed response with remediation timeline
- **30 days**: Security fix released (for high/critical issues)

## 🔧 Security Tools & Commands

### Security Auditing
```bash
# Run security audit
npm audit

# Fix security issues
npm audit fix

# Check for security vulnerabilities
npm run security:check

# Scan Docker images
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -v $PWD:/root/.cache/ aquasec/trivy image whatsapp-api
```

### Security Testing
```bash
# Run security tests
npm run test:security

# Test API security
./tools/scripts/test.sh security

# Check SSL/TLS configuration
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

## 🛡️ Security Checklist

### Before Deployment
- [ ] All dependencies updated and scanned for vulnerabilities
- [ ] Environment variables properly configured
- [ ] SSL/TLS certificates configured
- [ ] API rate limiting enabled
- [ ] Authentication mechanisms tested
- [ ] Input validation implemented
- [ ] Security headers configured
- [ ] Logging and monitoring setup

### Regular Maintenance
- [ ] Monthly dependency security audits
- [ ] Quarterly access review
- [ ] SSL certificate renewal (automated)
- [ ] Security patch application
- [ ] Backup integrity verification
- [ ] Security incident response testing

## 🔗 Security Resources

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [WhatsApp Business API Security](https://developers.facebook.com/docs/whatsapp/business-management-api/guides/security)

## 📞 Contact

For security-related questions or concerns:
- **Security Email**: security@jubenitogarcia.com  
- **General Issues**: [GitHub Issues](https://github.com/jubenitogarcia/WhatsApp/issues)
- **Security Discussions**: [GitHub Discussions](https://github.com/jubenitogarcia/WhatsApp/discussions)

### Related Documentation
- **[README](README.md)** - Project overview and quick start
- **[Development Guide](DEVELOPMENT.md)** - Development and testing procedures
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute securely

---

*This security policy is reviewed and updated regularly to reflect current best practices and emerging threats.*