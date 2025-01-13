# InfraNodus Graph View VSCode Extension

This VSCode extension adds a view to the Secondary Side Bar that displays the [InfraNodus graph visualization](https://infranodus.com). It allows you to use the graph to visualize text and markdown files, find connections, identify the main topics, and reveal the gaps in content. 


## Features

- Displays InfraNodus graph in VSCode's Secondary Side Bar

- Use it on individual files or folders

![InfraNodus Graph View VSCode Extension](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension.png)

- Embedded web view with the InfraNodus graph interface

- AI-powered topic modeling of your content

![InfraNodus Graph Word Search](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-word-search.gif)

- Can visualize the diff between files / folders / project

- Use the graph interface to search for relevant content and topics

![InfraNodus Graph Word Search](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-topic-search.gif)

- Can be used to detect gaps between content blocks

![InfraNodus Graph Word Search](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-gap-analysis.gif)

- Click the AI buttons to copy the relevant content and paste it into your favorite AI co-pilot (e.g. Cursor AI, Windsurf AI, GitHub Copilot, etc.)

![InfraNodus AI Chat](https://github.com/infranodus/infranodus-vscode-extension/raw/HEAD/resources/infranodus-extension-ai.gif)

- Has an InfraNodus Log view with compressed graph data for your AI models



## Requirements

- You can use this extension with VSCode 1.84.0, Windsurf AI, Cursor AI

- You can open your Obsidian vault in any of the editors above and 

- You need an InfraNodus account to use this extension. You can sign up for a free trial at [https://infranodus.com](https://infranodus.com) and then obtain the key at the [InfraNodus API Access Page](https://infranodus.com/api-access).


## Notes

- This extension is a work in progress and is currently in alpha. We are working on adding more features and optimizing the user experience. For feedback, please, open an issue on [Github](https://github.com/infranodus/infranodus-vscode-extension/issues)


## Usage

1. Open VSCode's Secondary Side Bar (View -> Secondary Side Bar)
2. Look for "InfraNodus Graph" view
3. The graph should load automatically in the view for the currently active file 
4. Right-click on a file or folder to open it in the InfraNodus Graph view
5. Open the InfraNodus Log in terminal (using commands Cmd+Shift+P -> InfraNodus Graph: Open InfraNodus Log)
6. Use commands (Cmd+Shift+P -> InfraNodus Graph: Paste (Selected) Graph in a File) to copy the (selected) graph data to a file — this is useful for using with AI co-pilot chatbots
7. Use the features outlined above to navigate and search through your content using the graph
8. Use the AI buttons to generate a prompt and then copy it to your favorite AI chat (e.g. GitHub Copilot, Codeium, Continue, Cascade in Windsurf AI)




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
