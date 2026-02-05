// Gateway Protocol Types
export interface GatewayMessage {
    method: string;
    params: any;
    id?: string | number;
}

export interface GatewayResponse {
    id: string | number;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export interface ToolRequest {
    tool: string;
    params: any;
}

export interface ToolResult {
    success: boolean;
    result?: any;
    error?: string;
}

export interface FileEdit {
    startLine: number;
    endLine: number;
    newText: string;
}

export interface WorkspaceContext {
    workspace?: {
        name: string;
        path: string;
        type: string;
    };
    activeFile?: {
        path: string;
        language: string;
        lineCount: number;
        selection?: {
            start: number;
            end: number;
            text: string;
        };
    };
}
