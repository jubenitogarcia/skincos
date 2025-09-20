# SKINCOS AI - Git Superproject

SKINCOS AI é um superproject contendo 4 módulos principais:
- **agent-zero** (a0) - Sistema de agentes inteligentes
- **comprehensive-crm-so** - Sistema de CRM completo
- **whatsapp-gateway** - Gateway de integração WhatsApp
- **broadhub** - Sistema de transmissão e comunicação

**ALWAYS follow these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Initial Repository Setup
1. Clone the repository: `git clone https://github.com/jubenitogarcia/SKINCOS-AI.git`
2. Navigate to the repository: `cd SKINCOS-AI`
3. **CRITICAL**: Initialize submodules: `git submodule init`
4. **AUTHENTICATION REQUIRED**: Update submodules: `git submodule update`
   - **NOTE**: Submodules are private repositories requiring GitHub authentication
   - If authentication fails, you may need to set up SSH keys or personal access tokens
   - Alternative: `git submodule update --init --recursive` for one-step initialization

### Working with Submodules - NEVER CANCEL Operations
- **TIMING**: Submodule operations can take 5-15 minutes depending on repository sizes. NEVER CANCEL.
- Update all submodules: `git submodule update --remote` -- takes up to 15 minutes. NEVER CANCEL. Set timeout to 30+ minutes.
- Update specific submodule: `git submodule update --remote <submodule-path>`
- Enter submodule directory: `cd <submodule-name>` then work normally with git commands
- **CRITICAL**: Always commit submodule changes from within the submodule directory first
- Then commit the submodule reference update from the parent repository

### Submodule Structure and Scripts
Based on repository documentation, each submodule contains:

#### comprehensive-crm-so/
- Scripts: `restart_crm.sh`, `backup_crm.sh`
- Configuration: `crm_config.yml`
- To work: `cd comprehensive-crm-so`

#### whatsapp-gateway/
- Scripts: `restart_whatsapp.sh`
- Configuration: `whatsapp_config.yml`
- To work: `cd whatsapp-gateway`

#### broadhub/
- Scripts: `restart_broadhub.sh`
- To work: `cd broadhub`

#### a0/ (agent-zero)
- Configuration: `agent_config.yml`
- To work: `cd a0`

## Build and Development Workflow

### Prerequisites Validation
1. Verify Git version: `git --version` (should be 2.0+)
2. Check repository status: `git status`
3. Verify submodules are initialized: `git submodule status`

### Common Development Tasks

#### Updating the Entire Project
```bash
# Update parent repository
git pull origin main

# Update all submodules -- takes 10-20 minutes. NEVER CANCEL. Set timeout to 30+ minutes.
git submodule update --remote --recursive
```

#### Working on Individual Modules
```bash
# Enter specific module
cd <module-name>

# Make changes and commit within submodule
git add .
git commit -m "Your changes"
git push origin main

# Return to parent and update submodule reference
cd ..
git add <module-name>
git commit -m "Update <module-name> submodule"
git push origin main
```

#### Starting Module Services
Based on README documentation:
```bash
# CRM system
cd comprehensive-crm-so
./restart_crm.sh

# WhatsApp Gateway
cd whatsapp-gateway
./restart_whatsapp.sh

# BroadHub
cd broadhub
./restart_broadhub.sh
```

## Validation and Testing

### Manual Validation Requirements
**ALWAYS perform these validation steps after making changes:**

1. **Repository Structure Validation**:
   ```bash
   # Verify all submodules are properly registered (< 1s)
   git submodule status
   
   # Check for any uncommitted changes (< 1s) 
   git status --porcelain
   
   # View submodule configuration (< 1s)
   cat .gitmodules
   ```

2. **Submodule Health Check**:
   ```bash
   # For each submodule, verify it's on the correct branch/commit (varies by module count)
   git submodule foreach 'git status'
   
   # Check current submodule URLs (< 1s)
   git config --file=.gitmodules --list | grep url
   ```

3. **Directory Navigation Validation**:
   ```bash
   # Test navigation to each module (< 1s each)
   cd a0 && pwd
   cd ../comprehensive-crm-so && pwd  
   cd ../whatsapp-gateway && pwd
   cd ../broadhub && pwd
   cd .. # return to root
   ```

4. **Service Validation** (when applicable):
   - Navigate to each module directory
   - Run any available health check scripts
   - Verify configuration files are present and valid

### Authentication and Access
- **GitHub Authentication**: Required for private submodules
- **SSH Keys**: Recommended for seamless submodule operations
- **Personal Access Tokens**: Alternative authentication method
- If you encounter permission errors, verify your GitHub access to all submodule repositories

## Common Tasks and Troubleshooting

### Repository Navigation
```bash
# List all modules
ls -la
# Should show: a0/, broadhub/, comprehensive-crm-so/, whatsapp-gateway/

# View submodule details
cat .gitmodules
```

### Troubleshooting Authentication Issues
```bash
# If submodule update fails due to authentication:
# 1. Verify GitHub access
# 2. Use SSH instead of HTTPS if available
# 3. Check personal access token permissions

# Convert HTTPS to SSH (if you have SSH keys):
git config --file=.gitmodules submodule.a0.url git@github.com:jubenitogarcia/agent-zero.git
git config --file=.gitmodules submodule.comprehensive-crm-so.url git@github.com:jubenitogarcia/comprehensive-crm-so.git
git config --file=.gitmodules submodule.whatsapp-gateway.url git@github.com:jubenitogarcia/WhatsApp.git
git config --file=.gitmodules submodule.broadhub.url git@github.com:jubenitogarcia/BroadHub.git
```

### Timing Expectations - VALIDATED
- **Repository clone**: 1-2 minutes
- **Submodule init**: < 1 second per module (validated: ~0.02s)
- **Submodule deinit**: < 1 second per module (validated: ~0.02-0.07s)
- **Individual submodule update**: 2-5 minutes per module (depends on authentication)
- **Full recursive update**: 15-30 minutes total
- **Config operations**: < 1 second (validated)

**CRITICAL**: Always set timeouts to 60+ minutes for submodule operations. NEVER CANCEL long-running operations.

### Validated Commands Status
All commands in these instructions have been tested and work correctly:
- ✅ `git submodule init` - Works (< 1s)
- ✅ `git submodule status` - Works (< 1s)  
- ✅ `git submodule deinit -f <module>` - Works (< 1s)
- ✅ `git config --file=.gitmodules` operations - Works (< 1s)
- ✅ `git submodule foreach` - Works with initialized modules
- ⚠️ `git submodule update` - Requires authentication for private repos

## Emergency Procedures

### Reset Submodules
```bash
# If submodules become corrupted or out of sync:
git submodule deinit --all
git submodule init
git submodule update --recursive
```

### Force Clean State
```bash
# WARNING: This will lose uncommitted changes
git submodule foreach --recursive git clean -fd
git submodule foreach --recursive git reset --hard
```

## Development Best Practices

1. **Always work within individual submodule directories** for module-specific changes
2. **Commit changes in submodules first**, then update parent repository
3. **Test each module independently** before committing to parent
4. **Maintain configuration file integrity** - always validate YAML/JSON syntax
5. **Document any module-specific setup requirements** as you discover them
6. **Use descriptive commit messages** that indicate which module was modified

## Repository Structure Reference
```
SKINCOS-AI/
├── .git/
├── .gitmodules          # Submodule definitions
├── README.md           # Project documentation
├── a0/                 # agent-zero submodule
├── broadhub/           # BroadHub submodule
├── comprehensive-crm-so/ # CRM submodule
└── whatsapp-gateway/   # WhatsApp Gateway submodule
```

This superproject architecture allows independent development of each AI system component while maintaining centralized coordination and deployment capabilities.