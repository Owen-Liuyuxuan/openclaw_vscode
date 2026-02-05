# Building and Distributing the OpenClaw VSCode Extension

This guide explains how to package the OpenClaw VSCode extension as a VSIX file for distribution.

## Prerequisites

- Node.js and npm installed
- VSCode Extension Manager (`vsce`) - we'll install this below

## Building the VSIX Package

### 1. Install the VSCE Tool

The VSCode Extension Manager (vsce) is a command-line tool for packaging, publishing, and managing VSCode extensions.

```bash
npm install -g @vscode/vsce
```

### 2. Prepare Your Extension

Before packaging, ensure your extension is ready:

1. Update `package.json` with correct metadata:
   - Make sure `name`, `displayName`, `description`, `version`, `publisher`, and `repository` fields are set
   - Verify that `engines.vscode` specifies the minimum VSCode version required

2. Build your extension:
   ```bash
   npm run build
   ```

3. Ensure your `.vscodeignore` file is configured to exclude unnecessary files from the package:
   ```
   .vscode/**
   .vscode-test/**
   src/**
   node_modules/**
   .gitignore
   .yarnrc
   webpack.config.js
   .eslintrc.json
   tsconfig.json
   **/*.map
   **/*.ts
   ```

### 3. Package the Extension

Run the packaging command in your extension's root directory:

```bash
vsce package
```

This will create a `.vsix` file in your project root with a name like `openclaw-vscode-0.1.0.vsix` (based on your package.json version).

### 4. Install the Extension Locally

To test the packaged extension:

```bash
code --install-extension openclaw-vscode-0.1.0.vsix
```

Or install it through VSCode UI:
1. Open VSCode
2. Go to Extensions view (Ctrl+Shift+X)
3. Click on the "..." menu at the top
4. Select "Install from VSIX..."
5. Choose your VSIX file

### 5. Publishing to VSCode Marketplace (Optional)

If you want to publish your extension to the VSCode Marketplace:

1. Create a publisher account on https://marketplace.visualstudio.com/
2. Get a Personal Access Token (PAT) from Azure DevOps
3. Login with vsce:
   ```bash
   vsce login <publisher-name>
   ```
4. Publish your extension:
   ```bash
   vsce publish
   ```

## Troubleshooting

### Common Issues

1. **Missing Publisher ID**:
   - Error: "Missing publisher ID"
   - Fix: Add a `publisher` field to your package.json

2. **Missing Repository**:
   - Error: "A repository field is required"
   - Fix: Add a `repository` field to your package.json

3. **Package Size Too Large**:
   - Error: "Extension pack size exceeds the size limit"
   - Fix: Use `.vscodeignore` to exclude unnecessary files

4. **Version Already Exists**:
   - Error: "This version already exists"
   - Fix: Update the version in package.json

## Automating the Build Process

You can add a script to your package.json for easier packaging:

```json
"scripts": {
  "build": "node build.js",
  "package": "vsce package",
  "publish": "vsce publish"
}
```

Then simply run:

```bash
npm run package
```

## Additional Resources

- [VSCode Extension Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VSCE Documentation](https://github.com/microsoft/vscode-vsce)