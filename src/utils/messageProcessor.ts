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
            const stream = message.payload.stream;
            const data = message.payload.data;
            
            // For lifecycle events
            if (stream === 'lifecycle') {
                return {
                    type: 'agent_lifecycle',
                    phase: data.phase,
                    runId: message.payload.runId,
                    timestamp: message.payload.ts
                };
            }
            
            // For assistant stream, extract the text
            if (stream === 'assistant' && data.text) {
                return {
                    type: 'agent_message',
                    runId: message.payload.runId,
                    seq: message.payload.seq,
                    text: data.text,
                    delta: data.delta || '',
                    timestamp: message.payload.ts
                };
            }
            
            // NEW: Handle tool stream events
            if (stream === 'tool') {
                // Tool events can have different phases: start, update, result
                const toolCallId = data.toolCallId;
                const toolName = data.name;
                const args = data.args || {}; // Only available in 'start' phase
                const result = data.result || ''; // Only available in 'result' phase
                const isError = data.isError || false; // Only in 'result' phase
                
                return {
                    type: 'tool_event',
                    runId: message.payload.runId,
                    seq: message.payload.seq,
                    phase: data.phase || 'unknown',
                    toolCallId: toolCallId,
                    toolName: toolName,
                    args: args,
                    result: result,
                    isError: isError,
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
        
        // Handle different message types
        switch (message.type) {
            case 'chat_message':
                return message.content || '';
                
            case 'agent_message':
                return message.text || '';
                
            case 'tool_event':
                const toolName = message.toolName || 'Unknown tool';
                const phase = message.phase || 'unknown';
                const content = message.content || '';
                
                switch (phase) {
                    case 'start':
                        return `🔧 ${toolName} started...`;
                    case 'update':
                        const truncated = content.length > 100 ? content.substring(0, 100) + '...' : content;
                        return `⚙️ ${toolName}: ${truncated}`;
                    case 'end':
                        const result = content.length > 150 ? content.substring(0, 150) + '...' : content;
                        return `✓ ${toolName}: ${result}`;
                    default:
                        return `🔧 ${toolName} (${phase})`;
                }
                
            case 'agent_lifecycle':
                return `⚙️ ${message.phase || 'Lifecycle event'}`;
                
            default:
                // Default to JSON stringify for other message types
                try {
                    return JSON.stringify(message, null, 2);
                } catch (error) {
                    return 'Unable to format message for display';
                }
        }
    }
}