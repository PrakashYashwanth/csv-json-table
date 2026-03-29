# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- JSON schema validation per column
- Advanced search (including inside JSON)
- Bulk editing & transformations
- Column typing & validation
- Diff view for CSV changes
- Multi-file workspace support
- Custom theming options

## [0.1.1] - 2026-03-29

### Changed

- Updated display name to "CSV Config Table" for better clarity

## [0.1.0] - 2026-03-29

### Added

- **Row Addition**: Add new rows via button or Ctrl+N keyboard shortcut
- **Multi-row Selection**: Checkbox column for selecting multiple rows at once
- **Batch Deletion**: Delete selected rows with delete button; supports Ctrl+Z undo
- **File Control**: Save button for explicit file persistence and Revert button to reload from disk
- **Visual Improvements**: Subtle column alternation styling for better readability (no extension dependency required)
- **Enhanced Footer**: Action buttons for add row, delete selected, save, and revert operations

## [0.0.1] - 2026-03-29

### Added

- Initial release of CSV JSON Table extension
- Fast & virtualized table rendering for large CSV files
- JSON-aware cell editing with Monaco editor
- Spreadsheet-like editing experience
- File sync and persistence
- Undo / Redo support
- Context menu integration with CSV files

### Added

- Initial alpha release
- Core CSV editing functionality
- JSON cell support
- Virtualized rendering for performance

[Unreleased]: https://github.com/PrakashYashwanth/csv-json-table/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/PrakashYashwanth/csv-json-table/releases/tag/v0.0.1
