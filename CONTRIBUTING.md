# Contributing to CSV JSON Table

Thank you for your interest in contributing! We welcome all kinds of contributions.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- VS Code (v1.80.0 or higher)

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/PrakashYashwanth/csv-json-table.git
   cd csv-json-table
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Compile the project:

   ```bash
   npm run compile
   ```

4. Open in VS Code:
   ```bash
   code .
   ```

## Development Workflow

### Building

- **Build once:** `npm run compile`
- **Watch mode:** `npm run watch` (for extension code)
- **Watch webview:** `npm run watch:webview` (for UI code)

### Testing Your Changes

1. Open the project in VS Code
2. Press `F5` to launch the extension in debug mode
3. Open a `.csv` file and test the functionality

### Code Structure

```
src/
├── extension.ts          # Extension entry point
├── host/                 # VS Code integration
├── services/             # CSV/JSON processing
├── shared/               # Shared types & messages
└── webview/              # WebView UI components
```

## Contribution Guidelines

### Types of Contributions

We appreciate all kinds of contributions:

- **Bug Reports:** Open an issue describing the problem
- **Feature Requests:** Share your ideas in GitHub discussions
- **Code Contributions:** Submit pull requests with improvements
- **Documentation:** Help improve READMEs and comments
- **Testing:** Report edge cases and help testing features

### Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Commit with clear messages: `git commit -m "Add feature description"`
5. Push to your fork: `git push origin feature/your-feature-name`
6. Open a Pull Request with a clear description

### Commit Message Guidelines

Follow conventional commits:

- `feat: Add new feature`
- `fix: Fix a bug`
- `docs: Update documentation`
- `refactor: Code refactoring`
- `test: Add or update tests`

### Code Style

- Use TypeScript for type safety
- Follow existing code patterns in the repository
- Format code with reasonable indentation
- Add comments for complex logic

## Reporting Issues

When reporting a bug, please include:

- **Description:** What happened?
- **Steps to reproduce:** How can we replicate it?
- **Expected behavior:** What should happen?
- **Actual behavior:** What actually happened?
- **Environment:** OS, VS Code version, extension version

## Questions?

Feel free to open a discussion or issue if you have questions!

---

**Thank you for contributing to CSV JSON Table! 🎉**
