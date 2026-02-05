import * as vscode from 'vscode';
import { GatewayConnection } from '../gateway/connection';

export function registerSendFilePathCommand(
    context: vscode.ExtensionContext,
    gateway: GatewayConnection
): void {
    const command = vscode.commands.registerCommand(
        'openclaw.sendFilePath',
        async () => {
            const editor = vscode.window.activeTextEditor;

            if (!editor) {
                vscode.window.showWarningMessage('No active file');
                return;
            }

            const filePath = editor.document.fileName;
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);

            let message = `Current file: ${filePath}`;

            if (selectedText) {
                message += `\n\nSelected code:\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
            }

            await gateway.sendMessage('context_update', {
                type: 'file_focus',
                filePath,
                language: editor.document.languageId,
                selection: selectedText || null
            });

            vscode.window.showInformationMessage('File context sent to OpenClaw');
        }
    );

    context.subscriptions.push(command);
}
