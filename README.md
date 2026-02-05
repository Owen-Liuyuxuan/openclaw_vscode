# OpenClaw VSCode Extension

AI-powered coding assistant integration for OpenClaw. This extension connects VSCode to your local OpenClaw Gateway service via WebSocket.

## Features

- **Chat Interface**: Sidebar chat to communicate with OpenClaw
- **Context Awareness**: Adds a hidden system prompt with workspace path context
- **Markdown Rendering**: Renders assistant responses in Markdown
- **Auto-Reconnection**: Automatically reconnects to Gateway if connection is lost

## Requirements

- OpenClaw Gateway must be running on `ws://127.0.0.1:18789`
- VSCode 1.85.0 or higher

## Installation

### One-click Installation (Recommended)
```bash
curl -s https://raw.githubusercontent.com/Owen-Liuyuxuan/openclaw_vscode/main/install.sh | bash
```

### Manual Installation
1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Press `F5` in VSCode to launch the extension in debug mode

### From VSIX File
1. Download the latest `.vsix` file from [Releases](https://github.com/Owen-Liuyuxuan/openclaw_vscode/releases)
2. In VSCode: View → Command Palette → 'Extensions: Install from VSIX'

## Usage

### Open Chat Panel
- Command Palette: `OpenClaw: Open Chat`
- Or use the command `openclaw.openChat`

### File Context
- **Drag-and-drop** files from VS Code into the chat input to insert full paths.
  - Multiple files are inserted on separate lines.

### Tool Execution
This is currently not exposed in the UI.

## Architecture

```
┌─────────────────────────────────────────┐
│         VSCode Extension                │
│  ┌────────────┐      ┌──────────────┐  │
│  │ Chat UI    │      │ Context      │  │
│  │ (Webview)  │      │ Tracker      │  │
│  └─────┬──────┘      └──────┬───────┘  │
│        │                    │           │
│        └────────┬───────────┘           │
│                 │ WebSocket             │
└─────────────────┼─────────────────────┘
                  │
         ┌────────▼────────┐
         │  Gateway :18789 │  ← OpenClaw Core
         │  (TypeScript)   │
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌────▼────┐   ┌───▼────┐
│ Agent │   │ Skills  │   │ Memory │
│Runner │   │ (Tools) │   │ Store  │
└───────┘   └─────────┘   └────────┘
```

## Project Structure

```
openclaw-vscode/
├── src/
│   ├── extension.ts                 # Entry point
│   ├── gateway/
│   │   └── connection.ts           # WebSocket manager
│   ├── ui/
│   │   └── chatPanel.ts            # Webview panel
│   ├── context/
│   │   └── workspaceTracker.ts     # Context tracking
│   ├── tools/
│   │   └── toolBridge.ts           # Tool execution
│   ├── commands/
│   │   └── sendFilePath.ts         # File path command
│   └── types/
│       └── openclaw.d.ts           # Type definitions
├── package.json
├── tsconfig.json
└── build.js                        # esbuild configuration
```

## Security

- All file operations are validated to be within the workspace
- Destructive operations require user confirmation
- Path traversal attacks are prevented
- No arbitrary code execution

## Development

### Build
```bash
npm run build;
vsce package;
code --install-extension openclaw-vscode-*
```

### Watch Mode
```bash
npm run watch
```

### Debug
Press `F5` in VSCode to launch the Extension Development Host

## License

MIT
