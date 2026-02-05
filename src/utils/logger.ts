import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Logger for OpenClaw extension that logs to:
 * 1. VSCode output channel
 * 2. Console (for development)
 * 3. File (optional)
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logFilePath?: string;
    private logToFile: boolean = false;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('OpenClaw');
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Initialize file logging
     */
    public enableFileLogging(context: vscode.ExtensionContext): void {
        this.logToFile = true;
        
        // Create logs directory in extension storage path
        const logsDir = path.join(context.globalStoragePath, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        
        // Create log file with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.logFilePath = path.join(logsDir, `openclaw-${timestamp}.log`);
        
        this.info(`File logging enabled at: ${this.logFilePath}`);
    }

    /**
     * Get the current log file path
     */
    public getLogFilePath(): string | undefined {
        return this.logFilePath;
    }

    /**
     * Log debug message
     */
    public debug(message: string, data?: any): void {
        this.log('DEBUG', message, data);
    }

    /**
     * Log info message
     */
    public info(message: string, data?: any): void {
        this.log('INFO', message, data);
    }

    /**
     * Log warning message
     */
    public warn(message: string, data?: any): void {
        this.log('WARN', message, data);
    }

    /**
     * Log error message
     */
    public error(message: string, error?: any): void {
        this.log('ERROR', message, error);
        
        // If error is an Error object, log the stack trace
        if (error instanceof Error) {
            this.log('ERROR', `Stack trace: ${error.stack}`, null);
        }
    }

    /**
     * Log a message with a specific level
     */
    private log(level: string, message: string, data: any = null): void {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        
        // Add data if provided
        if (data !== null) {
            try {
                if (typeof data === 'object') {
                    logMessage += `\n${JSON.stringify(data, null, 2)}`;
                } else {
                    logMessage += `\n${data}`;
                }
            } catch (err) {
                logMessage += `\n[Error serializing data: ${err}]`;
            }
        }

        // Log to output channel
        this.outputChannel.appendLine(logMessage);
        
        // Log to console
        switch (level) {
            case 'DEBUG': console.debug(`[OpenClaw] ${message}`, data); break;
            case 'INFO': console.log(`[OpenClaw] ${message}`, data); break;
            case 'WARN': console.warn(`[OpenClaw] ${message}`, data); break;
            case 'ERROR': console.error(`[OpenClaw] ${message}`, data); break;
        }
        
        // Log to file if enabled
        if (this.logToFile && this.logFilePath) {
            try {
                fs.appendFileSync(this.logFilePath, logMessage + os.EOL);
            } catch (err) {
                console.error(`[OpenClaw] Failed to write to log file: ${err}`);
            }
        }
    }

    /**
     * Show the output channel
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * Log WebSocket traffic (useful for debugging)
     */
    public logWebSocketTraffic(direction: 'SEND' | 'RECEIVE', data: any): void {
        try {
            const stringData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            this.debug(`WebSocket ${direction}: ${stringData.substring(0, 1000)}${stringData.length > 1000 ? '...' : ''}`);
        } catch (err) {
            this.error(`Failed to log WebSocket traffic: ${err}`);
        }
    }
}