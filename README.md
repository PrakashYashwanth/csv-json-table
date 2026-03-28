# CSV JSON Table Editor

A VS Code extension for editing large CSV files with inline JSON cell editing and virtual scrolling.

## Features

- **Table View**: View CSV files in a clean, interactive table format
- **JSON Cell Editing**: Double-click JSON cells to edit them in a Monaco editor with syntax highlighting
- **Virtual Scrolling**: Handles large CSV files (1000+ rows) efficiently
- **Filtering & Sorting**: Filter columns and sort by clicking headers
- **Inline Editing**: Edit regular cells inline
- **Undo/Redo**: Full undo/redo support (Cmd/Ctrl+Z)
- **Auto-sync**: File watcher detects external changes
- **Dark/Light Theme**: Automatically matches your VS Code theme

## Usage

1. Right-click any `.csv` file in the Explorer
2. Select **"Open CSV as Config Table"**
3. Edit cells:
   - **Double-click** any cell to edit
   - **JSON cells** open in a full Monaco editor
   - **Enter** to save, **Esc** to cancel
4. **Cmd/Ctrl+S** to save changes to disk

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | Save CSV file |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Enter` | Commit inline edit |
| `Esc` | Cancel edit / Close JSON editor |
| `Cmd/Ctrl+Enter` | Apply JSON edit (in Monaco) |

## Development

### Setup

```bash
npm install
npm run compile
```

### Build

```bash
npm run compile          # Build extension + webview
npm run compile:ext      # Build extension only
npm run compile:webview  # Build webview only
npm run watch            # Watch extension
npm run watch:webview    # Watch webview
```

### Test

1. Press `F5` to open Extension Development Host
2. Open `test-large.csv` (3500 rows generated automatically)
3. Right-click → "Open CSV as Config Table"

## Architecture

```
src/
├── extension.ts              # Entry point
├── host/                     # Extension host (Node.js)
│   ├── PanelManager.ts      # Webview lifecycle
│   ├── StateManager.ts      # State synchronization
│   ├── FileSyncService.ts   # File watching
│   └── MessageHandler.ts    # Message routing
├── services/                 # Pure business logic
│   ├── CsvParser.ts         # CSV parsing
│   └── JsonValidator.ts     # JSON detection
├── webview/                  # Webview (browser)
│   ├── main.ts              # Entry point
│   ├── models/              # View models
│   └── components/          # UI components
└── shared/                   # Shared types
    ├── types.ts
    ├── messages.ts
    └── jsonColumns.ts

media/
├── index.html               # Webview HTML template
├── main.css                 # Styles
└── webview.js               # Bundled webview code (generated)
```

## Performance

- **Virtual scrolling**: Only renders visible rows (~50 DOM nodes for 10,000+ rows)
- **Efficient updates**: Only re-renders changed cells
- **Lazy JSON detection**: Cached column type detection

## Requirements

- VS Code 1.80.0 or higher

## Known Issues

- Very wide CSVs (100+ columns) may have horizontal scroll performance issues
- Monaco editor loads from CDN (requires internet connection)

## License

MIT
