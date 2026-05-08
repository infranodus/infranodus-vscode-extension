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

type GraphAiAdviceRequestMode =
	| "question"
	| "develop"
	| "summary"
	| "graph summary";

function getResponseErrorMessage(data: unknown): string | undefined {
	if (!data) {
		return undefined;
	}

	if (typeof data === "string") {
		return data;
	}

	if (typeof data !== "object") {
		return String(data);
	}

	const responseData = data as { message?: unknown; error?: unknown };
	if (typeof responseData.message === "string") {
		return responseData.message;
	}

	if (typeof responseData.error === "string") {
		return responseData.error;
	}

	if (responseData.error) {
		try {
			return JSON.stringify(responseData.error);
		} catch {
			return String(responseData.error);
		}
	}

	try {
		return JSON.stringify(data);
	} catch {
		return undefined;
	}
}

function getInfraNodusRequestErrorMessage(error: unknown): string {
	if (!axios.isAxiosError(error)) {
		if (error instanceof Error) {
			return error.message || "Unknown error";
		}

		return String(error ?? "Unknown error");
	}

	const requestUrl = error.config?.url || "the configured InfraNodus API URL";
	const responseMessage = getResponseErrorMessage(error.response?.data);

	if (error.response) {
		const statusText = error.response.statusText
			? ` ${error.response.statusText}`
			: "";
		return [
			`InfraNodus API returned ${error.response.status}${statusText}`,
			responseMessage,
		]
			.filter(Boolean)
			.join(": ");
	}

	if (error.code === "ECONNREFUSED") {
		return `Cannot connect to InfraNodus at ${requestUrl}. Make sure the InfraNodus service is running and the API URL setting is correct.`;
	}

	if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
		return `The request to InfraNodus timed out at ${requestUrl}. Make sure the service is running and reachable.`;
	}

	if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
		return `Cannot resolve the InfraNodus API host for ${requestUrl}. Check the API URL setting and your network connection.`;
	}

	if (error.request) {
		return `Cannot reach InfraNodus at ${requestUrl}: ${error.message}. Make sure the service is running and reachable.`;
	}

	return error.message || "Unknown InfraNodus API error";
}

function logInfraNodusRequestError(error: unknown) {
	if (axios.isAxiosError(error)) {
		console.error("InfraNodus API request failed:", {
			status: error.response?.status,
			statusText: error.response?.statusText,
			code: error.code,
			message: error.message,
			data: error.response?.data,
			config: {
				url: error.config?.url,
				method: error.config?.method,
			},
		});
		return;
	}

	console.error("InfraNodus request failed:", error);
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
					await vscode.workspace
						.getConfiguration("infranodus-graph-view")
						.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
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
					const diffFileName = uri?.path.split("/").pop() || documentName;

					const diffContentToProcess = provider._processTextForAnalysis(
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

					const diffContentToProcess = provider._processTextForAnalysis(
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
	private _lastSearchPattern: string = "";
	private _lastFilesToInclude: string = "";

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

	public getModelToUse(): string {
		const config = vscode.workspace.getConfiguration("infranodus-graph-view");
		return config.get("modelToUse") || "gpt-5.4";
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
				case "openSettings":
					vscode.commands.executeCommand(
						"workbench.action.openSettings",
						"@ext:infranodus.infranodus-graph-view",
					);
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
					// Dual-shape contract: when the graph emits a v1+ meta envelope,
					// trust meta.action. Selection state was already propagated via
					// UPDATE_SELECTED_NODES / UPDATE_GROUPS before EXTERNAL_ACTION
					// arrived (microtask-sequenced graph-side), so the existing
					// _clipboardProvider getters return the correct values.
					const externalActionMeta = message.payload?.meta;
					const rawActionMessage =
						externalActionMeta && externalActionMeta.version >= 1
							? externalActionMeta.action
							: message.payload?.action;
					const actionMessage =
						rawActionMessage === "summarize" &&
						externalActionMeta?.scope === "graph_topics"
							? "graph summary"
							: rawActionMessage;
					console.log(
						"[InfraNodus] processExternalAction received:",
						actionMessage,
						externalActionMeta ? { meta: externalActionMeta } : "",
					);

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
						actionMessage != "graph summary" &&
						actionMessage != "chat" &&
						actionMessage != "context" &&
						actionMessage != "context_gap"
					)
						break;

					const statements = this._clipboardProvider.getCurrentStatements();
					// Prefer the meta envelope's nodes/topics when present — it
					// reflects the selection (manual or auto) at click time and
					// avoids races with UPDATE_SELECTED_NODES propagation. Fall
					// back to clipboard-provider state for legacy hosts.
					const metaIsV1 =
						externalActionMeta && externalActionMeta.version >= 1;
					const selectedWords: string[] = metaIsV1
						? Array.isArray(externalActionMeta.nodes)
							? externalActionMeta.nodes.map(String)
							: []
						: this._clipboardProvider.getSelectedNodes();
					const selectedClusters: string[] = metaIsV1
						? Array.isArray(externalActionMeta.topics)
							? externalActionMeta.topics.map(String)
							: []
						: this._clipboardProvider.getSelectedClusters();

					const filesToInclude = this.generateCurrentUrl();

					if (actionMessage == "context" || actionMessage == "context_gap") {
						const currentContent = this._clipboardProvider.getCurrentContent();
						this._view?.webview.postMessage({
							command: "showAnalyzedContext",
							contextText: currentContent,
						});

						if (!currentContent) {
							vscode.window.showInformationMessage(
								"No analyzed context available yet. Analyze a document first.",
							);
						}

						break;
					}

					let statementsToUse: string[] = [];
					let pendingSearchPattern = "";

					if (selectedWords.length == 0 && selectedClusters.length == 0) {
						// No selection means no targeted file search. Keep the prompt
						// graph-based, but do not create a huge all-statements query.
						statementsToUse = [];
					}

					if (selectedWords.length > 0) {
						pendingSearchPattern =
							this.generateSearchPatternFromArray(selectedWords);

						statementsToUse = statements
							.filter((statement: any) =>
								selectedWords.some((word: string) =>
									statement.content.toLowerCase().includes(word.toLowerCase()),
								),
							)
							.map((statement: any) => statement.content);
					}

					if (selectedClusters.length > 0 && selectedWords.length == 0) {
						statementsToUse =
							actionMessage == "summarize" ||
							actionMessage == "graph summary" ||
							actionMessage == "context"
								? this.getAllStatementsOfTopics({
										statements,
										selectedTopics: selectedClusters,
									})
								: this.getTopStatementsOfTopics({
										statements,
										selectedTopics: selectedClusters,
									});
						pendingSearchPattern =
							this.generateSearchPatternFromArray(statementsToUse);
					}

					this._lastSearchPattern = pendingSearchPattern;
					this._lastFilesToInclude = filesToInclude;
					console.log("[InfraNodus] AI action prepared", {
						action: actionMessage,
						selectedWords: selectedWords.length,
						selectedClusters: selectedClusters.length,
						statementsToUse: statementsToUse.length,
						hasGraph: !!this._clipboardProvider.getCurrentGraph(),
						viewExists: !!this._view,
					});

					setTimeout(() => {
						// Build a selection-scoped DOT graph from the meta-derived
						// selection so the prompt matches what the user has highlighted
						// (concepts subgraph / topic clusters / full graph if nothing).
						// Topic names (AI-generated where available) are passed in so
						// each cluster is rendered as `Topic Name:\n<edge list>`.
						const allTopicNames = this._clipboardProvider.getTopicNames();
						const topicNamesById = new Map<string, string>(
							allTopicNames.map((t) => [String(t.id), t.name]),
						);
						console.log("[InfraNodus] topic-name map", {
							action: actionMessage,
							selectedClusters,
							topicCount: allTopicNames.length,
							sample: allTopicNames.slice(0, 5),
						});
						const graphToUse = this._clipboardProvider.buildScopedDotGraph({
							nodes: selectedWords,
							topics: selectedClusters,
							topicNamesById,
						});
						const contentToUse = statementsToUse.join("\n\n");
						console.log("[InfraNodus] AI action posting prompt", {
							action: actionMessage,
							hasGraph: !!graphToUse,
							viewExists: !!this._view,
						});
						if (graphToUse) {
							const adviceRequestId = `${Date.now()}-${actionMessage}`;
							const prefix = this.generatePrefix(actionMessage);
							// Topic-name labelling: include AI-generated topic names
							// (or fallback) when topics are involved — either an
							// explicit cluster selection, or the whole-graph
							// "graph summary" action which targets all topics.
							let contentWithPrefix = `${prefix}\n\n${graphToUse}`;
							if (contentToUse) {
								contentWithPrefix += `\n\nAnd take this context into account:\n\n${contentToUse}`;
							}
							vscode.env.clipboard.writeText(contentWithPrefix);

							this._clipboardProvider.appendPromptLog({
								action: actionMessage,
								prompt: contentWithPrefix,
							});

							this._view?.webview.postMessage({
								command: "showPrompt",
								action: actionMessage,
								label: this.getActionLabel(actionMessage),
								prompt: contentWithPrefix,
								canFindInFiles: !!pendingSearchPattern,
								adviceRequestId,
								isAdviceLoading:
									!!this.getGraphAiAdviceRequestMode(actionMessage),
								modelToUse: this.getModelToUse(),
							});

							vscode.window.showInformationMessage(
								"Copied AI prompt with the graph structure to clipboard. See the InfraNodus Log view for details.",
							);

							const requestMode =
								this.getGraphAiAdviceRequestMode(actionMessage);
							if (requestMode) {
								void this.requestGraphAiAdvice({
									action: actionMessage,
									adviceRequestId,
									requestMode,
									prompt: contentWithPrefix,
									promptContext: contentToUse,
									pinnedNodes: selectedWords,
									topicsToProcess: selectedClusters,
								});
							}
						}
					}, 500);

					break;
				case "findInFiles":
					if (this._lastSearchPattern) {
						await this.executeFileSearch({
							searchPattern: this._lastSearchPattern,
							filesToInclude:
								this._lastFilesToInclude || this.generateCurrentUrl(),
						});
					} else {
						vscode.window.showInformationMessage(
							"Nothing to search for. Trigger an AI action on the graph first.",
						);
					}
					return;
				case "exportAnalyzedContextToInfraNodus":
					await this.exportAnalyzedContextToInfraNodus();
					return;
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
			"graph summary":"promptSummary",
			chat: "promptChat",
			context: "promptContext",
			context_gap: "promptContextGap",
		};
		const settingKey = settingsMap[action];
		if (settingKey) {
			const fromConfig = config.get<string>(settingKey);
			if (fromConfig) return fromConfig;
		}
		// Fallback prefix for chat — produces a prompt the user can paste into
		// any external chat agent. No backend `requestMode` is registered for
		// chat, so this path stops at clipboard + showPrompt.
		if (action === "chat") {
			return "Use the graph and context below to start a discussion. Answer follow-up questions referring to the graph structure when relevant.";
		}
		return "";
	}

	public getActionLabel(action: string): string {
		const labelMap: Record<string, string> = {
			question: "Question",
			develop: "Idea",
			summarize: "Summary",
			"graph summary":"Graph Summary",
			chat: "Chat",
			context: "Context",
			context_gap: "Context Gap",
		};
		return labelMap[action] || action;
	}

	private getGraphAiAdviceRequestMode(
		action: string,
	): GraphAiAdviceRequestMode | undefined {
		const requestModeMap: Record<string, GraphAiAdviceRequestMode> = {
			question: "question",
			develop: "develop",
			summarize: "summary",
			"graph summary":"graph summary",
		};
		return requestModeMap[action];
	}

	private async requestGraphAiAdvice({
		action,
		adviceRequestId,
		requestMode,
		prompt,
		promptContext,
		pinnedNodes,
		topicsToProcess,
	}: {
		action: string;
		adviceRequestId: string;
		requestMode: GraphAiAdviceRequestMode;
		prompt: string;
		promptContext: string;
		pinnedNodes: string[];
		topicsToProcess: string[];
	}) {
		const graph = this._clipboardProvider.getCurrentGraphObject();
		const statements = this._clipboardProvider.getCurrentStatementsObject();

		if (!graph?.nodes || !graph?.edges || !graph?.attributes) {
			this._view?.webview.postMessage({
				command: "showGraphAiAdviceError",
				adviceRequestId,
				error:
					"No Graphology graph is available yet. Analyze a document first.",
			});
			vscode.window.showWarningMessage(
				"InfraNodus could not request AI advice: no Graphology graph is available yet.",
			);
			return;
		}

		const apiKey = await this.getApiKey();
		if (!apiKey) {
			this._view?.webview.postMessage({
				command: "showGraphAiAdviceError",
				adviceRequestId,
				error: "Please set your API key first.",
			});
			vscode.window.showErrorMessage("Please set your API key first");
			return;
		}

		const formattedApiKey = apiKey.startsWith("Bearer ")
			? apiKey
			: `Bearer ${apiKey}`;

		try {
			const response = await axios.post(
				`${this.getServerUrl()}/api/v1/graphAiAdvice`,
				{
					prompt,
					userPrompt: prompt ? [{ role: "user", content: prompt }] : [],
					promptContext,
					promptChatContext: [],
					requestMode,
					modelToUse: this.getModelToUse(),
					pinnedNodes,
					topicsToProcess,
					graph,
					statements,
				},
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

			if (response.data?.error) {
				const errorText =
					typeof response.data.error === "string"
						? response.data.error
						: JSON.stringify(response.data.error);
				throw new Error(errorText);
			}

			this._clipboardProvider.updateGraphAiAdvice({
				action,
				requestMode,
				response: response.data,
			});
			this._view?.webview.postMessage({
				command: "showGraphAiAdvice",
				adviceRequestId,
				responses: this.formatGraphAiAdviceResponses(response.data),
			});
		} catch (error) {
			const message = getInfraNodusRequestErrorMessage(error);
			logInfraNodusRequestError(error);
			this._view?.webview.postMessage({
				command: "showGraphAiAdviceError",
				adviceRequestId,
				error: message,
			});
			vscode.window.showWarningMessage(
				`Could not generate InfraNodus AI advice: ${message}`,
			);
		}
	}

	private formatGraphAiAdviceResponses(data: any): string[] {
		const aiAdvice = data?.aiAdvice;
		if (Array.isArray(aiAdvice)) {
			const adviceTexts = aiAdvice
				.map((advice) => {
					if (typeof advice === "string") {
						return advice;
					}
					return advice?.text || advice?.content || "";
				})
				.filter(Boolean);

			if (adviceTexts.length > 0) {
				return adviceTexts;
			}
		}

		if (typeof aiAdvice === "string") {
			return [aiAdvice];
		}

		return [JSON.stringify(data, null, 2)];
	}

	public async getApiKey(): Promise<string | undefined> {
		const configuredApiKey = vscode.workspace
			.getConfiguration("infranodus-graph-view")
			.get<string>("apiKey")
			?.trim();

		return (
			configuredApiKey ||
			(await this._context.secrets.get("infranodus-api-key"))
		);
	}

	public async exportAnalyzedContextToInfraNodus() {
		const text = this._clipboardProvider.getCurrentContent();
		if (!text) {
			vscode.window.showInformationMessage(
				"No analyzed context available yet. Analyze a document first.",
			);
			return;
		}

		const graphName = await vscode.window.showInputBox({
			prompt: "Enter the InfraNodus graph name to save this context",
			placeHolder: "my-vscode-context",
			value:
				this._clipboardProvider.getCurrentUrl()?.split(/[\\/]/).pop() ||
				"vscode-context",
			ignoreFocusOut: true,
		});

		if (!graphName) {
			return;
		}

		const apiKey = await this.getApiKey();
		if (!apiKey) {
			vscode.window.showErrorMessage("Please set your API key first");
			return;
		}

		const formattedApiKey = apiKey.startsWith("Bearer ")
			? apiKey
			: `Bearer ${apiKey}`;

		const textRequest = {
			name: graphName,
			text,
			aiTopics: true,
			stopwords: this.getInfraNodusStopwords(),
			contextSettings: {
				partOfSpeechToProcess: this.getPartOfSpeechToProcess(),
				doubleSquarebracketsProcessing: "PROCESS_AS_HASHTAGS",
				mentionsProcessing: "CONNECT_TO_ALL_CONCEPTS",
			},
		};

		try {
			this._view?.webview.postMessage({ command: "showLoading" });
			const response = await axios.post(
				`${this.getServerUrl()}/api/v1/graphAndStatements?doNotSave=false&addstats=true&contextName=${encodeURIComponent(graphName)}`,
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

			if (response.data?.error) {
				const errorText =
					typeof response.data.error === "string"
						? response.data.error
						: JSON.stringify(response.data.error);
				throw new Error(errorText);
			}

			vscode.window.showInformationMessage(
				`Analyzed context exported to InfraNodus graph "${graphName}".`,
			);
		} catch (error) {
			const message = getInfraNodusRequestErrorMessage(error);
			if (axios.isAxiosError(error)) {
				vscode.window.showErrorMessage(
					`Could not export context to InfraNodus: ${message}`,
				);
				logInfraNodusRequestError(error);
				return;
			}
			logInfraNodusRequestError(error);
			vscode.window.showErrorMessage(
				`Could not export context to InfraNodus: ${message}`,
			);
		} finally {
			this._view?.webview.postMessage({ command: "hideLoading" });
		}
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

			const apiKey = await this.getApiKey();
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
				const errorText =
					typeof response.data.error === "string"
						? response.data.error
						: JSON.stringify(response.data.error);
				if (errorText.includes("log in")) {
					vscode.window.showInformationMessage(
						`Please, add your InfraNodus API key in the extension settings.`,
					);
					return;
				}
				console.warn(
					"[InfraNodus] API returned an error, keeping previous graph:",
					errorText,
				);
				vscode.window.showWarningMessage(
					`InfraNodus could not refresh the graph: ${errorText}. Using the last successful analysis.`,
				);
				return;
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

				const graphObject = response.data.entriesAndGraphOfContext.graph;
				const statementsObject =
					response.data.entriesAndGraphOfContext.statements ?? [];
				this._clipboardProvider.updateGraphAndStatements({
					graph: graphObject,
					statements: statementsObject,
				});

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
				const message = getInfraNodusRequestErrorMessage(error);
				logInfraNodusRequestError(error);
				vscode.window.showErrorMessage(
					`Error processing the document: ${message}`,
				);
			} else {
				const message = getInfraNodusRequestErrorMessage(error);
				logInfraNodusRequestError(error);
				vscode.window.showErrorMessage(
					"Error processing the document: " + message,
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

			const apiKey = await this.getApiKey();
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
				const errorText =
					typeof response.data.error === "string"
						? response.data.error
						: JSON.stringify(response.data.error);
				if (errorText.includes("log in")) {
					vscode.window.showInformationMessage(
						`Please, add your InfraNodus API key in the extension settings.`,
					);
					return;
				}
				console.warn(
					"[InfraNodus] API returned an error, keeping previous graph:",
					errorText,
				);
				vscode.window.showWarningMessage(
					`InfraNodus could not refresh the graph: ${errorText}. Using the last successful analysis.`,
				);
				if (this._view) {
					this._view.webview.postMessage({ type: "PROCESSING_COMPLETE" });
				}
				return;
			}

			if (
				response.data &&
				response.data.entriesAndGraphOfContext &&
				response.data.entriesAndGraphOfContext.graph
			) {
				this._clipboardProvider.updateCurrentContent(content);

				const graphObject = response.data.entriesAndGraphOfContext.graph;
				const statementsObject =
					response.data.entriesAndGraphOfContext.statements ?? [];
				this._clipboardProvider.updateGraphAndStatements({
					graph: graphObject,
					statements: statementsObject,
				});

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
			const message = getInfraNodusRequestErrorMessage(error);
			logInfraNodusRequestError(error);
			if (this._view) {
				this._view.webview.postMessage({
					type: "PROCESSING_ERROR",
					error: message,
				});
			}
			vscode.window.showErrorMessage("Error processing content: " + message);
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

		if (["md", "txt", "rst", "adoc", "org", "wiki", "log"].includes(ext)) {
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
		const docstrings = text.match(/"{3}[\s\S]*?"{3}|'{3}[\s\S]*?'{3}/g) || [];
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
		const wikilinks = [...new Set(text.match(/\[\[[^\]]+\]\]/g) || [])];
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

		const apiKey = await this.getApiKey();
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
	private _currentGraphObject: any = {};
	private _currentStatementsObject: any[] = [];
	private _currentGraphAiAdvice: any = {};
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

	public appendPromptLog({
		action,
		prompt,
	}: {
		action: string;
		prompt: string;
	}) {
		const labelMap: Record<string, string> = {
			question: "Question",
			develop: "Idea",
			summarize: "Summary",
			"graph summary":"Graph Summary",
			context: "Context",
			context_gap: "Context Gap",
		};
		const label = labelMap[action] || action;

		if (this._view) {
			this._view.webview.postMessage({
				type: "addPromptLog",
				action,
				label,
				prompt,
				timestamp: Date.now(),
			});
		}
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

	// Pure scoped-DOT builder driven by an explicit selection (e.g. from
	// the EXTERNAL_ACTION meta envelope). Does not mutate state and does
	// not depend on _selectedNodes / _selectedClusters propagation.
	//   - topics-only selection  → keep clusters whose key is in `topics`
	//   - nodes selection        → keep cluster lines mentioning any node
	//   - nothing selected       → full original DOT (all clusters)
	// When topicNamesById is provided, each cluster is prefixed with its
	// topic name as a header line so the AI sees `Topic Name:` before the
	// edge list of that cluster.
	public buildScopedDotGraph({
		nodes,
		topics,
		topicNamesById,
	}: {
		nodes: string[];
		topics: string[];
		topicNamesById?: Map<string, string>;
	}): string {
		const fullDot = this._currentDotGraph;
		if (!this._currentDotGraphByCluster) return fullDot;

		const labelCluster = (key: string, lines: string[]): string => {
			const name = topicNamesById?.get(String(key));
			return name ? `${name}:\n${lines.join("\n")}` : lines.join("\n");
		};

		const allKeys = Object.keys(this._currentDotGraphByCluster);

		if (nodes.length === 0 && topics.length > 0) {
			const topicSet = new Set(topics.map(String));
			const matched = allKeys
				.filter((key) => topicSet.has(String(key)))
				.filter((key) => Array.isArray(this._currentDotGraphByCluster![key]))
				.map((key) =>
					labelCluster(key, this._currentDotGraphByCluster![key] as string[]),
				);
			const dot = matched.join("\n\n");
			return dot || fullDot;
		}

		if (nodes.length > 0) {
			const containsAny = (line: string): boolean =>
				nodes.some((n) => n && line.includes(n));
			const labelledClusters: string[] = [];
			allKeys.forEach((key) => {
				const cluster = this._currentDotGraphByCluster![key];
				if (!Array.isArray(cluster)) return;
				const filtered = (cluster as string[]).filter((line) =>
					containsAny(line),
				);
				if (filtered.length > 0) {
					labelledClusters.push(labelCluster(key, filtered));
				}
			});
			const dot = labelledClusters.join("\n\n");
			return dot || fullDot;
		}

		// No selection → full graph, but still label each cluster so the
		// AI can attribute edges to topics in the prompt.
		const labelledFull = allKeys
			.filter((key) => Array.isArray(this._currentDotGraphByCluster![key]))
			.map((key) =>
				labelCluster(key, this._currentDotGraphByCluster![key] as string[]),
			)
			.join("\n\n");
		return labelledFull || fullDot;
	}

	public updateGraphAndStatements({
		graph,
		statements,
	}: {
		graph: any;
		statements: any[];
	}) {
		const graphObject = graph?.graphologyGraph || graph;

		this._currentGraphObject = graphObject;
		this._currentStatementsObject = statements;

		this._context.globalState.update("InfraNodus Graph Object", graphObject);
		this._context.globalState.update(
			"InfraNodus Statements Object",
			statements,
		);
	}

	public getCurrentGraphObject(): any {
		return this._currentGraphObject;
	}

	// Returns [{ id, name }] for clusters in the current graph, preferring
	// the InfraNodus AI-generated `aiName` and falling back to the top three
	// node names (matches the LOAD_JSON topicNames mapping).
	public getTopicNames(): Array<{ id: string; name: string }> {
		const topClusters =
			this._currentGraphObject?.attributes?.top_clusters || [];
		if (!Array.isArray(topClusters)) return [];
		return topClusters
			.map((topic: any) => {
				if (topic?.aiName) {
					const name = String(topic.aiName).split(". ").pop() || topic.aiName;
					return { id: String(topic.community), name };
				}
				const fallback = (topic?.nodes || [])
					.map((node: any) => node?.nodeName)
					.filter(Boolean)
					.slice(0, 3)
					.join(" ");
				if (!fallback) return null;
				return { id: String(topic?.community), name: fallback };
			})
			.filter(Boolean) as Array<{ id: string; name: string }>;
	}

	public getCurrentStatementsObject(): any[] {
		return this._currentStatements.length > 0
			? this._currentStatements
			: this._currentStatementsObject;
	}

	public updateGraphAiAdvice({
		action,
		requestMode,
		response,
	}: {
		action: string;
		requestMode: GraphAiAdviceRequestMode;
		response: any;
	}) {
		this._currentGraphAiAdvice = {
			action,
			requestMode,
			response,
		};

		this._context.globalState.update(
			"InfraNodus Graph AI Advice",
			this._currentGraphAiAdvice,
		);
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
		this._currentStatementsObject = this._currentStatements;

		// Store in global state
		this._context.globalState.update(
			"InfraNodus Statements",
			this._currentStatements,
		);
		this._context.globalState.update(
			"InfraNodus Statements Object",
			this._currentStatementsObject,
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
