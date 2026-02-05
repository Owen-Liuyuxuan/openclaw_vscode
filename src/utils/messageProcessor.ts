import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * MessageProcessor handles filtering and processing of incoming messages
 * from the Gateway to ensure proper display and response handling
 */
export class MessageProcessor {
    private static instance: MessageProcessor;
    private logger: Logger;
    
    private constructor() {
        this.logger = Logger.getInstance();
    }

    public static getInstance(): MessageProcessor {
        if (!MessageProcessor.instance) {
            MessageProcessor.instance = new MessageProcessor();
        }
        return MessageProcessor.instance;
    }

    /**
     * Process incoming message from Gateway
     * Filters out unnecessary content and ensures proper handling
     */
    public processIncomingMessage(message: any): any {
        try {
            // Skip processing for health and tick events
            if (message.type === 'event' && (message.event === 'health' || message.event === 'tick')) {
                return null; // Don't process these events further
            }
            
            // Handle chat messages
            if (message.type === 'event' && message.event === 'chat') {
                return this.processChatMessage(message);
            }
            
            // Handle agent events
            if (message.type === 'event' && message.event === 'agent') {
                return this.processAgentEvent(message);
            }
            
            // Handle responses
            if (message.type === 'res') {
                return this.processResponse(message);
            }
            
            return message; // Return original message if no special processing needed
        } catch (error) {
            this.logger.error('Error processing message', error);
            return message; // Return original message on error
        }
    }
    
    /**
     * Process chat messages
     */
    private processChatMessage(message: any): any {
        // Extract just the relevant content from chat messages
        if (message.payload && message.payload.message) {
            const content = message.payload.message.content;
            if (Array.isArray(content) && content.length > 0) {
                return {
                    type: 'chat_message',
                    runId: message.payload.runId,
                    state: message.payload.state,
                    role: message.payload.message.role,
                    content: content[0].text,
                    timestamp: message.payload.timestamp
                };
            }
        }
        return message;
    }
    
    /**
     * Process agent events
     */
    private processAgentEvent(message: any): any {
        // Handle agent events - extract the most relevant information
        if (message.payload && message.payload.data) {
            // For lifecycle events, just return a simplified version
            if (message.payload.stream === 'lifecycle') {
                return {
                    type: 'agent_lifecycle',
                    phase: message.payload.data.phase,
                    runId: message.payload.runId,
                    timestamp: message.payload.ts
                };
            }
            
            // For assistant stream, extract the text
            if (message.payload.stream === 'assistant' && message.payload.data.text) {
                return {
                    type: 'agent_message',
                    runId: message.payload.runId,
                    seq: message.payload.seq,
                    text: message.payload.data.text,
                    delta: message.payload.data.delta || '',
                    timestamp: message.payload.ts
                };
            }
        }
        return message;
    }
    
    /**
     * Process response messages
     */
    private processResponse(message: any): any {
        // Ensure responses are properly tracked and handled
        if (message.hasError) {
            this.logger.warn(`Error in response for request ${message.id}`, message);
        }
        return message;
    }
    
    /**
     * Format message for display in UI
     */
    public formatMessageForDisplay(message: any): string {
        if (typeof message === 'string') {
            return message;
        }
        
        if (message.type === 'chat' && message.content) {
            return message.content;
        }
        
        if (message.type === 'agent_message' && message.text) {
            return message.text;
        }
        
        // Default to JSON stringify for other message types
        try {
            return JSON.stringify(message, null, 2);
        } catch (error) {
            return 'Unable to format message for display';
        }
    }
}