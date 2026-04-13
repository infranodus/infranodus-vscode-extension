# InfraNodus Graph View VSCode / Cursor AI Extension

This VSCode / Cursor AI / Antigravity extension adds a view to the Secondary Side Bar (or wherever else you prefer in your IDE) that displays the [InfraNodus graph visualization](https://infranodus.com). It allows you to use the graph to **visualize the text in markdown files, find connections, identify the main topics, and reveal the gaps** in your content.

![InfraNodus Graph Word Search](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-word-search.gif)

Use it with your **Obsidian vault**, to **optimize your website content**, or in the **[Karpathy's LLM Wiki setup](https://support.noduslabs.com/hc/en-us/articles/26724863249180-Supercharging-LLM-Wiki-with-Knowledge-Graphs-Build-a-Self-Evolving-Research-System)** to get a holistic view of the main topical clusters and ideas in your content as well as to reveal the blind spots that you can bridge with new ideas.

Another powerful use case is to use the graph to steer model's reasoning using the graph prompts it generates. For instance, you can select the clusters that are not linked yet (`content gap`) and generate an AI prompt that helps model generate a response that would link the clusters and bridge the gap between them.

_Note, some people use this extension with their code bases as well, but at the moment it works best on markdown and html files as primarily it's best for text analysis._

## Features

- Displays InfraNodus graph in VSCode's Secondary Side Bar (or in Cursor's AI agent bar)

- Use it on individual files or folders

![InfraNodus Graph View VSCode Extension](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension.png)

- Embedded web view with the InfraNodus graph interface

- AI-powered topic modeling of your content

- Can visualize the diff between files / folders / project

- Use the graph interface to search for relevant content and topics

![InfraNodus Graph Word Search](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-topic-search.gif)

- Can be used to detect gaps between content blocks

![InfraNodus Graph Word Search](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-gap-analysis.gif)

- Click the AI buttons to copy the relevant content and paste it into your favorite AI co-pilot (e.g. Cursor AI, Windsurf AI, GitHub Copilot, etc.)

![InfraNodus AI Chat](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-ai.gif)

- Has an InfraNodus Log view (which you can put next to Terminal) with compressed graph / selection data that you can paste to your LLM (via Claude Code or Cursor) in order to improve the quality of the output.

## Requirements

- You can use this extension with VSCode 1.84.0, Antigravity IDE, Windsurf AI, Cursor AI

- You can open your Obsidian vault in any of the editors above and

- You need an InfraNodus account to use this extension. You can sign up for a free trial at [https://infranodus.com](https://infranodus.com) and then obtain the key at the [InfraNodus API Access Page](https://infranodus.com/api-access).

## Notes

- This extension is a work in progress and is currently in alpha. We are working on adding more features and optimizing the user experience. For feedback, please, open an issue on [Github](https://github.com/infranodus/infranodus-vscode-extension/issues).

- We recommend that you use it on Obsidian vault and in LLM wiki setups. While some people use this extension on codebases, it does not yet capture all the complexity of connections between the functions. However, you can use it to get a general overview of connections between the functions and variables in a certain folder.

## How to Use

0. Install the extension via the Extensions marketplace or manually (see instructions below for manual installation)
1. Open VSCode's Secondary Side Bar (View -> Secondary Side Bar)
2. Look for "InfraNodus Graph" view
3. Get the API key at [https://infranodus.com/api-access](https://infranodus.com/api-access) and add it using the Key button in the graph window (bottom left) or using Cmd + Shift + P > InfraNodus API key menu in IDE's preferences
4. You might want to move the InfraNodus graph view elsewhere. Right click the extension's icon and choose the new location for it.
5. The graph should load automatically in the view for the currently active file. Click the Reload button if the graph doesn't load.
6. Right-click on a file or folder to open it in the InfraNodus Graph view
7. Open the InfraNodus Log in terminal (using commands Cmd+Shift+P -> InfraNodus Graph: Open InfraNodus Log)
8. Use commands (Cmd+Shift+P -> InfraNodus Graph: Paste (Selected) Graph in a File) to copy the (selected) graph data to a file — this is useful for using with AI co-pilot chatbots
9. Use the features outlined above to navigate and search through your content using the graph
10. Use the AI buttons to generate a prompt in the InfraNodus Log view and then copy it to your favorite LLM chat (e.g. Claude Code, GitHub Copilot, Codeium, Continue, Antigravity, Cascade in Windsurf AI)
11. You can customize the prompts generated when you click on the graph's AI and context buttons in the extension's settings.
12. You can also customize the type of processing. For instance, by default the extension will prioritize [[wiki links]] and #hashtags to words, but will also include single words if there are no [[wiki links]] in your text. You might want to choose to process [[wiki links]] only in the settings.
13. You can add "stopwords" in the settings: the words and terms that the graph should not process. Useful for auxiliary terms and function names.

## Recommended Tools

- You will need an [InfraNodus](https://infranodus.com) account to use this extension
- We also recommend to install the [InfraNodus MCP Server](https://infranodus.com/mcp) to your IDE as your agents can then automatically generate and retrieve graph insights directly during your LLM interactions.
- This extension can still be useful as you can see what's happening under the hood and, in some instances, use a visual interface to steer your LLM's reasoning

## Manual Installation

1. Get the InfraNodus Graph View `.vsix` file from the [releases](https://github.com/infranodus/infranodus-vscode-extension/releases) page
2. Open VS Code
3. Press Ctrl+Shift+P (Windows/Linux) or Cmd+Shift+P (Mac)
4. Type `Extensions: Install from VSIX`
5. Select the .vsix file you downloaded
6. Press Enter
7. Verify installation by clicking the Extensions icon in the sidebar and checking the InfraNodus Graph View extension
8. Activate the extension (if it hasn't been done already)
9. Add your InfraNodus API key (using commands Cmd+Shift+P -> InfraNodus Graph: Set API Key or using the Key button at the top left of the InfraNodus Graph View.
10. You might need to reload the extension or your VSCode

## Installation for Developers

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `vsce package` to build the extension
4. This will create a .vsix file in your project directory
5. Open VS Code
6. Follow the steps in the Manual Installation section above

## Updates

1. Check the [releases](https://github.com/infranodus/infranodus-vscode-extension/releases) page for new versions
2. Reinstall the extension
3. Add your InfraNodus API key again
