import { EventEmitter } from 'events';
import { GatewayConnection } from './connection';
import { Logger } from '../utils/logger';

export class SessionManager extends EventEmitter {
    private currentSessionKey: string | null = null;
    private gateway: GatewayConnection;
    private logger: Logger;
    private readonly DEFAULT_SESSION_KEY = 'agent:main:main'; // Default session key from the events

    constructor(gateway: GatewayConnection) {
        super();
        this.gateway = gateway;
        this.logger = Logger.getInstance();
        
        // Listen for gateway events
        this.gateway.on('event', (event) => {
            if ((event.type === 'agent' || event.type === 'chat') && event.payload?.sessionKey) {
                this.currentSessionKey = event.payload.sessionKey;
                this.logger.debug(`Updated session key: ${this.currentSessionKey}`);
            }
        });

        this.gateway.on('processed_event', (event) => {
            this.emit('stream', event);
        });
    }

    /**
     * Get or create a session
     */
    async ensureSession(): Promise<string> {
        if (!this.currentSessionKey) {
            // Use the default session key if we don't have one yet
            this.currentSessionKey = this.DEFAULT_SESSION_KEY;
            this.logger.info(`Using default session key: ${this.currentSessionKey}`);
        }
        return this.currentSessionKey;
    }

    /**
     * Send a chat message
     */
    async sendChatMessage(message: string, context?: any): Promise<any> {
        // #region agent log
        this.logger.debug('[DEBUG] sendChatMessage entry', {messageLength: message.length, hasContext: !!context});
        // #endregion
        await this.ensureSession();
        // #region agent log
        this.logger.debug('[DEBUG] After ensureSession', {sessionKey: this.currentSessionKey});
        // #endregion

        try {
            const workspacePath = context?.workspace || 'unknown';
            const augmentedMessage = [
                'This message is sent from vscode client;',
                `the user is working at ${workspacePath};`,
                'when the user is referring to file paths, automatically infer if it is relative paths from the current directory or an absolute path.',
                'In other cases, work normally as you are the OpenClaw Agent.',
                `User Question: ${message}`
            ].join(' ');

            this.logger.info('Sending chat message', { 
                sessionKey: this.currentSessionKey,
                messageLength: message.length 
            });
            
            // Use the agent method directly to send messages
            // Note: Gateway does not accept 'context' property, only 'message' and 'idempotencyKey'
            // #region agent log
            this.logger.debug('[DEBUG] Before gateway.sendRequest', {method: 'agent', sessionKey: this.currentSessionKey});
            // #endregion
            const result = await this.gateway.sendRequest(
                'agent',
                {
                    sessionKey: this.currentSessionKey,
                    message: augmentedMessage,
                    idempotencyKey: this.generateId()
                },
                { idleTimeoutMs: 15000 }
            );
            // #region agent log
            this.logger.debug('[DEBUG] After gateway.sendRequest', {resultExists: !!result});
            // #endregion

            return result;
        } catch (error) {
            // #region agent log
            this.logger.error('[DEBUG] sendChatMessage error', {errorMessage: (error as any).message, errorStack: (error as any).stack});
            // #endregion
            this.logger.error('Failed to send chat message', error);
            throw error;
        }
    }
    
    /**
     * Get chat history
     */
    async getSessionHistory(limit: number = 50): Promise<any> {
        await this.ensureSession();
        
        try {
            this.logger.info('Fetching chat history', { 
                sessionKey: this.currentSessionKey,
                limit
            });
            
            const result = await this.gateway.sendRequest('chat.history', {
                sessionKey: this.currentSessionKey,
                limit
            });
            
            return result;
        } catch (error) {
            this.logger.error('Failed to get chat history', error);
            throw error;
        }
    }
    
    /**
     * Generate a unique ID for idempotency keys
     */
    private generateId(): string {
        return `vscode-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Get current session key
     */
    getCurrentSessionKey(): string | null {
        return this.currentSessionKey;
    }
    
    /**
     * Clear the current session
     */
    clearSession(): void {
        this.currentSessionKey = null;
        this.logger.info('Session cleared');
    }
}