import * as vscode from 'vscode';
import { SessionManager } from '../gateway/sessionManager';
import { Logger } from '../utils/logger';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'openclaw.chatView';
    private _view?: vscode.WebviewView;
    private _sessionManager: SessionManager;
    private _activeRuns = new Map<string, string>();
    private _cachedHistory: Array<{ role: string; content: string }> = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        sessionManager: SessionManager
    ) {
        this._sessionManager = sessionManager;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        const logger = Logger.getInstance();
        // #region agent log
        logger.debug('[DEBUG] resolveWebviewView called', {hasContext: !!context});
        // #endregion

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'node_modules')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            // #region agent log
            logger.debug('[DEBUG] onDidReceiveMessage fired', {type: data.type, hasText: !!data.text, dataKeys: Object.keys(data)});
            // #endregion
            switch (data.type) {
                case 'sendMessage':
                    // #region agent log
                    logger.debug('[DEBUG] Handling sendMessage', {textLength: data.text?.length});
                    // #endregion
                    await this._handleUserMessage(data.text);
                    break;
                case 'debug':
                    logger.debug(`[WEBVIEW] ${data.message}`);
                    break;
            }
        });

        this._sessionManager.on('stream', (event: any) => {
            this._handleStreamEvent(event);
        });

        webviewView.onDidChangeVisibility(() => {
            // #region agent log
            logger.debug('[DEBUG] Webview visibility changed', {visible: webviewView.visible});
            // #endregion
            if (webviewView.visible) {
                this._restoreHistory();
            }
        });

        // #region agent log
        logger.debug('[DEBUG] Initial webview visibility', {visible: webviewView.visible});
        // #endregion
        if (webviewView.visible) {
            this._restoreHistory();
        }
    }

    private async _handleUserMessage(text: string) {
        // #region agent log
        const logger = Logger.getInstance();
        logger.debug('[DEBUG] _handleUserMessage entry', {textLength: text.length, hasView: !!this._view});
        // #endregion
        if (!this._view) return;

        try {
            this._cachedHistory.push({ role: 'user', content: text });
            // #region agent log
            logger.debug('[DEBUG] Before sendChatMessage');
            // #endregion
            await this._sessionManager.sendChatMessage(text, await this._gatherContext());
            // #region agent log
            logger.debug('[DEBUG] After sendChatMessage success');
            // #endregion
        } catch (error: any) {
            // #region agent log
            logger.error('[DEBUG] sendChatMessage error', {message: error.message, stack: error.stack});
            // #endregion
            vscode.window.showErrorMessage(`OpenClaw error: ${error.message}`);
            this._view.webview.postMessage({
                type: 'response',
                text: `Error: ${error.message}`
            });
        }
    }

    private _handleStreamEvent(event: any): void {
        if (!this._view) return;

        if (event.type === 'agent_message') {
            const runId = event.runId || 'unknown';
            const lastText = this._activeRuns.get(runId) || '';
            const nextText = event.text || lastText;
            const delta = event.delta || nextText.slice(lastText.length);

            if (!this._activeRuns.has(runId)) {
                this._view.webview.postMessage({
                    type: 'assistant_stream_start',
                    runId,
                    text: lastText
                });
            }

            this._activeRuns.set(runId, nextText);
            this._cachedHistory = this._cachedHistory.filter(item => item.role !== `assistant:${runId}`);
            this._cachedHistory.push({ role: `assistant:${runId}`, content: nextText });
            this._view.webview.postMessage({
                type: 'assistant_stream_delta',
                runId,
                delta,
                fullText: nextText
            });
            return;
        }

        if (event.type === 'chat_message' && event.role === 'assistant') {
            const runId = event.runId || 'chat';
            const lastText = this._activeRuns.get(runId) || '';
            const nextText = event.content || lastText;
            const delta = nextText.slice(lastText.length);

            if (!this._activeRuns.has(runId)) {
                this._view.webview.postMessage({
                    type: 'assistant_stream_start',
                    runId,
                    text: lastText
                });
            }

            this._activeRuns.set(runId, nextText);
            this._cachedHistory = this._cachedHistory.filter(item => item.role !== `assistant:${runId}`);
            this._cachedHistory.push({ role: `assistant:${runId}`, content: nextText });
            this._view.webview.postMessage({
                type: 'assistant_stream_delta',
                runId,
                delta,
                fullText: nextText
            });

            if (event.state === 'final') {
                this._view.webview.postMessage({
                    type: 'assistant_stream_end',
                    runId
                });
                this._activeRuns.delete(runId);
            }
            return;
        }

        if (event.type === 'agent_lifecycle' && event.phase) {
            if (['completed', 'error', 'cancelled'].includes(event.phase)) {
                const runId = event.runId || 'unknown';
                this._view.webview.postMessage({
                    type: 'assistant_stream_end',
                    runId
                });
                this._activeRuns.delete(runId);
            }
        }
    }

    private async _gatherContext(): Promise<any> {
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

    private async _restoreHistory(): Promise<void> {
        if (!this._view) return;

        if (this._cachedHistory.length > 0) {
            this._view.webview.postMessage({
                type: 'history',
                messages: this._cachedHistory.map(item => {
                    const role = item.role.startsWith('assistant:') ? 'assistant' : item.role;
                    return { role, content: item.content };
                })
            });
        }

        try {
            const history = await this._sessionManager.getSessionHistory(50);
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
                    this._cachedHistory = normalized;
                    this._view.webview.postMessage({
                        type: 'history',
                        messages: normalized
                    });
                }
            }
        } catch (error: any) {
            this._sessionManager.emit('error', error);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = this._getNonce();
        const markdownItUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')
        );
        return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <style>
        body {
          padding: 8px;
          margin: 0;
          background-color: var(--vscode-sideBar-background);
          color: var(--vscode-sideBar-foreground);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-sideBar-font-size);
        }
        #chat-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 16px);
        }
        #messages {
          flex: 1;
          overflow-y: auto;
          margin-bottom: 8px;
        }
        .message {
          margin-bottom: 8px;
          padding: 6px 10px;
          border-radius: 4px;
          word-wrap: break-word;
          max-width: 90%;
        }
        .user-message {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          align-self: flex-end;
          margin-left: auto;
        }
        .assistant-message {
          background-color: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
        }
        #input-container {
          display: flex;
          gap: 4px;
          padding-top: 8px;
          border-top: 1px solid var(--vscode-panel-border);
        }
        textarea {
          flex: 1;
          padding: 6px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 2px;
          resize: none;
          min-height: 40px;
          max-height: 150px;
        }
        button {
          padding: 4px 12px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 2px;
          cursor: pointer;
          align-self: flex-end;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div id="chat-container">
        <div id="messages"></div>
        <div id="input-container">
          <textarea id="message-input" placeholder="Ask OpenClaw..."></textarea>
          <button id="send-button">Send</button>
        </div>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        vscode.postMessage({ type: 'debug', message: 'webview:main-script-loaded' });
        console.log('[DEBUG] Main script loaded');
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
          vscode.postMessage({ type: 'debug', message: 'webview:markdown-it-loaded' });
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
          vscode.postMessage({ type: 'debug', message: 'webview:markdown-it-failed' });
          console.error('[DEBUG] Failed to load markdown-it', e);
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
          console.log('[DEBUG] sendMessage called', {inputValue: input.value});
          vscode.postMessage({ type: 'debug', message: 'webview:sendMessage:entry:' + input.value.length });
          // #endregion
          const text = input.value.trim();
          if (!text) {
            // #region agent log
            console.log('[DEBUG] sendMessage: empty text, returning');
            vscode.postMessage({ type: 'debug', message: 'webview:sendMessage:emptyText' });
            // #endregion
            return;
          }

          addMessage(text, true);
          // #region agent log
          console.log('[DEBUG] About to postMessage sendMessage', {type: 'sendMessage', textLength: text.length});
          vscode.postMessage({ type: 'debug', message: 'webview:sendMessage:beforePost' });
          // #endregion
          vscode.postMessage({ type: 'sendMessage', text });
          // #region agent log
          console.log('[DEBUG] postMessage sent');
          vscode.postMessage({ type: 'debug', message: 'webview:sendMessage:afterPost' });
          // #endregion
          input.value = '';
          input.style.height = 'auto';
        }

        // #region agent log
        console.log('[DEBUG] Setting up event listeners', {sendButton: !!sendButton, input: !!input});
        vscode.postMessage({ type: 'debug', message: 'webview:setupListeners:sendButton=' + !!sendButton });
        // #endregion
        sendButton.addEventListener('click', () => {
          // #region agent log
          console.log('[DEBUG] sendButton click fired');
          vscode.postMessage({ type: 'debug', message: 'webview:sendButtonClick' });
          // #endregion
          sendMessage();
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });

        input.addEventListener('input', () => {
          input.style.height = 'auto';
          input.style.height = input.scrollHeight + 'px';
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
            // If dragging from VS Code Explorer, text/plain often contains the path
            const currentPos = input.selectionStart;
            const value = input.value;
            input.value = value.substring(0, currentPos) + text + value.substring(input.selectionEnd);
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
          }
        });

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
          }
        });
      </script>
    </body>
    </html>`;
    }

    private _getNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let value = '';
        for (let i = 0; i < 32; i += 1) {
            value += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return value;
    }
}
