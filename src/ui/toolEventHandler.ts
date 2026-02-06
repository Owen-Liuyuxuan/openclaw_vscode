import * as vscode from 'vscode';

/**
 * Handles tool event processing for chat interfaces
 */
export class ToolEventHandler {
  /**
   * Format tool arguments for display
   */
  static formatToolArgs(args: any): string {
    if (typeof args === 'string') {
      return args;
    }
    
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }
  
  /**
   * Extract text content from a tool result with content array
   */
  private static extractContentText(content: any[]): string {
    if (!Array.isArray(content)) {
      return '';
    }
    
    const textItems = content
      .filter(item => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text);
      
    return textItems.join('\n');
  }
  
  /**
   * Format details from a tool execution result
   */
  private static formatExecutionDetails(details: any): string {
    if (!details) {
      return '';
    }
    
    const status = details.status === 'completed' ? 
      'Success' : `Status: ${details.status || 'unknown'}`;
    
    let parts = [status];
    
    if (typeof details.exitCode === 'number') {
      parts.push(`Exit code: ${details.exitCode}`);
    }
    
    return parts.join(' | ');
  }
  
  /**
   * Format tool result, truncating if too long
   * This is used by both the server-side (directly) and referenced 
   * by the client-side JavaScript (as logic pattern)
   */
  static formatToolResult(result: any, isError: boolean, maxLength: number = 2000): string {
    // Handle null/undefined
    if (result == null) {
      return isError ? 'Error: No result' : 'No result';
    }
    
    // Handle string directly
    if (typeof result === 'string') {
      return result.length > maxLength ? 
        result.substring(0, maxLength) + '... (truncated)' : 
        result;
    }
    
    // Handle the special case of content+details structure
    if (typeof result === 'object' && result.content && result.details) {
      // Get content text
      const contentText = this.extractContentText(result.content);
      
      // Get details text
      const detailsText = this.formatExecutionDetails(result.details);
      
      // Use content text or aggregated result
      let mainText = contentText;
      if (!mainText && result.details && typeof result.details.aggregated === 'string') {
        mainText = result.details.aggregated;
      }
      
      // Combine main text with details
      if (mainText && detailsText) {
        return `${mainText}\n\n${detailsText}`;
      } else if (detailsText) {
        return detailsText;
      } else if (mainText) {
        return mainText;
      }
    }
    
    // Default object handling
    try {
      const formatted = JSON.stringify(result, null, 2);
      return formatted.length > maxLength ? 
        formatted.substring(0, maxLength) + '... (truncated)' : 
        formatted;
    } catch {
      const fallback = String(result);
      return fallback.length > maxLength ? 
        fallback.substring(0, maxLength) + '... (truncated)' : 
        fallback;
    }
  }
  
  /**
   * Generates CSS styles for tool visualization
   */
  static getToolStyles(): string {
    return `
      .tool-container {
        margin: 8px 0;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        overflow: hidden;
      }
      .tool-header {
        display: flex;
        justify-content: space-between;
        padding: 6px 10px;
        background-color: var(--vscode-editor-lineHighlightBackground, rgba(0, 0, 0, 0.1));
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .tool-name {
        font-weight: bold;
      }
      .tool-status {
        font-size: 0.85em;
        padding: 2px 6px;
        border-radius: 3px;
      }
      .tool-running {
        background-color: var(--vscode-statusBarItem-warningBackground, #ff8c00);
        color: var(--vscode-statusBarItem-warningForeground, white);
      }
      .tool-error {
        background-color: var(--vscode-errorForeground, #f44336);
        color: white;
      }
      .tool-success {
        background-color: var(--vscode-terminal-ansiGreen, #4caf50);
        color: white;
      }
      .tool-args, .tool-result-content {
        padding: 8px;
        margin: 0;
        max-height: 300px;
        overflow: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9em;
        background-color: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.05));
        white-space: pre-wrap;
      }
      .tool-result {
        margin-top: 4px;
        border-top: 1px solid var(--vscode-panel-border);
      }
      .tool-result-header {
        display: flex;
        justify-content: flex-end;
        padding: 4px 10px;
      }
      .message-text-content {
        display: block;
      }
    `;
  }

  /**
   * Generates JavaScript for handling tool events
   * This has been simplified to avoid duplicating the formatting logic
   * and focus only on UI manipulation
   */
  static getToolScripts(): string {
    return `
      // Tool call tracking
      const toolCalls = new Map();
      // Store message texts by runId
      const messageTexts = new Map();
      
      // Create a MutationObserver to detect changes to the DOM
      // This will help us detect when streaming updates replace our tool blocks
      let observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.removedNodes) {
              // Check if a tools container was removed
              if (node.nodeType === Node.ELEMENT_NODE && 
                  node.querySelector && 
                  node.querySelector('.tool-container')) {
                
                // Get runId from parent message element
                const messageEl = mutation.target;
                if (messageEl && messageEl.classList && messageEl.classList.contains('assistant-message')) {
                  const runId = Array.from(activeRuns.entries())
                    .find(([id, el]) => el === messageEl)?.[0];
                  
                  if (runId) {
                    // Re-add the tools container if it was accidentally removed
                    setTimeout(() => {
                      restoreToolsContainer(runId);
                    }, 0);
                  }
                }
              }
            }
          }
        }
      });
      
      // Start observing the messages container
      setTimeout(() => {
        observer.observe(messagesDiv, { childList: true, subtree: true });
      }, 0);
      
      // Keep track of tool containers by runId
      const toolContainers = new Map();
      
      // This function wraps message content to help preserve tools
      function wrapMessageContent(runId, messageEl) {
        // Check if this message already has our wrapper structure
        let textWrapper = messageEl.querySelector('.message-text-content');
        let toolsContainer = messageEl.querySelector('.tools-container');
        
        if (!textWrapper) {
          // Create a wrapper for the text content
          textWrapper = document.createElement('div');
          textWrapper.className = 'message-text-content';
          
          // Move existing content into the wrapper
          const content = messageEl.innerHTML;
          messageEl.innerHTML = '';
          textWrapper.innerHTML = content;
          
          messageEl.appendChild(textWrapper);
        }
        
        if (!toolsContainer) {
          // Create a container for tools
          toolsContainer = document.createElement('div');
          toolsContainer.className = 'tools-container';
          toolsContainer.id = 'tools-' + runId;
          messageEl.appendChild(toolsContainer);
          
          // Store for later access
          toolContainers.set(runId, toolsContainer);
        }
        
        return { textWrapper, toolsContainer };
      }
      
      // Override the original function to add our wrapper
      const originalGetOrCreateAssistantMessage = window.getOrCreateAssistantMessage;
      window.getOrCreateAssistantMessage = function(runId) {
        const messageEl = originalGetOrCreateAssistantMessage(runId);
        wrapMessageContent(runId, messageEl);
        return messageEl;
      };
      
      // Restore tools container if it was removed
      function restoreToolsContainer(runId) {
        const messageEl = activeRuns.get(runId);
        if (!messageEl) return;
        
        // Look for existing tools container
        let toolsContainer = messageEl.querySelector('.tools-container');
        
        // If no tools container exists but we have one stored, restore it
        if (!toolsContainer && toolContainers.has(runId)) {
          messageEl.appendChild(toolContainers.get(runId));
        } 
        // If no stored container exists, create a new one
        else if (!toolsContainer) {
          const { toolsContainer: newContainer } = wrapMessageContent(runId, messageEl);
          toolContainers.set(runId, newContainer);
        }
      }
      
      // Override the assistant_stream_delta handler to preserve tool blocks
      window.addEventListener('message', function(event) {
        const message = event.data;
        if (message.type === 'assistant_stream_delta') {
          const runId = message.runId;
          const messageEl = activeRuns.get(runId);
          
          if (!messageEl) return;
          
          // Get or create our wrapper structure
          const { textWrapper } = wrapMessageContent(runId, messageEl);
          
          // Initialize or update the message text for this run
          let currentText = messageTexts.get(runId) || '';
          if (message.fullText !== undefined) {
            currentText = message.fullText;
          } else {
            currentText += message.delta || '';
          }
          messageTexts.set(runId, currentText);
          
          // Update only the text wrapper with the new text
          textWrapper.innerHTML = renderMarkdown(currentText);
          
          // Ensure the tools container is still there
          restoreToolsContainer(runId);
          
          // Scroll to bottom
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
          
          // Prevent default handling
          event.stopImmediatePropagation();
          return false;
        }
      }, true);
      
      function handleToolStart(event) {
        const { runId, toolCallId, toolName, args } = event;
        
        // Get the message element
        const messageEl = getOrCreateAssistantMessage(runId);
        
        // Get our tools container
        let toolsContainer = messageEl.querySelector('.tools-container');
        if (!toolsContainer) {
          const { toolsContainer: newContainer } = wrapMessageContent(runId, messageEl);
          toolsContainer = newContainer;
        }
        
        // Create the tool element
        const toolElement = document.createElement('div');
        toolElement.className = 'tool-container';
        toolElement.id = 'tool-' + toolCallId;
        toolElement.innerHTML = \`
          <div class="tool-header">
            <span class="tool-name">\${toolName}</span>
            <span class="tool-status tool-running">Running</span>
          </div>
          <div class="tool-args">
            <pre>\${escapeHtml(args)}</pre>
          </div>
          <div class="tool-result-container"></div>
        \`;
        
        // Add to the DOM and store reference
        toolsContainer.appendChild(toolElement);
        toolCalls.set(toolCallId, toolElement);
        
        // Scroll into view
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
      
      function handleToolResult(event) {
        const { toolCallId, result, isError } = event;
        const toolElement = toolCalls.get(toolCallId);
        
        if (!toolElement) {
          console.error('Tool element not found for ID:', toolCallId);
          return;
        }
        
        // Remove the "running" status
        const statusElement = toolElement.querySelector('.tool-status');
        statusElement.classList.remove('tool-running');
        
        // Add success/error status
        const statusClass = isError ? 'tool-error' : 'tool-success';
        const statusText = isError ? 'Error' : 'Success';
        statusElement.classList.add(statusClass);
        statusElement.textContent = statusText;
        
        // Add the result
        const resultContainer = toolElement.querySelector('.tool-result-container');
        const resultElement = document.createElement('div');
        resultElement.className = 'tool-result ' + statusClass;
        
        // The result is already formatted by the server - just display it
        resultElement.innerHTML = \`
          <pre class="tool-result-content">\${escapeHtml(result)}</pre>
        \`;
        
        resultContainer.appendChild(resultElement);
        
        // Scroll into view
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
    `;
  }
}