import * as vscode from 'vscode';

/**
 * Shows the OpenClaw output channel and displays a message
 * Use this for immediate visibility of important logs
 */
export function showOutputMessage(message: string): void {
    const channel = vscode.window.createOutputChannel('OpenClaw');
    channel.appendLine(`[${new Date().toISOString()}] ${message}`);
    channel.show();
}