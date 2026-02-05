import * as vscode from 'vscode';
import { GatewayConnection } from './gateway/connection';
import { SessionManager } from './gateway/sessionManager';
import { ChatViewProvider } from './ui/chatViewProvider';
import { ChatPanel } from './ui/chatPanel';
import { registerSendFilePathCommand } from './commands/sendFilePath';
import { registerShowLogsCommand } from './commands/showLogs';
import { Logger } from './utils/logger';
import { WorkspaceTracker } from './context/workspaceTracker';

let gateway: GatewayConnection;
let sessionManager: SessionManager;
let logger: Logger;
let workspaceTracker: WorkspaceTracker;

/**
 * Activate the extension
 */
async function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    logger = Logger.getInstance();
    logger.enableFileLogging(context);
    logger.info('Extension activating');

    // Initialize Gateway connection
    gateway = new GatewayConnection();
    
    // Initialize session manager
    sessionManager = new SessionManager(gateway);
    
    // Initialize workspace tracker
    workspaceTracker = new WorkspaceTracker();
    
    // Register the chat view provider
    const chatViewProvider = new ChatViewProvider(context.extensionUri, sessionManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatViewProvider
        )
    );
    
    // Register commands
    registerSendFilePathCommand(context, gateway);
    registerShowLogsCommand(context);
    
    // Register command to open chat panel
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.openChat', () => {
            const panel = new ChatPanel(context.extensionUri, sessionManager);
            panel.show();
        })
    );
    
    // Connect to Gateway
    try {
        await gateway.connect();
        logger.info('Connected to Gateway');
    } catch (error) {
        logger.error('Failed to connect to Gateway', error);
    }
    
    logger.info('Extension activated');
}

/**
 * Deactivate the extension
 */
function deactivate() {
    if (logger) {
        logger.info('Extension deactivating');
    }
    
    if (gateway) {
        gateway.disconnect();
    }
}

export { activate, deactivate };