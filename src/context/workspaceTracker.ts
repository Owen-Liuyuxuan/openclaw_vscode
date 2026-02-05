import * as vscode from 'vscode';
import { WorkspaceContext } from '../types/openclaw';
import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceTracker {
    private currentContext: WorkspaceContext = {};

    constructor() {
        this.initializeTracking();
    }

    private initializeTracking(): void {
        // Track workspace changes
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.updateWorkspaceContext();
        });

        // Track active editor changes
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            this.updateEditorContext(editor);
        });

        // Track text document changes
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document === vscode.window.activeTextEditor?.document) {
                this.updateDocumentContext(e.document);
            }
        });

        // Initial context
        this.updateWorkspaceContext();
        this.updateEditorContext(vscode.window.activeTextEditor);
    }

    private updateWorkspaceContext(): void {
        const workspaces = vscode.workspace.workspaceFolders;

        if (workspaces && workspaces.length > 0) {
            this.currentContext.workspace = {
                name: workspaces[0].name,
                path: workspaces[0].uri.fsPath,
                type: this.detectProjectType(workspaces[0].uri.fsPath)
            };
        }
    }

    private updateEditorContext(editor: vscode.TextEditor | undefined): void {
        if (!editor) {
            this.currentContext.activeFile = undefined;
            return;
        }

        this.currentContext.activeFile = {
            path: editor.document.fileName,
            language: editor.document.languageId,
            lineCount: editor.document.lineCount,
            selection: editor.selection ? {
                start: editor.selection.start.line,
                end: editor.selection.end.line,
                text: editor.document.getText(editor.selection)
            } : undefined
        };
    }

    private updateDocumentContext(document: vscode.TextDocument): void {
        if (this.currentContext.activeFile) {
            this.currentContext.activeFile.lineCount = document.lineCount;
        }
    }

    private detectProjectType(workspacePath: string): string {
        // Check for common project files
        const indicators = [
            { file: 'package.json', type: 'Node.js' },
            { file: 'Cargo.toml', type: 'Rust' },
            { file: 'go.mod', type: 'Go' },
            { file: 'requirements.txt', type: 'Python' },
            { file: 'pom.xml', type: 'Java/Maven' },
            { file: 'build.gradle', type: 'Java/Gradle' },
            { file: 'CMakeLists.txt', type: 'C/C++' }
        ];

        for (const indicator of indicators) {
            if (fs.existsSync(path.join(workspacePath, indicator.file))) {
                return indicator.type;
            }
        }

        return 'Unknown';
    }

    public getContext(): WorkspaceContext {
        return { ...this.currentContext };
    }

    public augmentMessage(message: string): string {
        const ctx = this.getContext();
        let augmented = message;

        if (ctx.workspace) {
            augmented = `[Workspace: ${ctx.workspace.name} (${ctx.workspace.type})]\n${augmented}`;
        }

        if (ctx.activeFile) {
            augmented = `[Active File: ${ctx.activeFile.path} (${ctx.activeFile.language})]\n${augmented}`;

            if (ctx.activeFile.selection && ctx.activeFile.selection.text) {
                augmented += `\n\n[Selected Code]\n\`\`\`${ctx.activeFile.language}\n${ctx.activeFile.selection.text}\n\`\`\``;
            }
        }

        return augmented;
    }
}
