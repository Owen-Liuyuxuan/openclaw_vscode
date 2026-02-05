import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export function registerShowLogsCommand(
    context: vscode.ExtensionContext
): void {
    const command = vscode.commands.registerCommand(
        'openclaw.showLogs',
        async () => {
            // Show the output channel
            Logger.getInstance().show();
            
            // Also show a message with log file location
            const logFilePath = Logger.getInstance().getLogFilePath();
            if (logFilePath) {
                const openFile = 'Open Log File';
                const result = await vscode.window.showInformationMessage(
                    `OpenClaw logs are available at: ${logFilePath}`,
                    openFile
                );
                
                if (result === openFile) {
                    const uri = vscode.Uri.file(logFilePath);
                    vscode.workspace.openTextDocument(uri).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            }
        }
    );

    context.subscriptions.push(command);
}