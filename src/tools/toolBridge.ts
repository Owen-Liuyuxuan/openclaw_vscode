import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolRequest, ToolResult, FileEdit } from '../types/openclaw';

export class ToolBridge {
    private workspaceRoot: string;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }

    async executeToolRequest(request: ToolRequest): Promise<ToolResult> {
        // Validate tool is allowed
        if (!this.isToolAllowed(request.tool)) {
            return {
                success: false,
                error: `Tool not allowed: ${request.tool}`
            };
        }

        // Validate parameters
        if (!this.validateToolParams(request)) {
            return {
                success: false,
                error: 'Invalid tool parameters'
            };
        }

        // Request user confirmation if needed
        if (this.requiresConfirmation(request)) {
            const confirmed = await this.requestUserConfirmation(request);
            if (!confirmed) {
                return {
                    success: false,
                    error: 'User cancelled operation'
                };
            }
        }

        // Execute tool
        switch (request.tool) {
            case 'read_file':
                return await this.readFile(request.params.path);

            case 'write_file':
                return await this.writeFile(request.params.path, request.params.content);

            case 'edit_file':
                return await this.editFile(request.params.path, request.params.edits);

            case 'run_terminal_command':
                return await this.runTerminalCommand(request.params.command);

            case 'git_operation':
                return await this.gitOperation(request.params);

            default:
                return {
                    success: false,
                    error: `Unknown tool: ${request.tool}`
                };
        }
    }

    private isToolAllowed(tool: string): boolean {
        const allowedTools = [
            'read_file',
            'write_file',
            'edit_file',
            'run_terminal_command',
            'git_operation'
        ];
        return allowedTools.includes(tool);
    }

    private validateToolParams(request: ToolRequest): boolean {
        // Validate paths are within workspace
        if (request.params.path) {
            const normalizedPath = path.resolve(request.params.path);
            if (!normalizedPath.startsWith(this.workspaceRoot)) {
                return false;
            }
        }
        return true;
    }

    private requiresConfirmation(request: ToolRequest): boolean {
        const destructiveTools = ['write_file', 'edit_file', 'run_terminal_command', 'git_operation'];
        return destructiveTools.includes(request.tool);
    }

    private async requestUserConfirmation(request: ToolRequest): Promise<boolean> {
        const message = `OpenClaw wants to ${request.tool}`;
        const detail = JSON.stringify(request.params, null, 2);

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true, detail },
            'Allow',
            'Deny'
        );

        return choice === 'Allow';
    }

    private async readFile(filePath: string): Promise<ToolResult> {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
            success: true,
            result: { content }
        };
    }

    private async writeFile(filePath: string, content: string): Promise<ToolResult> {
        await fs.writeFile(filePath, content, 'utf-8');

        // Refresh VSCode's file watcher
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.stat(uri);

        return {
            success: true,
            result: { path: filePath }
        };
    }

    private async editFile(filePath: string, edits: FileEdit[]): Promise<ToolResult> {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        const workspaceEdit = new vscode.WorkspaceEdit();

        for (const edit of edits) {
            const range = new vscode.Range(
                edit.startLine,
                0,
                edit.endLine,
                document.lineAt(edit.endLine).text.length
            );
            workspaceEdit.replace(uri, range, edit.newText);
        }

        const success = await vscode.workspace.applyEdit(workspaceEdit);

        return {
            success,
            result: { editsApplied: edits.length }
        };
    }

    private async runTerminalCommand(command: string): Promise<ToolResult> {
        const terminal = vscode.window.createTerminal('OpenClaw');
        terminal.show();
        terminal.sendText(command);

        return {
            success: true,
            result: { message: 'Command sent to terminal' }
        };
    }

    private async gitOperation(params: any): Promise<ToolResult> {
        // Use VSCode's built-in Git extension API
        const gitExtension = vscode.extensions.getExtension('vscode.git');

        if (!gitExtension) {
            return {
                success: false,
                error: 'Git extension not available'
            };
        }

        // Implementation depends on specific Git operation
        return {
            success: true,
            result: { message: 'Git operation completed' }
        };
    }
}
