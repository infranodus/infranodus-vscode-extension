import * as vscode from "vscode";
import axios from "axios";
import { jwtDecode, JwtPayload } from "jwt-decode";
import { Subject } from "rxjs";
import * as fs from "fs";
import * as path from "path";

interface CustomJwtPayload extends JwtPayload {
	user?: {
		id: string;
	};
}

export function activate(context: vscode.ExtensionContext) {
	const clipboardProvider = new ClipboardViewProvider(
		context.extensionUri,
		context,
	);
	const provider = new InfraNodusViewProvider(
		context.extensionUri,
		context,
		clipboardProvider,
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"infranodus-graph-view.graphView",
			provider,
		),
		vscode.window.registerWebviewViewProvider(
			"infranodus-graph-view.clipboardView",
			clipboardProvider,
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.setApiKey",
			async () => {
				const apiKey = await vscode.window.showInputBox({
					prompt: "Enter your API Key",
					password: true,
					placeHolder: "Enter your API key here...",
				});

				if (apiKey) {
					let decodedToken: CustomJwtPayload = {};
					let currentUser = "";
					if (apiKey) {
						try {
							decodedToken = jwtDecode<CustomJwtPayload>(apiKey);
							currentUser = decodedToken.user?.id || "";
						} catch (error) {
							console.error("Error decoding JWT:", error);
							decodedToken = {};
							currentUser = "";
						}
					}
					await context.secrets.store("infranodus-api-key", apiKey);
					vscode.window.showInformationMessage("API key saved successfully!");
				}
			},
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.visualizeAsGraph",
			async (uri?: vscode.Uri) => {
				try {
					// Ensure the webview is focused and initialized first
					await vscode.commands.executeCommand(
						"infranodus-graph-view.graphView.focus",
					);

					// Wait a bit for the webview to be ready
					await new Promise((resolve) => setTimeout(resolve, 500));

					let document: vscode.TextDocument | undefined;
					let folderContent: string | undefined;

					if (uri) {
						const stat = await vscode.workspace.fs.stat(uri);
						if (stat.type === vscode.FileType.Directory) {
							// Handle folder
							// vscode.window.showInformationMessage('Processing folder content...');
							folderContent = await provider.processFolderContent(uri);
							if (!folderContent) {
								vscode.window.showErrorMessage(
									"No content found in the folder",
								);
								return;
							}
						} else {
							// Handle single file
							document = await vscode.workspace.openTextDocument(uri);
						}
					} else {
						// If called from editor context menu
						document = vscode.window.activeTextEditor?.document;
					}

					if (document) {
						await provider.processDocument(document);
					}

					if (!document && !folderContent) {
						vscode.window.showErrorMessage("No document or folder selected");
					}
				} catch (error) {
					vscode.window.showErrorMessage(
						"Error processing content: " + (error as Error).message,
					);
					console.error("Error in visualizeAsGraph:", error);
				}
			},
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.openClipboard",
			() => {
				vscode.commands.executeCommand(
					"infranodus-graph-view.clipboardView.focus",
				);
			},
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.getGraph",
			async () => {
				const graphData = context.globalState.get("InfraNodus Graph");
				if (graphData) {
					// Show the graph data in a temporary editor
					const document = await vscode.workspace.openTextDocument({
						content: JSON.stringify(graphData, null, 2),
						language: "json",
					});
					await vscode.window.showTextDocument(document);
				} else {
					vscode.window.showInformationMessage(
						"No InfraNodus Graph data available",
					);
				}
				return graphData;
			},
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.getSelectedGraph",
			async () => {
				const graphData = context.globalState.get("InfraNodus Selected Graph");
				if (graphData) {
					// Show the graph data in a temporary editor
					const document = await vscode.workspace.openTextDocument({
						content: JSON.stringify(graphData, null, 2),
						language: "json",
					});
					await vscode.window.showTextDocument(document);
				} else {
					vscode.window.showInformationMessage(
						"No InfraNodus Graph data available",
					);
				}
				return graphData;
			},
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.visualizeDiffAsGraph",
			async (uri?: vscode.Uri) => {
				try {
					// Ensure the webview is focused and initialized first
					await vscode.commands.executeCommand(
						"infranodus-graph-view.graphView.focus",
					);

					// Wait a bit for the webview to be ready
					await new Promise((resolve) => setTimeout(resolve, 500));

					let diffContent: string | undefined;
					let activeDocument: vscode.TextDocument | undefined;

					if (uri) {
						diffContent = await getGitDiffContent(uri);

						if (diffContent)
							clipboardProvider.updateCurrentUrl(
								vscode.workspace.asRelativePath(uri.fsPath),
							);
					} else {
						// If called from editor context menu

						activeDocument = vscode.window.activeTextEditor?.document;
						if (!activeDocument) {
							vscode.window.showErrorMessage("No active document found");
							return;
						}

						diffContent = await getGitDiffContent(activeDocument.uri);

						if (diffContent)
							clipboardProvider.updateCurrentUrl(
								vscode.workspace.asRelativePath(activeDocument.uri.fsPath),
							);

						// console.log('Diff content:', diffContent);
					}

					if (!diffContent) {
						vscode.window.showErrorMessage(
							"No git changes found for this file or folder.",
						);
						return;
					}

					// Process the diff content
					const documentName = activeDocument
						? activeDocument.uri.path.split("/").pop() || "diff"
						: "diff";
					const diffFileName =
						uri?.path.split("/").pop() || documentName;

					const diffContentToProcess =
						provider._processTextForAnalysis(
							diffContent,
							diffFileName,
						);
					await provider.processContent(diffContentToProcess, documentName);
				} catch (error) {
					vscode.window.showErrorMessage(
						"Error processing git diff: " + (error as Error).message,
					);
					console.error("Error in visualizeDiffAsGraph:", error);
				}
			},
		),
		vscode.commands.registerCommand(
			"infranodus-graph-view.visualizeRepoDiffAsGraph",
			async (uri?: vscode.Uri) => {
				try {
					// Ensure the webview is focused and initialized first
					await vscode.commands.executeCommand(
						"infranodus-graph-view.graphView.focus",
					);

					// Wait a bit for the webview to be ready
					await new Promise((resolve) => setTimeout(resolve, 500));

					let diffContent: string | undefined;
					let activeDocument: vscode.TextDocument | undefined;

					// If called from editor context menu

					const workspaceRootUri = vscode.workspace.workspaceFolders?.[0]?.uri;

					if (!workspaceRootUri) {
						vscode.window.showErrorMessage("No workspace folder found");
						return;
					}
					// Flag to indicate we're analyzing the whole vault
					const isVaultAnalysis = true;

					diffContent = await getGitDiffContent(
						workspaceRootUri,
						isVaultAnalysis,
					);

					// console.log('Diff content:', diffContent);

					if (!diffContent) {
						vscode.window.showErrorMessage(
							"No git changes found for this repository.",
						);
						return;
					}

					clipboardProvider.updateCurrentUrl("*");
					// Process the diff content
					const documentName = activeDocument
						? activeDocument.uri.path.split("/").pop() || "diff"
						: "diff";

					const diffContentToProcess =
						provider._processTextForAnalysis(
							diffContent,
							documentName,
						);
					await provider.processContent(diffContentToProcess, documentName);
				} catch (error) {
					vscode.window.showErrorMessage(
						"Error processing git repo diff: " + (error as Error).message,
					);
					console.error("Error in visualizeRepoDiffAsGraph:", error);
				}
			},
		),
	);
}

class InfraNodusViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private topicsSubject = new Subject<any>();

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext,
		private readonly _clipboardProvider: ClipboardViewProvider,
	) {}

	public getInfraNodusStopwords(): string[] {
		const config = vscode.workspace.getConfiguration("infranodus-graph-view");
		return config.get("stopwords") || ["const", "var", "let"];
	}

	public getPartOfSpeechToProcess(): string {
		const config = vscode.workspace.getConfiguration("infranodus-graph-view");
		return config.get("partOfSpeechToProcess") || "WORDS_IF_NO_HASHTAGS";
	}

	public getContentToSend(): string {
		const config = vscode.workspace.getConfiguration("infranodus-graph-view");
		return config.get("contentToSend") || "PARSED_TEXT_ONLY";
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Initialize the webview with the iframe URL
		this.initializeWebview();

		// Process the active document immediately when the view is resolved
		this.processDocument();

		// Subscribe to topics updates
		this.topicsSubject.subscribe((data) => {
			console.log("Received topics:", data);
			const topicNames =
				data.entriesAndGraphOfContext?.graph?.graphologyGraph?.attributes?.top_clusters.map(
					(topic: any) => {
						if (topic.aiName) {
							const topicName = topic.aiName.split(". ").pop();
							return { id: topic.community, name: topicName };
						}
						return {
							id: topic.community,
							name: topic.nodes
								.map((node: any) => node.nodeName)
								.slice(0, 3)
								.join(" "),
						};
					},
				);

			data.topicNames = topicNames || [];
			// If we have a webview, send the data to it

			if (this._view) {
				this._view.webview.postMessage({
					type: "LOAD_JSON",
					payload: data,
				});
			}
		});

		webviewView.webview.onDidReceiveMessage(async (message) => {
			console.log(
				"Extension [InfraNodusViewProvider] received message:",
				message,
			);
			switch (message.command) {
				case "showError":
					vscode.window.showErrorMessage(message.error);
					return;
				case "reload":
					await this.processDocument();
					return;
				case "setApiKey":
					vscode.commands.executeCommand("infranodus-graph-view.setApiKey");
					return;
				case "refreshGraphStats":
					this._clipboardProvider.updateSelectedClusters([]);

					this._clipboardProvider.updateSelectedNodes([], []);

					const originalDotGraph = this._clipboardProvider.getOriginalGraph();
					const originalDotGraphByCluster =
						this._clipboardProvider.getOriginalGraphByCluster();

					this._clipboardProvider.updateSelectedDotGraph({
						dotGraph: originalDotGraph,
						dotGraphByCluster: originalDotGraphByCluster,
					});

					return;
				case "forwardToClipboard":
					console.log("Forwarding message to clipboard provider:", message);
					if (message.type == "UPDATE_SELECTED_NODES") {
						this._clipboardProvider.updateSelectedNodes(
							message.payload.selectedNodes,
							message.payload.connectedNodes,
						);
						return;
					} else if (message.type == "UPDATE_GROUPS") {
						this._clipboardProvider.updateSelectedClusters(
							message.payload.selectedClusters,
						);
						return;
					}
				case "processExternalAction":
					const actionMessage = message.payload?.action;

					if (
						actionMessage &&
						actionMessage.type == "statement" &&
						actionMessage.nodes
					) {
						const searchPattern = this.generateAndSearchPatternFromArray(
							actionMessage.nodes,
						);

						const filesToInclude = this.generateCurrentUrl();

						await this.executeFileSearch({ searchPattern, filesToInclude });

						break;
					}

					if (
						actionMessage &&
						actionMessage.type == "statement" &&
						(actionMessage.mode == "locate_topics" ||
							actionMessage.mode == "locate_gaps")
					) {
						const selectedTopics = actionMessage.selectedTopics;
						const statements = this._clipboardProvider.getCurrentStatements();

						const filteredContents = this.getTopStatementsOfTopics({
							statements,
							selectedTopics,
						});

						const searchPattern =
							this.generateSearchPatternFromArray(filteredContents);

						const filesToInclude = this.generateCurrentUrl();

						await this.executeFileSearch({ searchPattern, filesToInclude });

						break;
					}

					if (
						actionMessage != "question" &&
						actionMessage != "develop" &&
						actionMessage != "summarize" &&
						actionMessage != "context" &&
						actionMessage != "context_gap"
					)
						break;

					const statements = this._clipboardProvider.getCurrentStatements();
					const selectedWords = this._clipboardProvider.getSelectedNodes();
					const selectedClusters =
						this._clipboardProvider.getSelectedClusters();

					const filesToInclude = this.generateCurrentUrl();

					let statementsToUse: string[] = [];

					if (selectedWords.length == 0 && selectedClusters.length == 0) {
						statementsToUse = statements.map(
							(statement: any) => statement.content,
						);

						const searchPattern =
							this.generateSearchPatternFromArray(statementsToUse);

						await this.executeFileSearch({ searchPattern, filesToInclude });
					}

					if (selectedWords.length > 0) {
						const searchPattern =
							this.generateSearchPatternFromArray(selectedWords);

						statementsToUse = statements
							.filter((statement: any) =>
								selectedWords.some((word: string) =>
									statement.content.toLowerCase().includes(word.toLowerCase()),
								),
							)
							.map((statement: any) => statement.content);

						await this.executeFileSearch({ searchPattern, filesToInclude });
					}

					if (selectedClusters.length > 0 && selectedWords.length == 0) {
						statementsToUse =
							actionMessage == "summarize" || actionMessage == "context"
								? this.getAllStatementsOfTopics({
										statements,
										selectedTopics: selectedClusters,
									})
								: this.getTopStatementsOfTopics({
										statements,
										selectedTopics: selectedClusters,
									});
						const searchPattern =
							this.generateSearchPatternFromArray(statementsToUse);

						await this.executeFileSearch({ searchPattern, filesToInclude });
					}

					if (actionMessage == "context_gap" || actionMessage == "context")
						break;

					// TODO add to extension market
					// TODO add own chat panel inside

					setTimeout(() => {
						const graphToUse = this._clipboardProvider.getCurrentGraph();
						const contentToUse = statementsToUse.join("\n\n");
						if (graphToUse) {
							const prefix = this.generatePrefix(actionMessage);
							let contentWithPrefix = `${prefix}\n\n${graphToUse}`;
							if (contentToUse) {
								contentWithPrefix += `\n\nAnd take this context into account:\n\n${contentToUse}`;
							}
							vscode.env.clipboard.writeText(contentWithPrefix);
							vscode.window.showInformationMessage(
								"Copied AI prompt with the graph structure to clipboard. See the InfraNodus Log view for details.",
							);
						}
					}, 500);

					break;
				case "copyGraphToClipboard":
					const graphContent = this._clipboardProvider.getCurrentGraph();
					if (graphContent) {
						const prefix = vscode.workspace
							.getConfiguration("infranodus-graph-view")
							.get("graphPrefix");
						const contentWithPrefix = `${prefix}\n\n${graphContent}`;
						vscode.env.clipboard.writeText(contentWithPrefix);
						vscode.window.showInformationMessage(
							"Graph data copied to clipboard. You can paste it into an AI chat.",
						);
					}
					break;
			}
		});
	}

	public async executeFileSearch({
		searchPattern,
		filesToInclude,
	}: {
		searchPattern: string;
		filesToInclude: string;
	}) {
		return await vscode.commands.executeCommand(
			"workbench.action.findInFiles",
			{
				query: searchPattern,
				isRegex: true,
				isCaseSensitive: false,
				matchWholeWord: false,
				triggerSearch: false,
				filesToInclude: filesToInclude,
			},
		);
	}

	public generateSearchPatternFromArray(array: string[]): string {
		// Escape special regex characters in the node text
		return array
			.map((node: string) =>
				// Escape special regex characters in the node text
				node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
			)
			.join("|");
	}

	public generateAndSearchPatternFromArray(array: string[]): string {
		return (
			"^" +
			array
				.map(
					(node: string) =>
						// Escape special regex characters and wrap in positive lookahead
						`(?=.*${node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
				)
				.join("") +
			".*$"
		);
	}

	public getTopStatementsOfTopics({
		statements,
		selectedTopics,
	}: {
		statements: any[];
		selectedTopics: string[];
	}) {
		return statements
			.filter((statement) =>
				selectedTopics.includes(statement.topStatementOfCommunity),
			)
			.map((statement) => statement.content);
	}

	public getAllStatementsOfTopics({
		statements,
		selectedTopics,
	}: {
		statements: any[];
		selectedTopics: string[];
	}) {
		return statements
			.filter(
				(statement) =>
					selectedTopics.includes(statement.topStatementCommunity) ||
					selectedTopics.includes(statement.topStatementOfCommunity),
			)
			.map((statement) => statement.content);
	}

	public generateCurrentUrl() {
		return this._clipboardProvider.getCurrentUrl()
			? this._clipboardProvider.getCurrentUrl()
			: vscode.workspace.asRelativePath(
					vscode.window.activeTextEditor?.document.uri.fsPath || "",
				);
	}

	public generatePrefix(action: string): string {
		const config = vscode.workspace.getConfiguration("infranodus-graph-view");
		const settingsMap: Record<string, string> = {
			question: "promptQuestion",
			develop: "promptIdea",
			summarize: "promptSummary",
			context: "promptContext",
			context_gap: "promptContextGap",
		};
		const settingKey = settingsMap[action];
		if (settingKey) {
			return config.get<string>(settingKey) || "";
		}
		return "";
	}

	public async processDocument(document?: vscode.TextDocument) {
		try {
			// Show loading overlay
			this._view?.webview.postMessage({ command: "showLoading" });

			const documentToProcess =
				document || vscode.window.activeTextEditor?.document;
			if (!documentToProcess) {
				vscode.window.showErrorMessage("No document to process");
				return;
			}

			const text = documentToProcess.getText();

			const textToProcess = this._processTextForAnalysis(
				text,
				documentToProcess.fileName,
			);

			const apiKey = await this._context.secrets.get("infranodus-api-key");
			if (!apiKey) {
				vscode.window.showErrorMessage("Please set your API key first");
				return;
			}

			const textRequest = {
				name: documentToProcess.fileName.split("/").pop() || "untitled",
				text: textToProcess,
				aiTopics: true,
				stopwords: this.getInfraNodusStopwords(),
				contextSettings: {
					partOfSpeechToProcess: this.getPartOfSpeechToProcess(),
					doubleSquarebracketsProcessing: "PROCESS_AS_HASHTAGS",
					mentionsProcessing: "CONNECT_TO_ALL_CONCEPTS",
				},
			};
			// console.log('InfraNodus API Request:', textRequest);

			// Try with Bearer token format
			const formattedApiKey = apiKey.startsWith("Bearer ")
				? apiKey
				: `Bearer ${apiKey}`;

			const response = await axios.post(
				`${this.getServerUrl()}/api/v1/graphAndStatements?donotsave=true&addStats=true&dotGraph=true&optimize=develop`,
				textRequest,
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: formattedApiKey,
					},
				},
			);

			if (response.status !== 200) {
				throw new Error(`InfraNodus API request failed: ${response.status}`);
			}

			if (response.data.error) {
				if (response.data.error.includes("log in")) {
					vscode.window.showInformationMessage(
						`Please, add your InfraNodus API key in the extension settings.`,
					);
					return;
				}
				throw new Error(
					`InfraNodus API request failed: ${response.data.error}`,
				);
			}

			this._clipboardProvider.updateCurrentContent(text);

			const data = response.data;

			// Log the response data to debug console
			// console.log('InfraNodus API Response from processDocument:', JSON.stringify(data, null, 2));

			if (
				response.data &&
				response.data.entriesAndGraphOfContext &&
				response.data.entriesAndGraphOfContext.graph
			) {
				this._clipboardProvider.updateCurrentContent(textToProcess);

				// TODO do we really need this here?
				// Update the webview with new data
				// if (this._view) {
				//     this._view.webview.postMessage({
				//         type: 'LOAD_JSON',
				//         payload: response.data
				//     });
				// }

				// Send dotGraph to clipboard provider
				const dotGraph =
					response.data.entriesAndGraphOfContext.graph.graphologyGraph
						.attributes.dotGraph;
				const dotGraphByCluster =
					response.data.entriesAndGraphOfContext.graph.graphologyGraph
						.attributes.dotGraphByCluster;

				if (dotGraph) {
					this._clipboardProvider.updateDotGraph({
						dotGraph,
						dotGraphByCluster,
					});
				}

				const currentStatements =
					response.data.entriesAndGraphOfContext.statements;
				const topClusters =
					response.data.entriesAndGraphOfContext.graph.graphologyGraph
						.attributes.top_clusters;

				if (currentStatements) {
					this._clipboardProvider.updateCurrentStatements({
						currentStatements,
						topClusters,
					});
				}

				this._clipboardProvider.updateCurrentUrl(
					vscode.workspace.asRelativePath(documentToProcess.uri.fsPath) || "",
				);

				this.topicsSubject.next(response.data);

				this._clipboardProvider.updateSelectedClusters([]);

				this._clipboardProvider.updateSelectedNodes([], []);

				// Notify webview that processing is complete
				if (this._view) {
					this._view.webview.postMessage({ type: "PROCESSING_COMPLETE" });
				}
				// vscode.window.showInformationMessage('Graph visualization complete');
			}
		} catch (error) {
			if (axios.isAxiosError(error)) {
				console.error("Axios Error Details:", {
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
					config: {
						url: error.config?.url,
						method: error.config?.method,
						headers: error.config?.headers,
					},
				});
				vscode.window.showErrorMessage(
					`Error processing the document (A): ${error.response?.status} - ${error.response?.data?.message || error.message}`,
				);
			} else {
				console.error("Non-Axios Error:", error);
				vscode.window.showErrorMessage(
					"Error processing the document (N): " + (error as Error).message,
				);
			}
		} finally {
			// Hide loading overlay
			this._view?.webview.postMessage({ command: "hideLoading" });
		}
	}

	public async processFolderContent(
		folderUri: vscode.Uri,
	): Promise<string | undefined> {
		try {
			const content = await this.processDirectory(folderUri);
			if (content) {
				this._clipboardProvider.updateCurrentUrl(
					vscode.workspace.asRelativePath(folderUri.fsPath),
				);
				// Process the content with InfraNodus
				await this.processContent(content, folderUri.fsPath);
				return content;
			}
			return undefined;
		} catch (error) {
			vscode.window.showErrorMessage(
				"Error processing folder: " + (error as Error).message,
			);
			return undefined;
		}
	}

	public async processContent(content: string, name: string) {
		try {
			if (!this._view) {
				throw new Error("Webview not initialized");
			}

			this._view?.webview.postMessage({ command: "showLoading" });

			const apiKey = await this._context.secrets.get("infranodus-api-key");
			if (!apiKey) {
				vscode.window.showErrorMessage("Please set your API key first");
				return;
			}

			const textRequest = {
				name: name,
				text: content,
				aiTopics: true,
				stopwords: this.getInfraNodusStopwords(),
				contextSettings: {
					partOfSpeechToProcess: this.getPartOfSpeechToProcess(),
					doubleSquarebracketsProcessing: "PROCESS_AS_HASHTAGS",
					mentionsProcessing: "CONNECT_TO_ALL_CONCEPTS",
				},
			};

			const formattedApiKey = apiKey.startsWith("Bearer ")
				? apiKey
				: `Bearer ${apiKey}`;

			// Notify webview that processing is starting
			this._view.webview.postMessage({ type: "PROCESSING_START" });

			const response = await axios.post(
				`${this.getServerUrl()}/api/v1/graphAndStatements?donotsave=true&addStats=true&dotGraph=true&optimize=develop`,
				textRequest,
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: formattedApiKey,
					},
				},
			);

			if (response.status !== 200) {
				throw new Error(`InfraNodus API request failed: ${response.status}`);
			}

			if (response.data.error) {
				if (response.data.error.includes("log in")) {
					vscode.window.showInformationMessage(
						`Please, add your InfraNodus API key in the extension settings.`,
					);
					return;
				}
				throw new Error(
					`InfraNodus API request failed: ${response.data.error}`,
				);
			}

			if (
				response.data &&
				response.data.entriesAndGraphOfContext &&
				response.data.entriesAndGraphOfContext.graph
			) {
				this._clipboardProvider.updateCurrentContent(content);

				// Update the webview with new data
				if (this._view) {
					this._view.webview.postMessage({
						type: "LOAD_JSON",
						payload: response.data,
					});
				}

				// Send dotGraph to clipboard provider
				const dotGraph =
					response.data.entriesAndGraphOfContext.graph.graphologyGraph
						.attributes.dotGraph;
				const dotGraphByCluster =
					response.data.entriesAndGraphOfContext.graph.graphologyGraph
						.attributes.dotGraphByCluster;

				if (dotGraph) {
					this._clipboardProvider.updateDotGraph({
						dotGraph,
						dotGraphByCluster,
					});
				}

				const currentStatements =
					response.data.entriesAndGraphOfContext.statements;
				const topClusters =
					response.data.entriesAndGraphOfContext.graph.graphologyGraph
						.attributes.top_clusters;

				if (currentStatements) {
					this._clipboardProvider.updateCurrentStatements({
						currentStatements,
						topClusters,
					});
				}

				this.topicsSubject.next(response.data);

				// Notify webview that processing is complete
				if (this._view) {
					this._view.webview.postMessage({ type: "PROCESSING_COMPLETE" });
				}
				// vscode.window.showInformationMessage('Graph visualization complete');

				this._clipboardProvider.updateSelectedClusters([]);

				this._clipboardProvider.updateSelectedNodes([], []);
			}
		} catch (error) {
			console.error("Error processing content:", error);
			if (this._view) {
				this._view.webview.postMessage({
					type: "PROCESSING_ERROR",
					error: (error as Error).message,
				});
			}
			vscode.window.showErrorMessage(
				"Error processing content: " + (error as Error).message,
			);
		} finally {
			this._view?.webview.postMessage({ command: "hideLoading" });
		}
	}

	public async processDirectory(
		dirUri: vscode.Uri,
		depth: number = 0,
	): Promise<string> {
		const files = await vscode.workspace.fs.readDirectory(dirUri);
		let allContent = "";

		for (const [name, type] of files) {
			const fullUri = vscode.Uri.joinPath(dirUri, name);

			if (type === vscode.FileType.Directory) {
				// Process subdirectory recursively
				if (depth < 5) {
					// Limit recursion depth to prevent issues with very deep directories
					const subDirContent = await this.processDirectory(fullUri, depth + 1);
					allContent += `\n=== Directory: ${name} ===\n${subDirContent}\n`;
				}
			} else if (type === vscode.FileType.File) {
				// Skip binary files and certain extensions
				if (
					!name.match(
						/\.(txt|md|js|ts|py|java|c|cpp|h|hpp|cs|json|xml|html|css|scss|less|sql|yaml|yml|ini|conf|sh|bash|zsh|ps1|bat|cmd|go|rs|swift|kt|scala|r|m|php|rb|pl|pm|t|pod|lua|tcl|vb|fs|jsx|tsx)$/i,
					)
				) {
					continue;
				}

				try {
					const document = await vscode.workspace.openTextDocument(fullUri);
					const fileContent = this._processTextForAnalysis(
						document.getText(),
						name,
					);
					if (fileContent.trim()) {
						// Only include non-empty files
						allContent += `\n=== File: ${name} ===\n${fileContent}\n`;
					}
				} catch (error) {
					console.error(`Error reading file ${name}:`, error);
				}
			}
		}

		return allContent;
	}

	private getServerUrl(): string {
		return (
			vscode.workspace
				.getConfiguration("infranodus-graph-view")
				.get("apiUrl") || "http://localhost:3000"
		);
	}

	private getIframeUrl(): string {
		return (
			vscode.workspace
				.getConfiguration("infranodus-graph-view")
				.get("graphUrl") || "https://localhost:5173"
		);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const htmlPath = path.join(
			this._extensionUri.fsPath,
			"src",
			"webview.html",
		);
		let htmlContent = fs.readFileSync(htmlPath, "utf8");

		// Replace any ${webview.cspSource} in the HTML content if needed
		htmlContent = htmlContent.replace(/#{cspSource}/g, webview.cspSource);

		return htmlContent;
	}

	public _compressCodeBlocks(text: string): string {
		// Split text into lines to process
		const lines = text.split("\n");

		let result: string[] = [];
		let currentBlock: string[] = [];
		let inBlock = false;
		let blockIndentation = 0;
		let isPythonBlock = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmedLine = line.trim();
			const indentation = line.search(/\S/);

			// Check for JavaScript/TypeScript blocks
			if (trimmedLine.includes("{")) {
				inBlock = true;
				currentBlock.push(line);
				continue;
			}

			// Check for Python-style blocks (line ending with ':' and next line indented)
			if (trimmedLine.endsWith(":") && i + 1 < lines.length) {
				const nextLineIndent = lines[i + 1].search(/\S/);
				if (nextLineIndent > indentation) {
					inBlock = true;
					isPythonBlock = true;
					blockIndentation = indentation;
					currentBlock.push(line);
					continue;
				}
			}

			if (inBlock) {
				// Check if we're exiting the block
				if (
					(isPythonBlock &&
						(indentation <= blockIndentation || trimmedLine === "")) ||
					(!isPythonBlock && trimmedLine.includes("}"))
				) {
					if (!isPythonBlock && trimmedLine.includes("}")) {
						currentBlock.push(line);
					}

					// Compress the block
					const compressedBlock = currentBlock
						.map((l) => l.trim())
						.join(" ")
						.replace(/\s+/g, " ");

					result.push(compressedBlock);
					currentBlock = [];
					inBlock = false;
					isPythonBlock = false;

					if (isPythonBlock && trimmedLine !== "") {
						result.push(line);
					}
				} else {
					currentBlock.push(line);
				}
			} else {
				// Not in a block, keep original line with its newline
				result.push(line);
			}
		}

		// Handle any remaining block
		if (currentBlock.length > 0) {
			const compressedBlock = currentBlock
				.map((l) => l.trim())
				.join(" ")
				.replace(/\s+/g, " ");
			result.push(compressedBlock);
		}

		const resultToReturn = result.join("\n");

		return resultToReturn;
	}

	public _processTextForAnalysis(text: string, fileName: string): string {
		if (this.getContentToSend() === "PARSED_TEXT_ONLY") {
			return this._extractParsedText(text, fileName);
		}
		return this._compressCodeBlocks(text);
	}

	public _extractParsedText(text: string, fileName: string): string {
		const ext = (fileName.split(".").pop() || "").toLowerCase();

		if (
			["md", "txt", "rst", "adoc", "org", "wiki", "log"].includes(ext)
		) {
			return text;
		}

		const extracted: string[] = [];

		// Multi-line comments (/* */ and /** */)
		const multiLineComments = text.match(/\/\*[\s\S]*?\*\//g) || [];
		for (const c of multiLineComments) {
			const content = c
				.replace(/\/\*\*?\s*/, "")
				.replace(/\s*\*\//, "")
				.replace(/^\s*\*\s?/gm, "")
				.trim();
			if (content) extracted.push(content);
		}

		// HTML comments
		const htmlComments = text.match(/<!--[\s\S]*?-->/g) || [];
		for (const c of htmlComments) {
			const content = c
				.replace(/<!--\s*/, "")
				.replace(/\s*-->/, "")
				.trim();
			if (content) extracted.push(content);
		}

		// Single-line comments (// and #)
		const lines = text.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();

			// Strip URLs before looking for // comments to avoid false matches
			const sanitized = trimmed.replace(/https?:\/\/\S+/g, "");
			const cStyleMatch = sanitized.match(/\/\/\s*(.*)/);
			if (cStyleMatch && cStyleMatch[1].trim()) {
				extracted.push(cStyleMatch[1].trim());
				continue;
			}

			if (
				trimmed.startsWith("#") &&
				!trimmed.startsWith("#!") &&
				!trimmed.startsWith("#include")
			) {
				const comment = trimmed.replace(/^#+\s*/, "").trim();
				if (comment) extracted.push(comment);
			}
		}

		// Python docstrings
		const docstrings =
			text.match(/"{3}[\s\S]*?"{3}|'{3}[\s\S]*?'{3}/g) || [];
		for (const d of docstrings) {
			const content = d.slice(3, -3).trim();
			if (content) extracted.push(content);
		}

		// HTML-like files: extract visible text content
		if (["html", "htm", "xml", "svg", "vue", "svelte"].includes(ext)) {
			let cleaned = text
				.replace(/<script[\s\S]*?<\/script>/gi, "")
				.replace(/<style[\s\S]*?<\/style>/gi, "");
			const textContent = cleaned
				.replace(/<[^>]+>/g, " ")
				.replace(/&[a-z]+;/gi, " ")
				.replace(/\s+/g, " ")
				.trim();
			if (textContent) extracted.push(textContent);
		}

		// String literals that look like natural language
		const doubleQuoted = text.match(/"(?:[^"\\]|\\.)*"/g) || [];
		const singleQuoted = text.match(/'(?:[^'\\]|\\.)*'/g) || [];
		for (const s of [...doubleQuoted, ...singleQuoted]) {
			const content = s.slice(1, -1).trim();
			if (
				content.includes(" ") &&
				content.length > 10 &&
				!/^https?:\/\//.test(content)
			) {
				extracted.push(content);
			}
		}

		// [[wikilinks]]
		const wikilinks = [
			...new Set(text.match(/\[\[[^\]]+\]\]/g) || []),
		];
		for (const w of wikilinks) {
			if (!extracted.some((e) => e.includes(w))) {
				extracted.push(w);
			}
		}

		return extracted.filter(Boolean).join("\n");
	}

	private async initializeWebview() {
		if (!this._view) {
			return;
		}

		const apiKey = await this._context.secrets.get("infranodus-api-key");
		let currentUser = "";

		if (apiKey) {
			try {
				const decodedToken: CustomJwtPayload =
					jwtDecode<CustomJwtPayload>(apiKey);
				currentUser = decodedToken.user?.id || "";
			} catch (error) {
				console.error("Error decoding JWT:", error);
			}
		}

		const iframeUrl = this.getIframeUrl();
		this._context.globalState.update("infraNodusIframeUrl", iframeUrl);
		this._context.globalState.update("infraNodusUserId", currentUser);

		// Send the URL to the webview
		if (this._view) {
			this._view.webview.postMessage({
				type: "SET_IFRAME_URL",
				url: iframeUrl,
				userId: currentUser,
			});
		}
	}
}

class ClipboardViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _currentDotGraph: string = "";
	private _currentDotGraphByCluster: Record<string, any> = {};
	private _selectedDotGraph: string = "";
	private _selectedDotGraphByCluster: Record<string, any> = {};
	private _selectedNodes: string[] = [];
	private _connectedNodes: string[] = [];
	private _selectedClusters: string[] = [];
	private _contentAsText: string = "";
	private _currentStatements: any[] = [];
	private _currentUrl: string = "";

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext,
	) {}

	public updateCurrentContent(content: string) {
		this._contentAsText = content;
	}

	public getCurrentContent(): string {
		return this._contentAsText;
	}

	public updateDotGraph({
		dotGraph,
		dotGraphByCluster,
	}: {
		dotGraph: string;
		dotGraphByCluster: Record<string, any>;
	}) {
		// console.log('Updating dotGraph:', dotGraph);
		// console.log('Updating dotGraphByCluster:', dotGraphByCluster);
		this._currentDotGraph = dotGraph;
		this._currentDotGraphByCluster = dotGraphByCluster;

		// Store in global state
		this._context.globalState.update("InfraNodus Graph", dotGraphByCluster);

		// Update VS Code context for @ mentions
		vscode.commands.executeCommand(
			"setContext",
			"@InfraNodus Graph",
			dotGraphByCluster,
		);

		if (this._view) {
			this._view.webview.postMessage({
				type: "updateDotGraph",
				dotGraph: dotGraph,
				dotGraphByCluster: dotGraphByCluster,
			});
		}
	}

	public updateSelectedDotGraph({
		dotGraph,
		dotGraphByCluster,
	}: {
		dotGraph: string;
		dotGraphByCluster: Record<string, any>;
	}) {
		// console.log('Updating selected dotGraph:', dotGraph);
		// console.log('Updating selected dotGraphByCluster:', dotGraphByCluster);
		this._selectedDotGraph = dotGraph;
		this._selectedDotGraphByCluster = dotGraphByCluster;

		// Store in global state
		this._context.globalState.update(
			"InfraNodus Selected Graph",
			dotGraphByCluster,
		);

		// Update VS Code context for @ mentions
		vscode.commands.executeCommand(
			"setContext",
			"@InfraNodus Selected Graph",
			dotGraphByCluster,
		);
	}

	public getOriginalGraph(): string {
		return this._currentDotGraph;
	}

	public getOriginalGraphByCluster(): any {
		return this._currentDotGraphByCluster;
	}

	public getCurrentGraph(): string {
		return this._selectedDotGraph || this._currentDotGraph;
	}

	public updateCurrentStatements({
		currentStatements,
		topClusters,
	}: {
		currentStatements: any[];
		topClusters: any[];
	}) {
		const communityIdToStatementId = Object.fromEntries(
			topClusters.map((cluster) => [
				cluster.community.toString(),
				parseInt(cluster.topStatementId),
			]),
		);

		this._currentStatements = currentStatements.map((statement) => {
			const communityId = Object.entries(communityIdToStatementId).find(
				([_, id]) => id === statement.id,
			)?.[0];
			return communityId
				? { ...statement, topStatementOfCommunity: communityId }
				: statement;
		});

		// Store in global state
		this._context.globalState.update(
			"InfraNodus Statements",
			this._currentStatements,
		);
	}

	public getCurrentStatements(): any[] {
		return this._currentStatements;
	}

	public updateCurrentUrl(url: string) {
		this._currentUrl = url;

		// Store in global state
		this._context.globalState.update("InfraNodus Analyzed Url", url);
	}

	public getCurrentUrl(): string {
		return this._currentUrl;
	}

	public updateSelectedNodes(
		selectedNodes: string[],
		connectedNodes: string[],
	) {
		this._selectedNodes = selectedNodes;
		this._connectedNodes = connectedNodes;

		// Store in global state
		this._context.globalState.update(
			"InfraNodus Selected Nodes",
			selectedNodes,
		);
		this._context.globalState.update(
			"InfraNodus Connected Nodes",
			connectedNodes,
		);

		// Update the dot graph to only show relevant clusters
		const result =
			selectedNodes.length > 0
				? this.updateFilteredDotGraphBySelectedNodes()
				: {
						filteredDotGraph: this._currentDotGraph,
						filteredDotGraphByCluster: this._currentDotGraphByCluster,
					};
		const filteredDotGraph = result?.filteredDotGraph ?? this._currentDotGraph;
		const filteredDotGraphByCluster =
			result?.filteredDotGraphByCluster ?? this._currentDotGraphByCluster;

		this.updateSelectedDotGraph({
			dotGraph: filteredDotGraph ?? "",
			dotGraphByCluster: filteredDotGraphByCluster ?? {},
		});

		if (this._view) {
			this._view.webview.postMessage({
				type: "updateDotGraph",
				dotGraph: filteredDotGraph,
				dotGraphByCluster: filteredDotGraphByCluster,
			});
		}
	}

	public getSelectedNodes(): string[] {
		return this._selectedNodes;
	}

	public updateSelectedClusters(selectedClusters: string[]) {
		if (this._selectedNodes.length > 0) return;

		this._selectedClusters = selectedClusters;
		// Store in global state
		this._context.globalState.update(
			"InfraNodus Selected Clusters",
			selectedClusters,
		);

		const result =
			selectedClusters.length > 0
				? this.updateFilteredDotGraphBySelectedClusters()
				: {
						filteredDotGraph: this._currentDotGraph,
						filteredDotGraphByCluster: this._currentDotGraphByCluster,
					};

		const filteredDotGraph = result?.filteredDotGraph ?? this._currentDotGraph;
		const filteredDotGraphByCluster =
			result?.filteredDotGraphByCluster ?? this._currentDotGraphByCluster;

		this.updateSelectedDotGraph({
			dotGraph: filteredDotGraph ?? "",
			dotGraphByCluster: filteredDotGraphByCluster ?? {},
		});

		if (this._view) {
			this._view.webview.postMessage({
				type: "updateDotGraph",
				dotGraph: filteredDotGraph,
				dotGraphByCluster: filteredDotGraphByCluster,
			});
		}
	}

	public getSelectedClusters(): string[] {
		return this._selectedClusters;
	}

	private updateFilteredDotGraphBySelectedNodes() {
		if (!this._currentDotGraphByCluster) return;

		console.log("Current dotGraphByCluster:", this._currentDotGraphByCluster);

		// Ensure we have an array to work with
		const clusters = this._currentDotGraphByCluster
			? Object.keys(this._currentDotGraphByCluster).map(
					(key) => this._currentDotGraphByCluster![key],
				)
			: [];

		console.log("Clusters to filter:", clusters);

		const containsRelevantNode = (nodeString: string): boolean => {
			return (
				this._selectedNodes.every((node) => nodeString.includes(node)) &&
				this._connectedNodes.some((node) => nodeString.includes(node))
			);
		};

		const newClusters: any[] = [];
		const filteredClusters = clusters.forEach((cluster, index) => {
			if (!Array.isArray(cluster)) {
				console.log("Invalid cluster format:", cluster);
				return null;
			}

			// Filter out subclusters that don't contain relevant nodes
			const filteredClusterLines = cluster.filter((line) => {
				// Keep lines that contain selected or connected nodes
				return containsRelevantNode(line);
			});

			if (filteredClusterLines.length > 0)
				newClusters.push(filteredClusterLines);
		});

		console.log("Filtered clusters by terms:", newClusters);

		const filteredDotGraph = newClusters
			.map((cluster) => cluster!.join("\n"))
			.join("\n");

		return { filteredDotGraph, filteredDotGraphByCluster: newClusters };
	}

	private updateFilteredDotGraphBySelectedClusters() {
		if (!this._currentDotGraphByCluster) return;

		console.log("Current dotGraphByCluster:", this._currentDotGraphByCluster);

		// Ensure we have an array to work with
		const clusters = Object.keys(this._currentDotGraphByCluster).map((key) =>
			this._currentDotGraphByCluster ? this._currentDotGraphByCluster[key] : [],
		);

		console.log("Clusters to filter:", clusters);

		const filteredClusters: any[] = [];

		clusters.forEach((cluster, id) => {
			if (!Array.isArray(cluster)) {
				console.log("Invalid cluster format:", cluster);
				return null;
			}

			if (this._selectedClusters.includes(id.toString())) {
				filteredClusters.push(cluster);
			}
		});

		console.log("Filtered clusters by ID:", filteredClusters);

		const filteredDotGraph = filteredClusters
			.map((cluster) => cluster!.join("\n"))
			.join("\n");

		return { filteredDotGraph, filteredDotGraphByCluster: filteredClusters };
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		const clipboardHtmlPath = vscode.Uri.joinPath(
			this._extensionUri,
			"src",
			"clipboardview.html",
		);
		const clipboardHtmlContent = fs.readFileSync(
			clipboardHtmlPath.fsPath,
			"utf8",
		);
		webviewView.webview.html = clipboardHtmlContent;

		// If we have a dotGraph when the view is created, send it
		if (this._currentDotGraph) {
			if (this._view) {
				this._view.webview.postMessage({
					type: "updateDotGraph",
					dotGraph: this._currentDotGraph,
					dotGraphByCluster: this._currentDotGraphByCluster,
				});
			}
		}

		webviewView.webview.onDidReceiveMessage(async (message) => {
			console.log("Extension [ClipboardProviderreceived message:", message);
			switch (message.type) {
				case "UPDATE_SELECTED_NODES":
					this.updateSelectedNodes(
						message.payload.selectedNodes,
						message.payload.connectedNodes,
					);
					break;
				case "sendMessage":
					await webviewView.webview.postMessage({
						type: "receiveMessage",
						content: `Echo: ${message.message}`,
					});
					break;
			}
		});
	}
}

// Get git diff content for a file or folder
async function getGitDiffContent(
	uri: vscode.Uri,
	isVaultAnalysis: boolean = false,
): Promise<string | undefined> {
	try {
		console.log("uri", uri);
		const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
		if (!gitExtension) {
			throw new Error("Git extension not found");
		}

		const git = gitExtension.getAPI(1);
		const repository = git.repositories.find((repo: { rootUri: vscode.Uri }) =>
			uri.fsPath.startsWith(repo.rootUri.fsPath),
		);

		if (!repository) {
			throw new Error("No git repository found for this path");
		}

		// Use empty string for vault analysis to get all changes, otherwise use relative path
		const relativePath = isVaultAnalysis
			? ""
			: vscode.workspace.asRelativePath(uri);

		console.log("Getting changes for:", relativePath || "entire repository");

		// Get repository state which contains the working tree changes
		const state = repository.state;

		// Get all changes (including working tree and index)
		const changes = [
			...(state.workingTreeChanges || []),
			...(state.indexChanges || []),
		];

		// Check if we're dealing with a directory
		const stats = await vscode.workspace.fs.stat(uri);
		const isDirectory = stats.type === vscode.FileType.Directory;

		// Filter changes for our specific file/folder
		const relevantChanges = changes.filter((change) => {
			const changePath = vscode.workspace.asRelativePath(change.uri);
			if (isDirectory && !isVaultAnalysis) {
				return changePath.startsWith(relativePath);
			}
			if (isDirectory && isVaultAnalysis) {
				return !changePath.startsWith(".");
			} else {
				return changePath === relativePath;
			}
		});

		console.log("Relevant changes found:", relevantChanges.length);

		if (relevantChanges.length === 0) {
			return undefined; // No changes found is a valid state
		}

		// Combine all relevant diffs
		let diffContent = "";
		for (const change of relevantChanges) {
			try {
				const changePath = vscode.workspace.asRelativePath(change.uri);
				console.log(
					"Processing change for:",
					changePath,
					"Status:",
					change.status,
				);

				let newLines = "";
				let rawDiff = "";
				if (change.status === 1 || change.status === 7) {
					// For new files, get the entire content
					const fileContent = await vscode.workspace.fs.readFile(change.uri);
					newLines = new TextDecoder().decode(fileContent);
				} else {
					// For modified files, get the diff
					rawDiff = await repository.diffWithHEAD(changePath);
				}

				const addedLines = rawDiff
					? rawDiff
							.split("\n")
							.filter(
								(line: any) =>
									line.startsWith("+") &&
									!line.startsWith("+++") &&
									!line.startsWith("@@"),
							)
							.map((line: any) => line.substring(1))
							.join("\n")
					: newLines;

				if (!addedLines || addedLines.trim() === "") continue;

				diffContent += addedLines + "\n\n";

				//  console.log('diffContent', diffContent)
			} catch (error) {
				console.error("Error processing change:", error);
				continue;
			}
		}
		// console.log('diffContent', diffContent)
		return diffContent;
	} catch (error) {
		console.error("Error getting git diff:", error);
		return undefined;
	}
}
