#!/bin/bash

# Validation script for monorepo setup
echo "🔍 Validating Monorepo Setup..."
echo "================================"

# Check directory structure
echo "📁 Checking directory structure..."
for dir in apps packages tools docs; do
    if [ -d "$dir" ]; then
        echo "✅ $dir/ exists"
    else
        echo "❌ $dir/ missing"
    fi
done

# Check for configuration files
echo ""
echo "⚙️ Checking configuration files..."
for file in pnpm-workspace.yaml turbo.json .editorconfig; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
    fi
done

# Check apps structure
echo ""
echo "📱 Checking apps structure..."
if [ -d "apps/whatsapp-api" ]; then
    echo "✅ WhatsApp API app exists"
    if [ -f "apps/whatsapp-api/package.json" ]; then
        echo "✅ WhatsApp API package.json exists"
    else
        echo "❌ WhatsApp API package.json missing"
    fi
    if [ -f "apps/whatsapp-api/Dockerfile" ]; then
        echo "✅ WhatsApp API Dockerfile exists"
    else
        echo "❌ WhatsApp API Dockerfile missing"
    fi
else
    echo "❌ WhatsApp API app missing"
fi

# Check packages structure
echo ""
echo "📦 Checking packages structure..."
for pkg in shared-utils shared-types; do
    if [ -d "packages/$pkg" ]; then
        echo "✅ $pkg package exists"
    else
        echo "❌ $pkg package missing"
    fi
done

# Check tools structure  
echo ""
echo "🔧 Checking tools structure..."
if [ -d "tools/configs" ]; then
    echo "✅ tools/configs exists"
    for config in .eslintrc.cjs .prettierrc tsconfig.base.json; do
        if [ -f "tools/configs/$config" ]; then
            echo "✅ $config exists"
        else
            echo "❌ $config missing"
        fi
    done
else
    echo "❌ tools/configs missing"
fi

# Check GitHub workflows
echo ""
echo "🚀 Checking GitHub workflows..."
if [ -d ".github/workflows" ]; then
    echo "✅ GitHub workflows directory exists"
    for workflow in lint.yml release.yml; do
        if [ -f ".github/workflows/$workflow" ]; then
            echo "✅ $workflow exists"
        else
            echo "❌ $workflow missing"
        fi
    done
else
    echo "❌ GitHub workflows missing"
fi

# Check Docker setup
echo ""
echo "🐳 Checking Docker setup..."
if [ -f "docker-compose.monorepo.yml" ]; then
    echo "✅ Monorepo docker-compose exists"
else
    echo "❌ Monorepo docker-compose missing"
fi

# Count redundant files
echo ""
echo "📊 Analyzing redundancies..."
echo "Dockerfiles in root: $(ls -1 Dockerfile* 2>/dev/null | wc -l)"
echo "Shell scripts in root: $(ls -1 *.sh 2>/dev/null | wc -l)"
echo "JS files in root: $(ls -1 *.js 2>/dev/null | wc -l)"
echo "Docker compose files: $(ls -1 docker-compose*.yml 2>/dev/null | wc -l)"

echo ""
echo "✨ Validation complete!"