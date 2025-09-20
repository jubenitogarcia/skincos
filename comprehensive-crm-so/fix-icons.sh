#!/bin/bash
# Script to fix phosphor icon naming issues

# Common incorrect icon names and their correct replacements
declare -A icon_replacements=(
    ["Sparkles"]="Sparkle"
    ["TrendingUp"]="TrendUp"
    ["TrendingDown"]="TrendDown"
    ["MagnifyingGlass"]="MagnifyingGlass"
    ["BellRinging"]="Bell"
    ["ChartLineUp"]="ChartLineUp"
    ["ChartPieSlice"]="ChartPie" 
    ["CalendarCheck"]="CalendarCheck"
    ["WhatsappLogo"]="WhatsappLogo"
    ["InstagramLogo"]="InstagramLogo"
    ["EnvelopeSimple"]="Envelope"
    ["BellRinging"]="Bell"
    ["FlowArrow"]="ArrowsClockwise"
    ["UsersFour"]="Users"
    ["ShoppingCart"]="ShoppingCart"
    ["FolderOpen"]="FolderOpen"
    ["CloudArrowUp"]="CloudArrowUp"
)

echo "Fixing phosphor icon names in the project..."

# Find all TypeScript/React files that import from phosphor-icons
for file in $(find src -name "*.tsx" -o -name "*.ts" | grep -v "node_modules"); do
    if grep -q "from [\"']@phosphor-icons/react[\"']" "$file"; then
        echo "Processing: $file"
        
        # Apply replacements
        for incorrect in "${!icon_replacements[@]}"; do
            correct="${icon_replacements[$incorrect]}"
            # Replace in import statements
            sed -i "s/import.*${incorrect}/& /" "$file" 2>/dev/null || true
            sed -i "s/${incorrect}/${correct}/g" "$file" 2>/dev/null || true
        done
    fi
done

echo "Icon name fixes completed!"