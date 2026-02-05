#!/bin/bash

# OpenClaw VSCode Extension - Quick Start Guide

echo "🤖 OpenClaw VSCode Extension - Quick Start"
echo "=========================================="
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Build the extension
echo ""
echo "🔨 Building extension..."
npm run build

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Ensure OpenClaw Gateway is running on ws://127.0.0.1:18789"
    echo "   2. Press F5 in VSCode to launch the Extension Development Host"
    echo "   3. In the new window, use Command Palette → 'OpenClaw: Open Chat'"
    echo "   4. Or press Ctrl+Shift+O to send current file context"
    echo ""
    echo "📚 For more information, see README.md"
else
    echo ""
    echo "❌ Build failed. Please check the error messages above."
    exit 1
fi
