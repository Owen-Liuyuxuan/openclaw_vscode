import * as vscode from 'vscode';
import { SessionManager } from '../gateway/sessionManager';
import { Logger } from '../utils/logger';
import { ToolEventHandler } from './toolEventHandler';

export class ChatPanel {
  private panel: vscode.WebviewPanel | undefined;
  private sessionManager: SessionManager;
  private activeRuns = new Map<string, string>();
  private cachedHistory: Array<{ role: string; content: string }> = [];

  constructor(
    private extensionUri: vscode.Uri,
    sessionManager: SessionManager
  ) {
    this.sessionManager = sessionManager;
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'openclawChat',
      'OpenClaw Assistant',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          this.extensionUri,
          vscode.Uri.joinPath(this.extensionUri, 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'node_modules')
        ]
      }
    );

    this.panel.webview.html = this.getWebviewContent(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'sendMessage':
            await this.handleUserMessage(message.text);
            break;
          case 'debug':
            break;
        }
      }
    );

    this.sessionManager.on('stream', (event: any) => {
      this.handleStreamEvent(event);
    });

    this.restoreHistory();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private async handleUserMessage(text: string): Promise<void> {
    try {
      // Send to SessionManager
      this.cachedHistory.push({ role: 'user', content: text });
      await this.sessionManager.sendChatMessage(text, await this.gatherContext());
    } catch (error: any) {
      vscode.window.showErrorMessage(`OpenClaw error: ${error.message}`);
      this.panel?.webview.postMessage({
        type: 'response',
        text: `Error: ${error.message}`
      });
    }
  }

  private handleStreamEvent(event: any): void {
    if (!this.panel) return;

    if (event.type === 'agent_message') {
      const runId = event.runId || 'unknown';
      const lastText = this.activeRuns.get(runId) || '';
      const nextText = event.text || lastText;
      const delta = event.delta || nextText.slice(lastText.length);

      if (!this.activeRuns.has(runId)) {
        this.panel.webview.postMessage({
          type: 'assistant_stream_start',
          runId,
          text: lastText
        });
      }

      this.activeRuns.set(runId, nextText);
      this.cachedHistory = this.cachedHistory.filter(item => item.role !== `assistant:${runId}`);
      this.cachedHistory.push({ role: `assistant:${runId}`, content: nextText });
      this.panel.webview.postMessage({
        type: 'assistant_stream_delta',
        runId,
        delta,
        fullText: nextText
      });
      return;
    }

    if (event.type === 'chat_message' && event.role === 'assistant') {
      const runId = event.runId || 'chat';
      const lastText = this.activeRuns.get(runId) || '';
      const nextText = event.content || lastText;
      const delta = nextText.slice(lastText.length);

      if (!this.activeRuns.has(runId)) {
        this.panel.webview.postMessage({
          type: 'assistant_stream_start',
          runId,
          text: lastText
        });
      }

      this.activeRuns.set(runId, nextText);
      this.cachedHistory = this.cachedHistory.filter(item => item.role !== `assistant:${runId}`);
      this.cachedHistory.push({ role: `assistant:${runId}`, content: nextText });
      this.panel.webview.postMessage({
        type: 'assistant_stream_delta',
        runId,
        delta,
        fullText: nextText
      });

      if (event.state === 'final') {
        this.panel.webview.postMessage({
          type: 'assistant_stream_end',
          runId
        });
        this.activeRuns.delete(runId);
      }
      return;
    }

    if (event.type === 'tool_event' && event.phase === 'start') {
      // Initialize a tool block in the UI
      const formattedArgs = ToolEventHandler.formatToolArgs(event.args || {});
      
      this.panel.webview.postMessage({
        type: 'tool_start',
        runId: event.runId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: formattedArgs
      });
      return;
    }
    
    if (event.type === 'tool_event' && event.phase === 'result') {
      // Update the tool with result
      const formattedResult = ToolEventHandler.formatToolResult(
        event.result || '',
        event.isError || false
      );
      
      this.panel.webview.postMessage({
        type: 'tool_result',
        toolCallId: event.toolCallId,
        result: formattedResult,
        isError: event.isError || false
      });
      return;
    }

    if (event.type === 'agent_lifecycle' && event.phase) {
      if (['completed', 'error', 'cancelled'].includes(event.phase)) {
        const runId = event.runId || 'unknown';
        this.panel.webview.postMessage({
          type: 'assistant_stream_end',
          runId
        });
        this.activeRuns.delete(runId);
      }
    }
  }

  private async gatherContext(): Promise<any> {
    const editor = vscode.window.activeTextEditor;
    const workspace = vscode.workspace.workspaceFolders?.[0];

    return {
      workspace: workspace?.uri.fsPath,
      activeFile: editor?.document.fileName,
      language: editor?.document.languageId,
      selection: editor?.selection ? {
        start: editor.selection.start.line,
        end: editor.selection.end.line
      } : null
    };
  }

  private async restoreHistory(): Promise<void> {
    if (!this.panel) return;

    if (this.cachedHistory.length > 0) {
      this.panel.webview.postMessage({
        type: 'history',
        messages: this.cachedHistory.map(item => {
          const role = item.role.startsWith('assistant:') ? 'assistant' : item.role;
          return { role, content: item.content };
        })
      });
    }

    try {
      const history = await this.sessionManager.getSessionHistory(50);
      const messages = Array.isArray(history?.messages) ? history.messages : history?.payload?.messages;
      if (Array.isArray(messages)) {
        const normalized = messages
          .map((msg: any) => {
            const role = msg.role || msg?.message?.role;
            const content = msg.text || msg?.message?.text || msg?.message?.content?.[0]?.text;
            if (!role || !content) {
              return null;
            }
            return { role, content };
          })
          .filter(Boolean) as Array<{ role: string; content: string }>;
        if (normalized.length > 0) {
          this.cachedHistory = normalized;
          this.panel.webview.postMessage({
            type: 'history',
            messages: normalized
          });
        }
      }
    } catch (error: any) {
      this.sessionManager.emit('error', error);
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const markdownItUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')
    );
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <style>
        body {
          padding: 0;
          margin: 0;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          font-family: var(--vscode-font-family);
        }
        #chat-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
        }
        #messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .message {
          margin-bottom: 12px;
          padding: 8px 12px;
          border-radius: 4px;
        }
        .user-message {
          background-color: var(--vscode-input-background);
          align-self: flex-end;
        }
        .assistant-message {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
        }
        #input-container {
          display: flex;
          padding: 16px;
          border-top: 1px solid var(--vscode-panel-border);
        }
        #message-input {
          flex: 1;
          padding: 8px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
        }
        #send-button {
          margin-left: 8px;
          padding: 8px 16px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        
        /* Tool styles */
        ${ToolEventHandler.getToolStyles()}
      </style>
    </head>
    <body>
      <div id="chat-container">
        <div id="messages"></div>
        <div id="input-container">
          <input type="text" id="message-input" placeholder="Ask OpenClaw..." />
          <button id="send-button">Send</button>
        </div>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        // #region agent log
        vscode.postMessage({ type: 'debug', message: 'chatpanel:main-script-loaded' });
        console.log('[DEBUG] ChatPanel main script loaded');
        // #endregion
        function escapeHtml(text) {
          return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        }

        // Initialize markdown renderer - will be set when library loads
        let md = { render: (text) => escapeHtml(text).replace(/\\\\n/g, '<br>') };
        
        // Load markdown-it asynchronously
        const markdownScript = document.createElement('script');
        markdownScript.src = '${markdownItUri.toString().replace(/'/g, "\\'")}';
        markdownScript.nonce = '${nonce}';
        markdownScript.onload = () => {
          // #region agent log
          vscode.postMessage({ type: 'debug', message: 'chatpanel:markdown-it-loaded' });
          // #endregion
          if (window.markdownit) {
            md = window.markdownit({
              html: false,
              linkify: true,
              breaks: true
            });
          }
        };
        markdownScript.onerror = (e) => {
          // #region agent log
          vscode.postMessage({ type: 'debug', message: 'chatpanel:markdown-it-failed' });
          console.error('[DEBUG] ChatPanel failed to load markdown-it', e);
          // #endregion
        };
        document.head.appendChild(markdownScript);

        function renderMarkdown(text) {
          try {
            return md.render(text);
          } catch (error) {
            return escapeHtml(text).replace(/\\\\n/g, '<br>');
          }
        }
        const messagesDiv = document.getElementById('messages');
        const input = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');

        function addMessage(text, isUser) {
          const div = document.createElement('div');
          div.className = 'message ' + (isUser ? 'user-message' : 'assistant-message');
          div.innerHTML = renderMarkdown(text);
          messagesDiv.appendChild(div);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        const activeRuns = new Map();

        function getOrCreateAssistantMessage(runId) {
          if (activeRuns.has(runId)) {
            return activeRuns.get(runId);
          }
          const div = document.createElement('div');
          div.className = 'message assistant-message';
          div.textContent = '';
          messagesDiv.appendChild(div);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
          activeRuns.set(runId, div);
          return div;
        }

        function sendMessage() {
          // #region agent log
          console.log('[DEBUG] ChatPanel sendMessage called');
          vscode.postMessage({ type: 'debug', message: 'chatpanel:sendMessage:entry' });
          // #endregion
          const text = input.value.trim();
          if (!text) return;

          addMessage(text, true);
          // #region agent log
          console.log('[DEBUG] ChatPanel about to postMessage', {textLength: text.length});
          vscode.postMessage({ type: 'debug', message: 'chatpanel:sendMessage:beforePost' });
          // #endregion
          vscode.postMessage({ type: 'sendMessage', text });
          // #region agent log
          vscode.postMessage({ type: 'debug', message: 'chatpanel:sendMessage:afterPost' });
          // #endregion
          input.value = '';
        }

        // #region agent log
        console.log('[DEBUG] ChatPanel setting up listeners', {sendButton: !!sendButton});
        vscode.postMessage({ type: 'debug', message: 'chatpanel:setupListeners' });
        // #endregion
        sendButton.addEventListener('click', () => {
          // #region agent log
          console.log('[DEBUG] ChatPanel sendButton clicked');
          vscode.postMessage({ type: 'debug', message: 'chatpanel:sendButtonClick' });
          // #endregion
          vscode.postMessage({ type: 'debug', message: 'ui:sendButtonClick' });
          sendMessage();
        });
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') sendMessage();
        });

        // Drag and drop support
        input.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          input.style.borderColor = 'var(--vscode-focusBorder)';
        });

        input.addEventListener('dragleave', () => {
          input.style.borderColor = 'var(--vscode-input-border)';
        });

        input.addEventListener('drop', (e) => {
          e.preventDefault();
          input.style.borderColor = 'var(--vscode-input-border)';
          
          const uriList = e.dataTransfer.getData('text/uri-list');
          let text = '';
          if (uriList) {
            const fileUris = uriList
              .split('\\n')
              .map(line => line.trim())
              .filter(line => line.startsWith('file://'));
            if (fileUris.length > 0) {
              text = fileUris
                .map(uri => decodeURIComponent(uri.replace('file://', '')))
                .join('\\n');
            }
          }
          if (!text) {
            text = e.dataTransfer.getData('text/plain');
          }
          if (text) {
            const currentPos = input.selectionStart;
            const value = input.value;
            input.value = value.substring(0, currentPos) + text + value.substring(input.selectionEnd);
          }
        });
        
        ${ToolEventHandler.getToolScripts()}

        window.addEventListener('message', (event) => {
          const message = event.data;
          if (message.type === 'response') {
            addMessage(message.text, false);
          } else if (message.type === 'history') {
            messagesDiv.innerHTML = '';
            activeRuns.clear();
            for (const item of message.messages || []) {
              addMessage(item.content, item.role !== 'assistant');
            }
          } else if (message.type === 'assistant_stream_start') {
            getOrCreateAssistantMessage(message.runId);
          } else if (message.type === 'assistant_stream_delta') {
            const div = getOrCreateAssistantMessage(message.runId);
            if (message.fullText !== undefined) {
              div.innerHTML = renderMarkdown(message.fullText);
            } else {
              div.innerHTML = renderMarkdown(div.textContent + (message.delta || ''));
            }
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
          } else if (message.type === 'assistant_stream_end') {
            activeRuns.delete(message.runId);
          } else if (message.type === 'tool_start') {
            handleToolStart(message);
          } else if (message.type === 'tool_result') {
            handleToolResult(message);
          }
        });
      </script>
    </body>
    </html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < 32; i += 1) {
      value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
  }
}
