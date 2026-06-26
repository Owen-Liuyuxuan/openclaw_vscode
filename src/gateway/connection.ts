import * as vscode from 'vscode';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../utils/logger';
import { MessageProcessor } from '../utils/messageProcessor';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  method: string;
  params: any;
  timestamp: number;
  timeoutHandle?: NodeJS.Timeout;
  idleCheckHandle?: NodeJS.Timeout;
}

export class GatewayConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private readonly GATEWAY_URL = 'ws://127.0.0.1:18789';
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private reconnectAttempts = 0;
  private authToken: string | null = null;
  private logger: Logger;
  private lastError: Error | null = null;
  private lastActivity: number = Date.now();
  private pingInterval: NodeJS.Timeout | null = null;
  private isAuthenticated = false;
  private messageProcessor: MessageProcessor;
  
  // WebSocket readyState constants
  private readonly WS_OPEN = 1;
  
  constructor() {
    super();
    this.logger = Logger.getInstance();
    this.messageProcessor = MessageProcessor.getInstance();
  }

  /**
   * Generate a unique request ID
   */
  private generateId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Connect to the Gateway
   */
  public async connect(): Promise<boolean> {
    if (this.ws && this.ws.readyState === this.WS_OPEN) {
      this.logger.debug('Already connected to Gateway');
      return true;
    }

    if (this.isConnecting) {
      this.logger.debug('Connection to Gateway already in progress');
      return false;
    }

    this.isConnecting = true;
    
    try {
      // Get auth token before attempting connection
      this.authToken = await this.getAuthToken();
      
      if (!this.authToken) {
        this.logger.error('Failed to get auth token from OpenClaw config');
        this.isConnecting = false;
        return false;
      }

      this.logger.info('Connecting to OpenClaw Gateway...');
      
      return new Promise<boolean>((resolve) => {
        this.ws = new WebSocket(this.GATEWAY_URL);
        
        this.ws.on('open', () => {
          this.logger.info('Connected to Gateway');
          this.reconnectAttempts = 0;
          this.lastActivity = Date.now();
          
          // Start ping interval to keep connection alive
          this.startPingInterval();
          
          // Send initial connect message
          this.sendConnectRequest()
            .then(() => {
              this.isConnecting = false;
              this.isAuthenticated = true;
              this.emit('connected');
              resolve(true);
            })
            .catch((error) => {
              this.logger.error('Failed to authenticate with Gateway', error);
              this.isConnecting = false;
              this.disconnect();
              resolve(false);
            });
        });
        
        this.ws.on('message', (data: WebSocket.Data) => {
          this.lastActivity = Date.now();
          this.handleMessage(data);
        });
        
        this.ws.on('error', (error) => {
          this.logger.error('WebSocket error', error);
          this.lastError = error;
          this.isConnecting = false;
          resolve(false);
        });
        
        this.ws.on('close', () => {
          this.logger.info('Disconnected from Gateway');
          this.isAuthenticated = false;
          this.isConnecting = false;
          this.clearPingInterval();
          
          if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.attemptReconnect();
          } else {
            this.emit('disconnected');
          }
          
          resolve(false);
        });
      });
    } catch (error) {
      this.logger.error('Failed to connect to Gateway', error);
      this.isConnecting = false;
      return false;
    }
  }

  /**
   * Send the initial connect request as required by the Gateway protocol
   */
  private async sendConnectRequest(): Promise<void> {
    if (!this.authToken) {
      throw new Error('Auth token not available');
    }
    
    try {
      // Get VSCode version for client info
      const vscodeVersion = vscode.version || '1.0.0';
      
      // Send connect request with the correct protocol format
      // The client.mode MUST be "cli" according to the error message
      const response = await this.sendRequest('connect', {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: 'gateway-client',
          version: '1.0.0',
          platform: os.platform(),
          mode: 'backend'  // Changed from 'vscode-extension' to 'cli' then to 'backend'
        },
        scopes: ["operator.read", "operator.write"],
        auth: {
          token: this.authToken
        }
      });
      
      this.logger.debug('Connect response:', response);
      return;
    } catch (error) {
      this.logger.error('Failed to authenticate with Gateway', error);
      throw error;
    }
  }

  /**
   * Handle all incoming messages from the Gateway
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const rawMessage = data.toString();
      const message = JSON.parse(rawMessage);
      
      // // Special debug for agent events (where tool calls live)
      // if (message.type === 'event' && message.event === 'agent') {
      //   const payload = message.payload;
      //   const stream = payload?.stream;
        
      //   // Extra debug for tool events
      //   if (stream === 'tool') {
      //     const data = payload?.data || {};
      //     this.logger.info('TOOL EVENT RECEIVED!', {
      //       stream: stream,
      //       phase: data.phase,
      //       toolName: data.toolName || data.name || 'unknown',
      //       toolCallId: data.toolCallId || data.id || 'unknown',
      //       data_keys: Object.keys(data)
      //     });
          
      //     // Log tool content for debugging
      //     if (data.content && data.content.length < 500) {
      //       this.logger.debug('Tool content:', data.content);
      //     }
      //   }
        
      //   this.logger.debug('AGENT EVENT DETAILS:', {
      //     stream: stream,
      //     seq: payload?.seq,
      //     runId: payload?.runId,
      //     data_keys: payload?.data ? Object.keys(payload.data) : 'no data',
      //     data_type: typeof payload?.data,
      //     data_string: JSON.stringify(payload?.data).substring(0, 200)
      //   });
      // }

      // Process the message using MessageProcessor
      const processedMessage = this.messageProcessor.processIncomingMessage(message);
      
      // Skip further processing if the message processor returns null
      if (processedMessage === null) {
        return;
      }
      
      // Handle different message types
      if (message.type === 'res') {
        this.handleResponse(message);
      } else if (message.type === 'event') {
        this.handleEvent(message, processedMessage);
      } else {
        this.logger.debug('Received unknown message type', message);
      }
    } catch (error) {
      this.logger.error('Failed to parse message from Gateway', error);
    }
  }

  /**
   * Handle response messages (replies to our requests)
   */
  private handleResponse(message: any): void {
    const requestId = message.id;
    const pendingRequest = this.pendingRequests.get(requestId);
    
    if (pendingRequest) {
      this.pendingRequests.delete(requestId);
      if (pendingRequest.timeoutHandle) {
        clearTimeout(pendingRequest.timeoutHandle);
      }
      if (pendingRequest.idleCheckHandle) {
        clearInterval(pendingRequest.idleCheckHandle);
      }
      
      if (message.ok === false) {
        this.logger.warn(`Request ${requestId} (${pendingRequest.method}) failed`, message.error);
        pendingRequest.reject(message.error || new Error('Unknown error'));
      } else {
        pendingRequest.resolve(message.payload);
      }
    } else {
      this.logger.warn(`Response for unknown request: ${requestId}`);
    }
  }

  /**
   * Handle event messages (unsolicited messages from the Gateway)
   */
  private handleEvent(message: any, processedMessage: any): void {
    const eventType = message.event;
    
    // Ignore connect.challenge when using token auth
    if (eventType === 'connect.challenge') {
      this.logger.debug('Ignoring connect.challenge event');
      return;
    }
    
    // Log the event type for debugging
    this.logger.debug(`Received event`, { event: eventType, hasPayload: !!message.payload });
    
    // Emit the event for subscribers
    this.emit(eventType, message.payload);
    this.emit('event', { type: eventType, payload: message.payload });
    this.emit('message', message);
    this.emit('processed_event', processedMessage);
  }


  /**
   * Send a raw message over the WebSocket
   */
  private sendRawMessage(message: any): void {
    if (!this.ws || this.ws.readyState !== this.WS_OPEN) {
      throw new Error('Not connected to Gateway');
    }
    
    const messageStr = JSON.stringify(message);
    this.logger.debug(`Sending: ${messageStr.substring(0, 100)}...`);
    this.ws.send(messageStr);
    this.lastActivity = Date.now();
  }

  /**
   * Keep the connection alive with regular pings
   */
  private startPingInterval(): void {
    this.clearPingInterval();
    
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === this.WS_OPEN) {
        // Send a ping if no activity for more than 30 seconds
        const inactivityTime = Date.now() - this.lastActivity;
        if (inactivityTime > 30000) {
          try {
            this.sendRequest('ping', {}).catch(err => {
              this.logger.warn('Ping failed', err);
            });
          } catch (error) {
            this.logger.warn('Failed to send ping', error);
          }
        }
      }
    }, 30000);
  }

  /**
   * Clear the ping interval
   */
  private clearPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Get the authentication token from the OpenClaw config
   */
  private async getAuthToken(): Promise<string | null> {
    try {
      // Read token from ~/.openclaw/openclaw.json
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      
      if (!fs.existsSync(configPath)) {
        this.logger.error(`OpenClaw config not found at ${configPath}`);
        return null;
      }
      
      const configContent = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      
      // Check both possible token locations in the config
      let token = null;
      if (config.gateway && config.gateway.auth && config.gateway.auth.token) {
        token = config.gateway.auth.token;
      } else if (config.gateway && config.gateway.token) {
        token = config.gateway.token;
      }
      
      if (!token) {
        this.logger.error('Gateway token not found in OpenClaw config');
        return null;
      }
      
      return token;
    } catch (error) {
      this.logger.error('Failed to read auth token from OpenClaw config', error);
      return null;
    }
  }

  /**
   * Attempt to reconnect after a connection failure
   */
  private attemptReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    this.logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        this.logger.error('Reconnection attempt failed', error);
      });
    }, delay);
  }

  /**
   * Send a request to the Gateway and await response
   */
  public async sendRequest(
    method: string,
    params: any,
    options?: { timeoutMs?: number; idleTimeoutMs?: number }
  ): Promise<any> {
    if (!this.ws || this.ws.readyState !== this.WS_OPEN) {
      await this.connect();
      
      if (!this.ws || this.ws.readyState !== this.WS_OPEN) {
        throw new Error('Failed to connect to Gateway');
      }
    }
    
    const id = this.generateId();
    const request = {
      type: 'req',
      id,
      method,
      params
    };
    
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        method,
        params,
        timestamp: Date.now()
      };

      this.pendingRequests.set(id, pending);
      
      try {
        this.sendRawMessage(request);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
      
      // Set a timeout for the request
      if (options?.idleTimeoutMs) {
        const idleTimeoutMs = options.idleTimeoutMs;
        pending.idleCheckHandle = setInterval(() => {
          if (!this.pendingRequests.has(id)) {
            return;
          }
          const idleFor = Date.now() - this.lastActivity;
          if (idleFor > idleTimeoutMs) {
            this.pendingRequests.delete(id);
            clearInterval(pending.idleCheckHandle!);
            reject(new Error(`Request ${method} idle timed out after ${idleTimeoutMs} ms`));
          }
        }, 1000);
      } else {
        const timeoutMs = options?.timeoutMs ?? 30000;
        pending.timeoutHandle = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error(`Request ${method} timed out after ${timeoutMs} ms`));
          }
        }, timeoutMs);
      }
    });
  }

  /**
   * Send a message via chat.send
   */
  public async sendMessage(method: string, params: any): Promise<any> {
    this.logger.info(`Sending ${method} message`, { messageLength: JSON.stringify(params).length });
    
    try {
      // Add idempotency key to prevent duplicate messages
      if (params && !params.idempotencyKey) {
        params.idempotencyKey = this.generateId();
      }
      
      return await this.sendRequest(method, params);
    } catch (error) {
      this.logger.error(`Failed to send ${method} message`, error);
      throw error;
    }
  }

  /**
   * Get the current connection status
   */
  public isConnected(): boolean {
    return !!this.ws && this.ws.readyState === this.WS_OPEN && this.isAuthenticated;
  }

  /**
   * Clean disconnect from Gateway
   */
  public disconnect(): void {
    this.clearPingInterval();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      try {
        if (this.ws.readyState === this.WS_OPEN) {
          this.ws.close();
        }
      } catch (error) {
        this.logger.warn('Error while disconnecting from Gateway', error);
      } finally {
        this.ws = null;
        this.isAuthenticated = false;
      }
    }
    
    for (const pending of this.pendingRequests.values()) {
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      if (pending.idleCheckHandle) {
        clearInterval(pending.idleCheckHandle);
      }
      pending.reject(new Error('Connection lost'));
    }
    this.pendingRequests.clear();
  }
}