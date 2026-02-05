#!/bin/bash
# One-click installer for OpenClaw VSCode Extension
# Usage: curl -s https://raw.githubusercontent.com/Owen-Liuyuxuan/openclaw_vscode/main/install.sh | bash

set -e

echo "🐏 OpenClaw VSCode Extension Installer"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if VSCode is installed
if ! command -v code &> /dev/null; then
    echo -e "${RED}❌ VSCode 'code' command not found.${NC}"
    echo "Please install VSCode first: https://code.visualstudio.com/"
    exit 1
fi

echo -e "${GREEN}✓ VSCode is installed${NC}"

# Get latest release URL
REPO="Owen-Liuyuxuan/openclaw_vscode"
echo -e "${YELLOW}📡 Checking for latest release...${NC}"

# Try to get latest release
LATEST_URL="https://github.com/$REPO/releases/latest/download/openclaw-vscode.vsix"
VSIX_FILE="/tmp/openclaw-$(date +%s).vsix"

echo -e "${YELLOW}📥 Downloading extension...${NC}"
if curl -s -L -o "$VSIX_FILE" "$LATEST_URL"; then
    echo -e "${GREEN}✓ Downloaded successfully${NC}"
else
    echo -e "${YELLOW}⚠️ Could not download from releases, trying to build from source...${NC}"
    
    # Clone and build locally
    BUILD_DIR="/tmp/openclaw-build-$(date +%s)"
    git clone --depth 1 "https://github.com/$REPO.git" "$BUILD_DIR"
    cd "$BUILD_DIR"
    
    if npm install && npm run build && npx @vscode/vsce package; then
        VSIX_FILE=$(ls *.vsix | head -1)
        echo -e "${GREEN}✓ Built successfully${NC}"
    else
        echo -e "${RED}❌ Build failed${NC}"
        exit 1
    fi
fi

# Install the extension
echo -e "${YELLOW}🔧 Installing extension...${NC}"
if code --install-extension "$VSIX_FILE" --force; then
    echo -e "${GREEN}✅ Installation complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Restart VSCode"
    echo "2. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)"
    echo "3. Run: 'OpenClaw: Open Chat'"
    echo ""
    echo "The OpenClaw icon should appear in your activity bar (left side)."
else
    echo -e "${RED}❌ Installation failed${NC}"
    echo "You can try manual installation:"
    echo "1. Download from: https://github.com/$REPO/releases"
    echo "2. In VSCode: View → Command Palette → 'Extensions: Install from VSIX'"
    exit 1
fi

# Cleanup
rm -f "$VSIX_FILE"
if [ -d "$BUILD_DIR" ]; then
    rm -rf "$BUILD_DIR"
fi