#!/bin/bash

# Comprehensive CRM - Clean All Script
# Remove all build artifacts and dependencies

echo "🧹 Limpando monorepo..."

# Remove root dependencies
echo "📦 Limpando dependencies raiz..."
rm -rf node_modules
rm -rf .turbo
rm -f package-lock.json

# Remove package dependencies and build artifacts
echo "📦 Limpando packages..."
find packages -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find packages -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
find packages -name ".turbo" -type d -exec rm -rf {} + 2>/dev/null || true
find packages -name "package-lock.json" -type f -delete 2>/dev/null || true

# Remove apps dependencies and build artifacts
echo "📱 Limpando apps..."
find apps -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find apps -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
find apps -name "build" -type d -exec rm -rf {} + 2>/dev/null || true
find apps -name ".next" -type d -exec rm -rf {} + 2>/dev/null || true

# Remove other build artifacts
echo "🗑️  Removendo outros artifacts..."
rm -rf dist
rm -rf build
rm -rf .vite
rm -rf .cache

echo "✅ Limpeza concluída!"