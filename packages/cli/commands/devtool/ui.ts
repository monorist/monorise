export const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Monorise Devtool</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">M</div>
          <div>
            <strong>Monorise</strong>
            <span>Devtool</span>
          </div>
        </div>
        <div class="sidebar-label">Entities</div>
        <nav id="entity-nav" aria-label="Entity types"></nav>
        <div class="sidebar-footer">
          <span class="status-dot"></span>
          <span id="api-label">Loading configuration…</span>
        </div>
      </aside>

      <main>
        <header class="page-header">
          <div>
            <div class="eyebrow">Entity browser</div>
            <h1 id="page-title">Select an entity</h1>
            <p id="page-description">Browse and manage your local development data.</p>
          </div>
          <div class="header-actions">
            <div class="connection-controls">
              <label>
                <span>Stage</span>
                <select id="stage-select" aria-label="SST stage"></select>
              </label>
              <label>
                <span>API key</span>
                <select id="key-select" aria-label="Scoped API key"></select>
              </label>
            </div>
            <button id="refresh-button" class="button button-secondary" type="button">
              <span aria-hidden="true">↻</span> Refresh
            </button>
            <p id="connection-warning" class="connection-warning" hidden></p>
          </div>
        </header>

        <section id="content" class="content" hidden>
          <div class="metrics">
            <div class="metric">
              <span>Results</span>
              <strong id="result-count">—</strong>
            </div>
            <div class="metric">
              <span>Search</span>
              <strong id="search-status">Unavailable</strong>
            </div>
            <div class="metric">
              <span>Unique fields</span>
              <strong id="unique-count">0</strong>
            </div>
          </div>

          <div class="panel">
            <div class="toolbar">
              <div class="listing-tools">
                <label class="listing-mode">
                  <span>View</span>
                  <select id="listing-mode" aria-label="Entity listing mode"></select>
                </label>
                <form id="search-form" class="search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    id="search-input"
                    type="search"
                    autocomplete="off"
                    placeholder="Search entities"
                    aria-label="Search entities"
                  />
                </form>
              </div>
              <div class="toolbar-actions">
                <button id="clear-search" class="button button-ghost" type="button" hidden>
                  Clear search
                </button>
                <button id="create-button" class="button button-primary" type="button">
                  <span aria-hidden="true">＋</span> Create
                </button>
              </div>
            </div>

            <form id="tag-filter-form" class="tag-filters" hidden>
              <label>
                <span>Group</span>
                <input id="tag-group" autocomplete="off" placeholder="Exact group" />
              </label>
              <label>
                <span>Sort prefix</span>
                <input id="tag-query" autocomplete="off" placeholder="Starts with" />
              </label>
              <label>
                <span>Sort from</span>
                <input id="tag-start" autocomplete="off" placeholder="Inclusive" />
              </label>
              <label>
                <span>Sort to</span>
                <input id="tag-end" autocomplete="off" placeholder="Inclusive" />
              </label>
              <div class="tag-filter-actions">
                <button class="button button-primary" type="submit">Apply tag</button>
                <button id="clear-tag" class="button button-ghost" type="button">Clear</button>
              </div>
              <p>Provide a group, a sort prefix, or a sort range. A prefix cannot be combined with a range.</p>
            </form>

            <div id="notice" class="notice" hidden></div>
            <div id="loading" class="loading" hidden>
              <div class="spinner"></div>
              <span>Loading entities…</span>
            </div>
            <div id="empty" class="empty" hidden>
              <div class="empty-icon">{ }</div>
              <h2>No entities found</h2>
              <p id="empty-message">Create the first record for this entity type.</p>
            </div>

            <div id="table-wrap" class="table-wrap" hidden>
              <table>
                <thead id="table-head"></thead>
                <tbody id="table-body"></tbody>
              </table>
            </div>

            <div id="pagination" class="pagination" hidden>
              <span id="page-label">Page 1</span>
              <div>
                <button id="previous-button" class="button button-secondary" type="button">
                  Previous
                </button>
                <button id="next-button" class="button button-secondary" type="button">
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="welcome" class="welcome">
          <div class="welcome-mark">M</div>
          <h2>Your data, without the console hopping.</h2>
          <p>Select an entity type to list, search, create, edit, or delete its records.</p>
        </section>
      </main>
    </div>

    <dialog id="editor-dialog">
      <form id="editor-form" method="dialog">
        <div class="dialog-header">
          <div>
            <div id="dialog-eyebrow" class="eyebrow">Create entity</div>
            <h2 id="dialog-title">New entity</h2>
          </div>
          <button class="icon-button" value="cancel" aria-label="Close editor" type="submit">×</button>
        </div>
        <div class="dialog-body">
          <div class="editor-column">
            <label for="json-editor">Entity data (JSON)</label>
            <textarea id="json-editor" spellcheck="false" aria-describedby="editor-help"></textarea>
            <p id="editor-help">Only send the fields you want to store or update.</p>
            <div id="editor-error" class="editor-error" hidden></div>
          </div>
          <aside class="field-reference">
            <div class="field-reference-title">Schema reference</div>
            <p class="field-reference-help">
              Select a field name to add it to the JSON.
            </p>
            <div id="field-list"></div>
          </aside>
        </div>
        <div class="dialog-footer">
          <button class="button button-secondary" value="cancel" type="submit">Cancel</button>
          <button id="save-button" class="button button-primary" type="button">Create entity</button>
        </div>
      </form>
    </dialog>

    <dialog id="mutual-dialog" class="mutual-dialog">
      <div class="dialog-header">
        <div>
          <div class="eyebrow">Mutual relationships</div>
          <h2 id="mutual-title">Entity mutuals</h2>
        </div>
        <button id="mutual-close" class="icon-button" aria-label="Close mutuals" type="button">×</button>
      </div>
      <div class="mutual-toolbar">
        <label>
          <span>Related entity</span>
          <select id="mutual-target" aria-label="Related entity type"></select>
        </label>
        <div class="mutual-toolbar-actions">
          <button id="mutual-create" class="button button-primary" type="button">
            <span aria-hidden="true">＋</span> Create mutual
          </button>
          <button id="mutual-refresh" class="button button-secondary" type="button">
            <span aria-hidden="true">↻</span> Refresh
          </button>
        </div>
      </div>
      <div id="mutual-notice" class="notice" hidden></div>
      <div id="mutual-loading" class="loading" hidden>
        <div class="spinner"></div>
        <span>Loading mutuals…</span>
      </div>
      <div id="mutual-empty" class="empty" hidden>
        <div class="empty-icon">↔</div>
        <h2>No mutuals found</h2>
        <p>This entity has no relationships to the selected entity type.</p>
      </div>
      <div id="mutual-table-wrap" class="table-wrap" hidden>
        <table>
          <thead>
            <tr>
              <th>Entity ID</th>
              <th>Entity data</th>
              <th>Mutual data</th>
              <th>Updated</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody id="mutual-table-body"></tbody>
        </table>
      </div>
      <div id="mutual-pagination" class="pagination" hidden>
        <span id="mutual-page-label">Page 1</span>
        <div>
          <button id="mutual-previous" class="button button-secondary" type="button">Previous</button>
          <button id="mutual-next" class="button button-secondary" type="button">Next</button>
        </div>
      </div>
    </dialog>

    <dialog id="mutual-editor-dialog">
      <form id="mutual-editor-form" method="dialog">
        <div class="dialog-header">
          <div>
            <div id="mutual-editor-eyebrow" class="eyebrow">Create mutual</div>
            <h2 id="mutual-editor-title">New mutual relationship</h2>
          </div>
          <button class="icon-button" value="cancel" aria-label="Close mutual editor" type="submit">×</button>
        </div>
        <div class="dialog-body">
          <div class="editor-column">
            <label for="mutual-entity-id">Related entity ID</label>
            <input id="mutual-entity-id" class="dialog-input" autocomplete="off" />
            <label for="mutual-json-editor">Mutual data (JSON)</label>
            <textarea id="mutual-json-editor" class="json-editor" spellcheck="false"></textarea>
            <p class="editor-help">This data belongs to the relationship, not either entity.</p>
            <div id="mutual-editor-error" class="editor-error" hidden></div>
          </div>
          <aside class="field-reference">
            <div class="field-reference-title">Mutual data schema</div>
            <p class="field-reference-help">
              Select a field name to add it to the JSON.
            </p>
            <div id="mutual-field-list" class="field-list"></div>
          </aside>
        </div>
        <div class="dialog-footer">
          <button class="button button-secondary" value="cancel" type="submit">Cancel</button>
          <button id="mutual-save" class="button button-primary" type="button">Create mutual</button>
        </div>
      </form>
    </dialog>

    <dialog id="manual-connection-dialog" class="manual-connection-dialog">
      <form id="manual-connection-form">
        <div class="dialog-header">
          <div>
            <div class="eyebrow">Connection</div>
            <h2>Manual Core connection</h2>
          </div>
          <button id="manual-connection-close" class="icon-button" aria-label="Close manual connection" type="button">×</button>
        </div>
        <div class="manual-connection-body">
          <label for="manual-api-url">Monorise Core URL</label>
          <input
            id="manual-api-url"
            class="dialog-input"
            type="url"
            autocomplete="off"
            placeholder="https://example.execute-api.us-east-1.amazonaws.com"
            required
          />
          <label for="manual-api-key">API key <span>(optional)</span></label>
          <input
            id="manual-api-key"
            class="dialog-input"
            type="password"
            autocomplete="new-password"
            placeholder="Paste an API key"
          />
          <p class="connection-note">
            The key is sent only to this local devtool process, held in memory,
            and never returned to or stored by the browser.
          </p>
          <div id="manual-connection-error" class="editor-error" hidden></div>
        </div>
        <div class="dialog-footer">
          <button id="manual-connection-cancel" class="button button-secondary" type="button">Cancel</button>
          <button id="manual-connection-save" class="button button-primary" type="submit">Connect</button>
        </div>
      </form>
    </dialog>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <script src="/app.js" type="module"></script>
  </body>
</html>`;

export const STYLES_CSS = `
:root {
  --bg: #090b0d;
  --panel: #111417;
  --panel-soft: #15191d;
  --line: #252a2f;
  --line-bright: #353c43;
  --text: #f2f5f7;
  --muted: #8d969f;
  --accent: #d5ff47;
  --accent-strong: #bfe935;
  --accent-ink: #151b00;
  --danger: #ff6b6b;
  --danger-soft: rgba(255, 107, 107, 0.1);
  --radius: 14px;
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  color: var(--text);
  background:
    radial-gradient(circle at 75% -15%, rgba(213, 255, 71, 0.08), transparent 30rem),
    var(--bg);
  font-family: var(--sans);
  font-size: 14px;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  color: inherit;
}

.app-shell {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 28px 18px 20px;
  border-right: 1px solid var(--line);
  background: rgba(12, 14, 16, 0.94);
  backdrop-filter: blur(16px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 8px 32px;
}

.brand-mark,
.welcome-mark {
  display: grid;
  place-items: center;
  color: var(--accent-ink);
  background: var(--accent);
  font-weight: 900;
  transform: rotate(-4deg);
}

.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
}

.brand strong,
.brand span {
  display: block;
}

.brand strong {
  letter-spacing: -0.02em;
}

.brand span {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
}

.sidebar-label,
.eyebrow {
  color: var(--muted);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.sidebar-label {
  padding: 0 10px 9px;
}

#entity-nav {
  display: grid;
  gap: 4px;
  overflow-y: auto;
}

.entity-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 9px;
  color: #aeb6bd;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: 140ms ease;
}

.entity-link:hover {
  color: var(--text);
  background: var(--panel-soft);
}

.entity-link.active {
  color: var(--text);
  border-color: #333a3f;
  background: #1b2024;
  box-shadow: inset 3px 0 var(--accent);
}

.entity-link code {
  color: #687078;
  font-family: var(--mono);
  font-size: 10px;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: auto;
  padding: 14px 9px 0;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
}

.sidebar-footer span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px rgba(213, 255, 71, 0.5);
}

main {
  min-width: 0;
  padding: 46px clamp(24px, 5vw, 76px) 70px;
}

.page-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  max-width: 1320px;
  margin: 0 auto 30px;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin: 7px 0 6px;
  font-size: clamp(30px, 4vw, 46px);
  line-height: 1;
  letter-spacing: -0.045em;
}

.page-header p,
.welcome p {
  margin-bottom: 0;
  color: var(--muted);
}

.header-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
  width: min(620px, 58%);
}

.connection-controls {
  display: grid;
  grid-template-columns: minmax(120px, 0.8fr) minmax(180px, 1.2fr);
  gap: 8px;
}

.connection-controls label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.connection-controls label > span {
  color: var(--muted);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.connection-controls select {
  width: 100%;
  min-height: 38px;
  padding: 0 32px 0 10px;
  overflow: hidden;
  border: 1px solid var(--line-bright);
  border-radius: 8px;
  outline: 0;
  color: #dce1e5;
  background: var(--panel-soft);
  text-overflow: ellipsis;
}

.connection-controls select:focus {
  border-color: #69742f;
  box-shadow: 0 0 0 3px rgba(213, 255, 71, 0.07);
}

.connection-controls select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.connection-warning {
  grid-column: 1 / -1;
  margin: 2px 0 0;
  color: #e5c47a !important;
  font-size: 10px;
  text-align: right;
}

.content {
  max-width: 1320px;
  margin: 0 auto;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.metric {
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(17, 20, 23, 0.72);
}

.metric span,
.metric strong {
  display: block;
}

.metric span {
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 11px;
}

.metric strong {
  overflow: hidden;
  font-family: var(--mono);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.22);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--line);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.listing-tools {
  display: flex;
  align-items: end;
  gap: 8px;
  width: min(720px, 68%);
}

.listing-mode {
  display: grid;
  flex: 0 0 190px;
  gap: 5px;
}

.listing-mode > span,
.tag-filters label > span,
.mutual-toolbar label > span {
  color: var(--muted);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.listing-mode select,
.tag-filters input,
.mutual-toolbar select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--line-bright);
  border-radius: 8px;
  outline: 0;
  color: #dce1e5;
  background: #0d1012;
}

.listing-mode select:focus,
.tag-filters input:focus,
.mutual-toolbar select:focus {
  border-color: #69742f;
  box-shadow: 0 0 0 3px rgba(213, 255, 71, 0.07);
}

.search {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 180px;
  border: 1px solid var(--line-bright);
  border-radius: 9px;
  background: #0d1012;
}

.search:focus-within {
  border-color: #69742f;
  box-shadow: 0 0 0 3px rgba(213, 255, 71, 0.07);
}

.search span {
  padding-left: 12px;
  color: var(--muted);
  font-size: 18px;
}

.search input {
  width: 100%;
  padding: 10px;
  border: 0;
  outline: 0;
  color: var(--text);
  background: transparent;
}

.search input::placeholder {
  color: #646c73;
}

.search.disabled {
  opacity: 0.45;
}

.tag-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr)) auto;
  align-items: end;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid var(--line);
  background: #0d1012;
}

.tag-filters label {
  display: grid;
  gap: 5px;
}

.tag-filters input {
  width: 100%;
}

.tag-filter-actions {
  display: flex;
  gap: 4px;
}

.tag-filters > p {
  grid-column: 1 / -1;
  margin: 0;
  color: #737d84;
  font-size: 10px;
}

.button,
.icon-button {
  border: 0;
  cursor: pointer;
  font-weight: 700;
  transition: 130ms ease;
}

.button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
}

.button:hover {
  transform: translateY(-1px);
}

.button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  transform: none;
}

.button-primary {
  color: var(--accent-ink);
  background: var(--accent);
}

.button-primary:hover {
  background: var(--accent-strong);
}

.button-secondary {
  border: 1px solid var(--line-bright);
  color: #c7cdd2;
  background: var(--panel-soft);
}

.button-secondary:hover {
  border-color: #4a535b;
  color: var(--text);
}

.button-ghost {
  color: var(--muted);
  background: transparent;
}

.button-ghost:hover {
  color: var(--text);
  background: var(--panel-soft);
}

.notice {
  margin: 14px;
  padding: 11px 13px;
  border: 1px solid rgba(255, 107, 107, 0.35);
  border-radius: 8px;
  color: #ffabab;
  background: var(--danger-soft);
}

.loading,
.empty,
.welcome {
  display: grid;
  justify-items: center;
  text-align: center;
}

.loading {
  grid-auto-flow: column;
  justify-content: center;
  gap: 10px;
  padding: 72px 20px;
  color: var(--muted);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #394047;
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty {
  padding: 76px 20px;
}

.empty-icon {
  margin-bottom: 16px;
  color: #626b72;
  font-family: var(--mono);
  font-size: 28px;
}

.empty h2 {
  margin-bottom: 7px;
  font-size: 17px;
}

.empty p {
  margin-bottom: 0;
  color: var(--muted);
  font-size: 13px;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 13px 16px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

th {
  color: #717a82;
  background: #0e1113;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

td {
  max-width: 280px;
  overflow: hidden;
  color: #c5cbd0;
  font-size: 12px;
  text-overflow: ellipsis;
}

tbody tr {
  transition: 120ms ease;
}

tbody tr:hover {
  background: #151a1e;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.id-cell {
  color: #9ba3aa;
  font-family: var(--mono);
  font-size: 11px;
}

.date-cell {
  color: #7d868e;
  font-family: var(--mono);
  font-size: 10px;
}

.json-cell {
  min-width: 220px;
  max-width: 420px;
  color: #aeb8a1;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}

.row-actions {
  display: flex;
  justify-content: end;
  gap: 5px;
}

.row-action {
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
}

.row-action:hover {
  border-color: var(--line-bright);
  color: var(--text);
  background: var(--panel-soft);
}

.row-action.danger:hover {
  border-color: rgba(255, 107, 107, 0.35);
  color: #ff9696;
  background: var(--danger-soft);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
}

.pagination div {
  display: flex;
  gap: 7px;
}

.welcome {
  max-width: 560px;
  margin: 16vh auto 0;
}

.welcome-mark {
  width: 62px;
  height: 62px;
  margin-bottom: 26px;
  border-radius: 16px;
  font-size: 25px;
  box-shadow: 0 18px 50px rgba(213, 255, 71, 0.12);
}

.welcome h2 {
  margin-bottom: 10px;
  font-size: clamp(25px, 4vw, 38px);
  letter-spacing: -0.04em;
}

dialog {
  width: min(940px, calc(100vw - 32px));
  max-height: calc(100vh - 42px);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line-bright);
  border-radius: 16px;
  color: var(--text);
  background: #111518;
  box-shadow: 0 32px 100px rgba(0, 0, 0, 0.72);
}

dialog::backdrop {
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
}

.dialog-header,
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 17px 20px;
}

.mutual-dialog {
  width: min(1120px, calc(100vw - 32px));
}

.mutual-toolbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: #0d1012;
}

.mutual-toolbar label {
  display: grid;
  gap: 5px;
  width: min(360px, 70%);
}

.mutual-toolbar-actions {
  display: flex;
  gap: 8px;
}

.mutual-dialog .table-wrap {
  max-height: min(520px, calc(100vh - 260px));
  overflow: auto;
}

.mutual-dialog .empty,
.mutual-dialog .loading {
  min-height: 280px;
}

.dialog-header {
  border-bottom: 1px solid var(--line);
}

.dialog-header h2 {
  margin: 4px 0 0;
  font-size: 21px;
  letter-spacing: -0.025em;
}

.icon-button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  font-size: 22px;
}

.icon-button:hover {
  color: var(--text);
  background: var(--panel-soft);
}

.dialog-body {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(250px, 0.75fr);
  height: min(560px, calc(100vh - 190px));
  min-height: 0;
  max-height: calc(100vh - 190px);
}

.editor-column,
.field-reference {
  padding: 20px;
  overflow-y: auto;
}

.editor-column {
  display: flex;
  flex-direction: column;
}

.editor-column label,
.field-reference-title {
  margin-bottom: 9px;
  font-size: 11px;
  font-weight: 750;
}

.field-reference-help {
  margin: -3px 0 12px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.45;
}

#json-editor,
.json-editor {
  flex: 1;
  width: 100%;
  min-height: 330px;
  resize: vertical;
  padding: 16px;
  border: 1px solid var(--line-bright);
  border-radius: 10px;
  outline: 0;
  color: #dce6c2;
  background: #090c0e;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.65;
  tab-size: 2;
}

#json-editor:focus,
.json-editor:focus {
  border-color: #69742f;
  box-shadow: 0 0 0 3px rgba(213, 255, 71, 0.07);
}

#editor-help,
.editor-help {
  margin: 9px 0 0;
  color: var(--muted);
  font-size: 11px;
}

.editor-error {
  margin-top: 10px;
  color: #ff9696;
  font-size: 12px;
}

.field-reference {
  min-height: 0;
  border-left: 1px solid var(--line);
  background: #0d1012;
  overscroll-behavior: contain;
}

#field-list,
.field-list {
  display: grid;
  gap: 7px;
}

.dialog-input {
  width: 100%;
  min-height: 40px;
  margin-bottom: 16px;
  padding: 0 12px;
  border: 1px solid var(--line-bright);
  border-radius: 8px;
  outline: 0;
  color: var(--text);
  background: #090c0e;
  font-family: var(--mono);
}

.dialog-input:focus {
  border-color: #69742f;
  box-shadow: 0 0 0 3px rgba(213, 255, 71, 0.07);
}

.dialog-input:disabled {
  opacity: 0.55;
}

.manual-connection-dialog {
  width: min(560px, calc(100vw - 32px));
}

.manual-connection-body {
  display: grid;
  padding: 22px 20px;
}

.manual-connection-body label {
  margin-bottom: 7px;
  font-size: 11px;
  font-weight: 750;
}

.manual-connection-body label span {
  color: var(--muted);
  font-weight: 500;
}

.manual-connection-body .dialog-input {
  margin-bottom: 18px;
}

.connection-note {
  margin: -2px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.field {
  padding: 10px;
  border: 1px solid #22282d;
  border-radius: 8px;
  background: #111518;
}

.field-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.field-insert {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0;
  border: 0;
  border-radius: 2px;
  outline: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.field-insert:hover code,
.field-insert:focus-visible code {
  color: var(--accent);
}

.field-insert:focus-visible {
  box-shadow: 0 0 0 2px rgba(213, 255, 71, 0.28);
}

.field-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}

.field code {
  overflow: hidden;
  color: #e1e6e9;
  font-family: var(--mono);
  font-size: 11px;
  text-overflow: ellipsis;
}

.field-type {
  color: #7f8a92;
  font-family: var(--mono);
  font-size: 9px;
  text-align: right;
}

.timestamp-button {
  padding: 0;
  border: 0;
  color: #7f8a92;
  background: transparent;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 8px;
}

.timestamp-button:hover,
.timestamp-button:focus-visible {
  color: var(--accent);
}

.field-meta {
  display: flex;
  gap: 6px;
  margin-top: 7px;
}

.badge {
  padding: 2px 5px;
  border-radius: 4px;
  color: #89929a;
  background: #20262b;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.badge.required {
  color: var(--accent-ink);
  background: var(--accent);
}

.badge.relationship {
  color: #b8acf4;
  background: #292340;
}

.badge.unique {
  color: #9fd8ff;
  background: #183044;
}

.field-description {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.45;
}

.dialog-footer {
  justify-content: end;
  gap: 8px;
  border-top: 1px solid var(--line);
}

.toast {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 10;
  max-width: min(380px, calc(100vw - 44px));
  padding: 12px 15px;
  border: 1px solid #3e4931;
  border-radius: 9px;
  color: #e9f6c9;
  background: #1c2415;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: 180ms ease;
}

.toast.visible {
  opacity: 1;
  transform: translateY(0);
}

.toast.error {
  border-color: #5d3030;
  color: #ffc3c3;
  background: #2a1717;
}

[hidden] {
  display: none !important;
}

@media (max-width: 820px) {
  .app-shell {
    display: block;
  }

  .sidebar {
    position: relative;
    height: auto;
    padding: 16px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .brand {
    padding: 0 0 14px;
  }

  .sidebar-label,
  .sidebar-footer {
    display: none;
  }

  #entity-nav {
    display: flex;
    overflow-x: auto;
  }

  .entity-link {
    flex: 0 0 auto;
    width: auto;
  }

  .entity-link code {
    display: none;
  }

  main {
    padding: 28px 16px 50px;
  }

  .page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
  }

  .connection-controls {
    grid-template-columns: 1fr;
  }

  .connection-warning {
    text-align: left;
  }

  .metrics {
    grid-template-columns: 1fr;
  }

  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .search {
    width: 100%;
  }

  .listing-tools {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }

  .listing-mode {
    flex-basis: auto;
  }

  .tag-filters {
    grid-template-columns: 1fr 1fr;
  }

  .tag-filter-actions,
  .tag-filters > p {
    grid-column: 1 / -1;
  }

  .toolbar-actions {
    justify-content: end;
  }

  .dialog-body {
    display: block;
    overflow-y: auto;
  }

  .editor-column,
  .field-reference {
    overflow: visible;
  }

  .field-reference {
    border-top: 1px solid var(--line);
    border-left: 0;
  }

  .mutual-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .mutual-toolbar label {
    width: 100%;
  }

  .mutual-toolbar-actions {
    justify-content: end;
  }
}
`;

export const APP_JS = `
const MANUAL_STAGE_ID = 'manual';

const state = {
  meta: null,
  entity: null,
  items: [],
  currentCursor: null,
  nextCursor: null,
  cursorHistory: [],
  query: '',
  tagName: null,
  tagFilters: { group: '', query: '', start: '', end: '' },
  tagApplied: false,
  totalCount: 0,
  editorMode: 'create',
  editingId: null,
  connectionBusy: false,
  entityBusy: false,
  connectionVersion: 0,
  mutualSourceId: null,
  mutualTarget: null,
  mutualItems: [],
  mutualCurrentCursor: null,
  mutualNextCursor: null,
  mutualCursorHistory: [],
  mutualBusy: false,
  mutualEditorMode: 'create',
  mutualEditingId: null,
};

const elements = {
  entityNav: document.querySelector('#entity-nav'),
  apiLabel: document.querySelector('#api-label'),
  content: document.querySelector('#content'),
  welcome: document.querySelector('#welcome'),
  pageTitle: document.querySelector('#page-title'),
  pageDescription: document.querySelector('#page-description'),
  stage: document.querySelector('#stage-select'),
  key: document.querySelector('#key-select'),
  connectionWarning: document.querySelector('#connection-warning'),
  refresh: document.querySelector('#refresh-button'),
  resultCount: document.querySelector('#result-count'),
  searchStatus: document.querySelector('#search-status'),
  uniqueCount: document.querySelector('#unique-count'),
  listingMode: document.querySelector('#listing-mode'),
  searchForm: document.querySelector('#search-form'),
  searchInput: document.querySelector('#search-input'),
  clearSearch: document.querySelector('#clear-search'),
  create: document.querySelector('#create-button'),
  tagFilterForm: document.querySelector('#tag-filter-form'),
  tagGroup: document.querySelector('#tag-group'),
  tagQuery: document.querySelector('#tag-query'),
  tagStart: document.querySelector('#tag-start'),
  tagEnd: document.querySelector('#tag-end'),
  clearTag: document.querySelector('#clear-tag'),
  notice: document.querySelector('#notice'),
  loading: document.querySelector('#loading'),
  empty: document.querySelector('#empty'),
  emptyMessage: document.querySelector('#empty-message'),
  tableWrap: document.querySelector('#table-wrap'),
  tableHead: document.querySelector('#table-head'),
  tableBody: document.querySelector('#table-body'),
  pagination: document.querySelector('#pagination'),
  pageLabel: document.querySelector('#page-label'),
  previous: document.querySelector('#previous-button'),
  next: document.querySelector('#next-button'),
  dialog: document.querySelector('#editor-dialog'),
  dialogEyebrow: document.querySelector('#dialog-eyebrow'),
  dialogTitle: document.querySelector('#dialog-title'),
  jsonEditor: document.querySelector('#json-editor'),
  editorError: document.querySelector('#editor-error'),
  fieldList: document.querySelector('#field-list'),
  save: document.querySelector('#save-button'),
  mutualDialog: document.querySelector('#mutual-dialog'),
  mutualTitle: document.querySelector('#mutual-title'),
  mutualClose: document.querySelector('#mutual-close'),
  mutualTarget: document.querySelector('#mutual-target'),
  mutualCreate: document.querySelector('#mutual-create'),
  mutualRefresh: document.querySelector('#mutual-refresh'),
  mutualNotice: document.querySelector('#mutual-notice'),
  mutualLoading: document.querySelector('#mutual-loading'),
  mutualEmpty: document.querySelector('#mutual-empty'),
  mutualTableWrap: document.querySelector('#mutual-table-wrap'),
  mutualTableBody: document.querySelector('#mutual-table-body'),
  mutualPagination: document.querySelector('#mutual-pagination'),
  mutualPageLabel: document.querySelector('#mutual-page-label'),
  mutualPrevious: document.querySelector('#mutual-previous'),
  mutualNext: document.querySelector('#mutual-next'),
  mutualEditorDialog: document.querySelector('#mutual-editor-dialog'),
  mutualEditorEyebrow: document.querySelector('#mutual-editor-eyebrow'),
  mutualEditorTitle: document.querySelector('#mutual-editor-title'),
  mutualEntityId: document.querySelector('#mutual-entity-id'),
  mutualJsonEditor: document.querySelector('#mutual-json-editor'),
  mutualEditorError: document.querySelector('#mutual-editor-error'),
  mutualFieldList: document.querySelector('#mutual-field-list'),
  mutualSave: document.querySelector('#mutual-save'),
  manualDialog: document.querySelector('#manual-connection-dialog'),
  manualForm: document.querySelector('#manual-connection-form'),
  manualClose: document.querySelector('#manual-connection-close'),
  manualCancel: document.querySelector('#manual-connection-cancel'),
  manualApiUrl: document.querySelector('#manual-api-url'),
  manualApiKey: document.querySelector('#manual-api-key'),
  manualError: document.querySelector('#manual-connection-error'),
  manualSave: document.querySelector('#manual-connection-save'),
  toast: document.querySelector('#toast'),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function plural(value, singular) {
  return value === 1 ? singular : singular + 's';
}

function showToast(message, isError) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', Boolean(isError));
  elements.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(
    () => elements.toast.classList.remove('visible'),
    3200,
  );
}

function errorMessage(payload, response) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload.message === 'string') return payload.message;
  if (payload && payload.details && payload.details.fieldErrors) {
    const fieldErrors = Object.entries(payload.details.fieldErrors)
      .filter((entry) => Array.isArray(entry[1]) && entry[1].length)
      .map((entry) => entry[0] + ': ' + entry[1].join(', '));
    if (fieldErrors.length) return fieldErrors.join('\\n');
  }
  return 'Request failed with status ' + response.status;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json')
    ? await response.json()
    : await response.text();
  if (!response.ok) throw new Error(errorMessage(payload, response));
  return payload;
}

function renderNavigation() {
  elements.entityNav.innerHTML = state.meta.entities
    .map(
      (entity) =>
        '<button class="entity-link" type="button" data-entity="' +
        escapeHtml(entity.name) +
        '"><span>' +
        escapeHtml(entity.displayName) +
        '</span><code>' +
        escapeHtml(entity.name) +
        '</code></button>',
    )
    .join('');
}

function renderConnection() {
  const connection = state.meta.connection;
  elements.stage.innerHTML = state.meta.stages
    .map(
      (stage) =>
        '<option value="' +
        escapeHtml(stage.id) +
        '">' +
        escapeHtml(stage.label) +
        '</option>',
    )
    .join('') +
    '<option value="' +
    MANUAL_STAGE_ID +
    '">Manual connection…</option>';
  elements.stage.value = connection.stageId;
  elements.key.innerHTML = connection.keys.length
    ? connection.keys
        .map(
          (key) =>
            '<option value="' +
            escapeHtml(key.id) +
            '">' +
            escapeHtml(key.label) +
            '</option>',
        )
        .join('')
    : '<option value="">No usable keys</option>';
  elements.key.value = connection.keyId || '';
  elements.stage.disabled = state.connectionBusy;
  elements.key.disabled = state.connectionBusy || connection.keys.length === 0;
  elements.apiLabel.textContent = connection.apiUrl;
  elements.connectionWarning.textContent = connection.warning || '';
  elements.connectionWarning.hidden = !connection.warning;
}

function selectedEntity() {
  return state.meta.entities.find((entity) => entity.name === state.entity);
}

function entityByName(name) {
  return state.meta.entities.find((entity) => entity.name === name);
}

function mutualTargets(entity) {
  const targets = new Set((entity.mutuals || []).map((mutual) => mutual.entityType));
  state.meta.entities.forEach((candidate) => {
    if (
      (candidate.mutuals || []).some(
        (mutual) => mutual.entityType === entity.name,
      )
    ) {
      targets.add(candidate.name);
    }
  });
  return [...targets]
    .map(entityByName)
    .filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function mutualDescriptor(entity, targetType) {
  const direct = (entity.mutuals || []).find(
    (mutual) => mutual.entityType === targetType,
  );
  const target = entityByName(targetType);
  const reverse = target
    ? (target.mutuals || []).find(
        (mutual) => mutual.entityType === entity.name,
      )
    : null;
  return (
    [direct, reverse].find(
      (mutual) =>
        mutual &&
        ((mutual.dataFields || []).length ||
          Object.keys(mutual.createTemplate || {}).length),
    ) ||
    direct ||
    reverse || {
      entityType: targetType,
      fields: [],
      dataFields: [],
      createTemplate: {},
    }
  );
}

function renderListingControls() {
  const entity = selectedEntity();
  elements.listingMode.innerHTML =
    '<option value="">All entities</option>' +
    (entity.tags || [])
      .map(
        (tag) =>
          '<option value="' +
          escapeHtml(tag) +
          '">Tag · ' +
          escapeHtml(tag) +
          '</option>',
      )
      .join('');
  elements.listingMode.value = state.tagName || '';
  elements.tagFilterForm.hidden = !state.tagName;
  elements.searchForm.hidden = Boolean(state.tagName);
  elements.clearSearch.hidden = Boolean(state.tagName) || !state.query;
  elements.searchInput.disabled = !entity.searchable || Boolean(state.tagName);
  elements.searchForm.classList.toggle(
    'disabled',
    !entity.searchable || Boolean(state.tagName),
  );
  elements.searchStatus.textContent = state.tagName
    ? 'Tag · ' + state.tagName
    : entity.searchable
      ? entity.searchFields.join(', ')
      : 'Unavailable';
}

function setBusy(isBusy) {
  state.entityBusy = isBusy;
  elements.loading.hidden = !isBusy;
  elements.tableWrap.hidden = true;
  elements.empty.hidden = true;
  elements.pagination.hidden = true;
  elements.refresh.disabled = isBusy || state.connectionBusy;
}

function setConnectionBusy(isBusy) {
  state.connectionBusy = isBusy;
  elements.stage.disabled = isBusy;
  elements.key.disabled =
    isBusy || !state.meta || state.meta.connection.keys.length === 0;
  elements.refresh.disabled = isBusy || state.entityBusy;
}

function showNotice(message) {
  elements.notice.textContent = message || '';
  elements.notice.hidden = !message;
}

function displayValue(value) {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function visibleFields(entity) {
  const configured = entity.fields
    .filter((field) => !field.relationship)
    .map((field) => field.name);
  if (configured.length) return configured.slice(0, 4);
  const firstData = state.items[0] && state.items[0].data;
  return firstData ? Object.keys(firstData).slice(0, 4) : [];
}

function renderTable() {
  const entity = selectedEntity();
  const fields = visibleFields(entity);
  const hasMutuals = mutualTargets(entity).length > 0;
  elements.tableHead.innerHTML =
    '<tr><th>Entity ID</th>' +
    fields.map((field) => '<th>' + escapeHtml(field) + '</th>').join('') +
    '<th>Updated</th><th aria-label="Actions"></th></tr>';

  elements.tableBody.innerHTML = state.items
    .map((item) => {
      const encodedId = encodeURIComponent(item.entityId);
      return (
        '<tr>' +
        '<td class="id-cell" title="' +
        escapeHtml(item.entityId) +
        '">' +
        escapeHtml(item.entityId) +
        '</td>' +
        fields
          .map((field) => {
            const value = displayValue(item.data && item.data[field]);
            return '<td title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</td>';
          })
          .join('') +
        '<td class="date-cell">' +
        escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—') +
        '</td>' +
         '<td><div class="row-actions">' +
        (hasMutuals
          ? '<button class="row-action" type="button" data-action="mutuals" data-id="' +
            encodedId +
            '">Mutuals</button>'
          : '') +
        '<button class="row-action" type="button" data-action="edit" data-id="' +
        encodedId +
        '">Edit</button>' +
        '<button class="row-action danger" type="button" data-action="delete" data-id="' +
        encodedId +
        '">Delete</button>' +
        '</div></td></tr>'
      );
    })
    .join('');
}

function renderResults() {
  const count = state.items.length;
  state.entityBusy = false;
  elements.refresh.disabled = state.connectionBusy;
  elements.resultCount.textContent =
    state.query && state.totalCount !== undefined
      ? String(state.totalCount)
      : String(state.totalCount || count);
  elements.loading.hidden = true;
  elements.empty.hidden = count > 0;
  elements.tableWrap.hidden = count === 0;
  elements.pagination.hidden =
    count === 0 ||
    (!state.tagName && Boolean(state.query)) ||
    (!state.nextCursor && !state.cursorHistory.length);
  elements.previous.disabled = state.cursorHistory.length === 0;
  elements.next.disabled = !state.nextCursor;
  elements.pageLabel.textContent = 'Page ' + (state.cursorHistory.length + 1);
  elements.emptyMessage.textContent =
    state.tagName && !state.tagApplied
      ? 'Set a tag group, sort prefix, or sort range to begin.'
      : state.tagName
        ? 'No records matched this tag query.'
        : state.query
          ? 'No records matched “' + state.query + '”.'
          : 'Create the first record for this entity type.';
  if (count) renderTable();
}

async function loadEntities() {
  if (!state.entity) return;
  if (state.tagName && !state.tagApplied) {
    state.items = [];
    state.nextCursor = null;
    state.totalCount = 0;
    showNotice('');
    renderResults();
    return;
  }
  const connectionVersion = state.connectionVersion;
  setBusy(true);
  showNotice('');
  const params = new URLSearchParams({ limit: '25' });
  if (state.tagName) {
    Object.entries(state.tagFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
  } else if (state.query) {
    params.set('query', state.query);
  }
  if (state.currentCursor) params.set('lastKey', state.currentCursor);

  try {
    const path = state.tagName
      ? '/api/tags/' +
        encodeURIComponent(state.entity) +
        '/' +
        encodeURIComponent(state.tagName)
      : '/api/entities/' + encodeURIComponent(state.entity);
    const result = await api(
      path + '?' + params,
    );
    if (connectionVersion !== state.connectionVersion) return;
    state.items = Array.isArray(state.tagName ? result.entities : result.data)
      ? state.tagName
        ? result.entities
        : result.data
      : [];
    state.nextCursor = result.lastKey || null;
    state.totalCount =
      typeof result.filteredCount === 'number'
        ? result.filteredCount
        : typeof result.totalCount === 'number'
          ? result.totalCount
          : state.items.length;
    renderResults();
  } catch (error) {
    state.items = [];
    setBusy(false);
    showNotice(error.message);
  }
}

function chooseEntity(name) {
  state.entity = name;
  state.query = '';
  state.tagName = null;
  state.tagFilters = { group: '', query: '', start: '', end: '' };
  state.tagApplied = false;
  state.currentCursor = null;
  state.nextCursor = null;
  state.cursorHistory = [];
  const entity = selectedEntity();

  document.querySelectorAll('.entity-link').forEach((button) => {
    button.classList.toggle('active', button.dataset.entity === name);
  });
  elements.content.hidden = false;
  elements.welcome.hidden = true;
  elements.pageTitle.textContent = entity.displayName;
  elements.pageDescription.textContent =
    'Browse and manage ' + entity.name + ' entities.';
  elements.searchInput.value = '';
  elements.searchInput.placeholder = entity.searchable
    ? 'Search ' + entity.searchFields.join(', ')
    : 'Search is not configured';
  elements.uniqueCount.textContent = String(entity.uniqueFields.length);
  elements.tagGroup.value = '';
  elements.tagQuery.value = '';
  elements.tagStart.value = '';
  elements.tagEnd.value = '';
  renderListingControls();
  loadEntities();
}

function resetListing() {
  state.currentCursor = null;
  state.nextCursor = null;
  state.cursorHistory = [];
  state.totalCount = 0;
}

function clearTagFilters(shouldLoad = true) {
  state.tagFilters = { group: '', query: '', start: '', end: '' };
  state.tagApplied = false;
  elements.tagGroup.value = '';
  elements.tagQuery.value = '';
  elements.tagStart.value = '';
  elements.tagEnd.value = '';
  resetListing();
  if (shouldLoad) loadEntities();
}

function changeListingMode(tagName) {
  state.tagName = tagName || null;
  state.query = '';
  state.tagApplied = false;
  elements.searchInput.value = '';
  clearTagFilters(false);
  renderListingControls();
  loadEntities();
}

function applyTagFilters() {
  const filters = {
    group: elements.tagGroup.value.trim(),
    query: elements.tagQuery.value.trim(),
    start: elements.tagStart.value.trim(),
    end: elements.tagEnd.value.trim(),
  };
  if (!filters.group && !filters.query && !filters.start && !filters.end) {
    showToast('Provide a tag group, sort prefix, or sort range.', true);
    return;
  }
  if (filters.query && (filters.start || filters.end)) {
    showToast('Use either a sort prefix or a sort range, not both.', true);
    return;
  }
  state.tagFilters = filters;
  state.tagApplied = true;
  resetListing();
  loadEntities();
}

async function switchStage(stageId) {
  const previousStageId = state.meta.connection.stageId;
  setConnectionBusy(true);
  try {
    const connection = await api('/api/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId }),
    });
    state.meta.connection = connection;
    state.meta.apiUrl = connection.apiUrl;
    state.connectionVersion += 1;
    resetListing();
    if (elements.mutualDialog.open) elements.mutualDialog.close();
    renderConnection();
    await loadEntities();
    const stage = state.meta.stages.find((candidate) => candidate.id === stageId);
    showToast('Connected to ' + (stage ? stage.label : 'stage') + '.');
  } catch (error) {
    elements.stage.value = previousStageId;
    showToast(error.message, true);
  } finally {
    setConnectionBusy(false);
    renderConnection();
  }
}

function openManualConnection() {
  elements.manualApiUrl.value = '';
  elements.manualApiKey.value = '';
  elements.manualError.textContent = '';
  elements.manualError.hidden = true;
  elements.manualDialog.showModal();
  window.setTimeout(() => elements.manualApiUrl.focus(), 0);
}

async function connectManual() {
  if (!elements.manualApiUrl.reportValidity()) return;
  const apiUrl = elements.manualApiUrl.value.trim();
  const apiKey = elements.manualApiKey.value;
  elements.manualApiKey.value = '';
  elements.manualError.textContent = '';
  elements.manualError.hidden = true;
  elements.manualSave.disabled = true;
  elements.manualSave.textContent = 'Connecting…';
  elements.manualApiUrl.disabled = true;
  setConnectionBusy(true);
  try {
    const connection = await api('/api/connection/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiUrl, apiKey }),
    });
    state.meta.connection = connection;
    state.meta.apiUrl = connection.apiUrl;
    state.connectionVersion += 1;
    resetListing();
    if (elements.mutualDialog.open) elements.mutualDialog.close();
    elements.manualDialog.close();
    renderConnection();
    await loadEntities();
    showToast('Connected to the manual Core URL.');
  } catch (error) {
    elements.manualError.textContent = error.message;
    elements.manualError.hidden = false;
    elements.stage.value = state.meta.connection.stageId;
  } finally {
    elements.manualSave.disabled = false;
    elements.manualSave.textContent = 'Connect';
    elements.manualApiUrl.disabled = false;
    setConnectionBusy(false);
  }
}

async function switchKey(keyId) {
  const previousKeyId = state.meta.connection.keyId;
  setConnectionBusy(true);
  try {
    const connection = await api('/api/connection/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId }),
    });
    state.meta.connection = connection;
    state.connectionVersion += 1;
    resetListing();
    if (elements.mutualDialog.open) elements.mutualDialog.close();
    renderConnection();
    await loadEntities();
    showToast('API key changed.');
  } catch (error) {
    elements.key.value = previousKeyId || '';
    showToast(error.message, true);
  } finally {
    setConnectionBusy(false);
    renderConnection();
  }
}

function fieldReferenceHtml(fields, emptyMessage) {
  return fields.length
    ? fields
        .map(
          (field, index) =>
            '<div class="field"><div class="field-main"><button class="field-insert" type="button" data-field-action="insert" data-field-index="' +
            index +
            '" title="Add ' +
            escapeHtml(field.name) +
            ' to the JSON"><code>' +
            escapeHtml(field.name) +
            '</code></button><div class="field-controls"><span class="field-type">' +
            escapeHtml(field.type) +
            '</span>' +
            (field.timestamp
              ? '<button class="timestamp-button" type="button" data-field-action="timestamp" data-field-index="' +
                index +
                '" title="Set ' +
                escapeHtml(field.name) +
                ' to the current ISO timestamp">ISO now</button>'
              : '') +
            '</div></div><div class="field-meta">' +
            (field.required
              ? '<span class="badge required">Required</span>'
              : '<span class="badge">Optional</span>') +
            (field.relationship
              ? '<span class="badge relationship">Relationship</span>'
              : '') +
            (field.unique ? '<span class="badge unique">Unique</span>' : '') +
            '</div>' +
            (field.description
              ? '<p class="field-description">' +
                escapeHtml(field.description) +
                '</p>'
              : '') +
            '</div>',
        )
        .join('')
    : '<p class="field-description">' + escapeHtml(emptyMessage) + '</p>';
}

function suggestedFieldValue(field) {
  if (field.timestamp) return new Date().toISOString();
  if (field.example !== undefined) {
    return JSON.parse(JSON.stringify(field.example));
  }
  if (Array.isArray(field.values) && field.values.length) {
    return field.values[0];
  }
  if (field.type === 'boolean') return false;
  if (field.type === 'number' || field.type === 'bigint') return 0;
  if (field.type.endsWith('[]')) return [];
  if (field.type === 'object') return {};
  if (field.type === 'null') return null;
  return '';
}

function focusEditorField(editor, fieldName) {
  const marker = '\\n  ' + JSON.stringify(fieldName) + ': ';
  const markerStart = editor.value.lastIndexOf(marker);
  editor.focus();
  if (markerStart < 0) return;
  const valueStart = markerStart + marker.length;
  const lineEnd = editor.value.indexOf('\\n', valueStart);
  let valueEnd = lineEnd < 0 ? editor.value.length : lineEnd;
  if (editor.value[valueEnd - 1] === ',') valueEnd -= 1;
  const firstValueCharacter = editor.value[valueStart];
  if (
    (firstValueCharacter === '{' || firstValueCharacter === '[') &&
    valueEnd === valueStart + 1
  ) {
    valueEnd = valueStart;
  }
  editor.setSelectionRange(valueStart, valueEnd);
}

function insertEditorField(editor, errorElement, field, useCurrentTimestamp) {
  let payload;
  try {
    payload = JSON.parse(editor.value);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('The editor must contain a JSON object.');
    }
  } catch (error) {
    errorElement.textContent =
      error instanceof SyntaxError
        ? 'Fix the JSON before adding a field: ' + error.message
        : error.message;
    errorElement.hidden = false;
    return;
  }

  const exists = Object.prototype.hasOwnProperty.call(payload, field.name);
  if (exists && !useCurrentTimestamp) {
    focusEditorField(editor, field.name);
    showToast(field.name + ' is already in the JSON.');
    return;
  }

  payload[field.name] = useCurrentTimestamp
    ? new Date().toISOString()
    : suggestedFieldValue(field);
  editor.value = JSON.stringify(payload, null, 2);
  errorElement.textContent = '';
  errorElement.hidden = true;
  focusEditorField(editor, field.name);
  showToast(
    useCurrentTimestamp
      ? 'Set ' + field.name + ' to the current ISO timestamp.'
      : 'Added ' + field.name + ' to the JSON.',
  );
}

function handleFieldReferenceClick(event, editor, errorElement, fields) {
  const button = event.target.closest('[data-field-action]');
  if (!button) return;
  const field = fields[Number(button.dataset.fieldIndex)];
  if (!field) return;
  insertEditorField(
    editor,
    errorElement,
    field,
    button.dataset.fieldAction === 'timestamp',
  );
}

function fieldReference(entity) {
  elements.fieldList.innerHTML = fieldReferenceHtml(
    entity.fields,
    'No schema fields were discovered.',
  );
}

function openEditor(mode, item) {
  const entity = selectedEntity();
  state.editorMode = mode;
  state.editingId = item ? item.entityId : null;
  elements.dialogEyebrow.textContent =
    mode === 'create' ? 'Create entity' : 'Update entity';
  elements.dialogTitle.textContent =
    mode === 'create'
      ? 'New ' + entity.displayName
      : entity.displayName + ' · ' + item.entityId;
  elements.save.textContent = mode === 'create' ? 'Create entity' : 'Save changes';
  elements.jsonEditor.value = JSON.stringify(
    mode === 'create' ? entity.createTemplate : item.data || {},
    null,
    2,
  );
  elements.editorError.hidden = true;
  elements.editorError.textContent = '';
  fieldReference(entity);
  elements.dialog.showModal();
  window.setTimeout(() => elements.jsonEditor.focus(), 0);
}

async function saveEntity() {
  let payload;
  try {
    payload = JSON.parse(elements.jsonEditor.value);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('Entity data must be a JSON object.');
    }
  } catch (error) {
    elements.editorError.textContent =
      error instanceof SyntaxError ? 'Enter valid JSON: ' + error.message : error.message;
    elements.editorError.hidden = false;
    return;
  }

  elements.save.disabled = true;
  elements.save.textContent =
    state.editorMode === 'create' ? 'Creating…' : 'Saving…';
  elements.editorError.hidden = true;
  try {
    const path =
      '/api/entities/' +
      encodeURIComponent(state.entity) +
      (state.editingId ? '/' + encodeURIComponent(state.editingId) : '');
    await api(path, {
      method: state.editorMode === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    elements.dialog.close();
    showToast(
      selectedEntity().displayName +
        (state.editorMode === 'create' ? ' created.' : ' updated.'),
    );
    await loadEntities();
  } catch (error) {
    elements.editorError.textContent = error.message;
    elements.editorError.hidden = false;
  } finally {
    elements.save.disabled = false;
    elements.save.textContent =
      state.editorMode === 'create' ? 'Create entity' : 'Save changes';
  }
}

async function deleteEntity(id) {
  const entity = selectedEntity();
  if (
    !window.confirm(
      'Delete ' + entity.displayName + ' “' + id + '”?\\n\\nThis cannot be undone.',
    )
  ) {
    return;
  }

  try {
    await api(
      '/api/entities/' +
        encodeURIComponent(state.entity) +
        '/' +
        encodeURIComponent(id),
      { method: 'DELETE' },
    );
    showToast(entity.displayName + ' deleted.');
    await loadEntities();
  } catch (error) {
    showToast(error.message, true);
  }
}

function resetMutualPaging() {
  state.mutualCurrentCursor = null;
  state.mutualNextCursor = null;
  state.mutualCursorHistory = [];
}

function showMutualNotice(message) {
  elements.mutualNotice.textContent = message || '';
  elements.mutualNotice.hidden = !message;
}

function setMutualBusy(isBusy) {
  state.mutualBusy = isBusy;
  elements.mutualLoading.hidden = !isBusy;
  elements.mutualEmpty.hidden = true;
  elements.mutualTableWrap.hidden = true;
  elements.mutualPagination.hidden = true;
  elements.mutualTarget.disabled = isBusy;
  elements.mutualCreate.disabled = isBusy;
  elements.mutualRefresh.disabled = isBusy;
}

function renderMutualResults() {
  const count = state.mutualItems.length;
  state.mutualBusy = false;
  elements.mutualTarget.disabled = false;
  elements.mutualCreate.disabled = false;
  elements.mutualRefresh.disabled = false;
  elements.mutualLoading.hidden = true;
  elements.mutualEmpty.hidden = count > 0;
  elements.mutualTableWrap.hidden = count === 0;
  elements.mutualPagination.hidden =
    count === 0 ||
    (!state.mutualNextCursor && !state.mutualCursorHistory.length);
  elements.mutualPrevious.disabled = state.mutualCursorHistory.length === 0;
  elements.mutualNext.disabled = !state.mutualNextCursor;
  elements.mutualPageLabel.textContent =
    'Page ' + (state.mutualCursorHistory.length + 1);
  elements.mutualTableBody.innerHTML = state.mutualItems
    .map((mutual) => {
      const data = displayValue(mutual.data || {});
      const mutualData = displayValue(mutual.mutualData || {});
      const encodedId = encodeURIComponent(mutual.entityId);
      return (
        '<tr>' +
        '<td class="id-cell" title="' +
        escapeHtml(mutual.entityId) +
        '">' +
        escapeHtml(mutual.entityId) +
        '</td>' +
        '<td class="json-cell">' +
        escapeHtml(data) +
        '</td>' +
        '<td class="json-cell">' +
        escapeHtml(mutualData) +
        '</td>' +
        '<td class="date-cell">' +
        escapeHtml(
          mutual.mutualUpdatedAt
            ? new Date(mutual.mutualUpdatedAt).toLocaleString()
            : '—',
        ) +
        '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action" type="button" data-mutual-action="edit" data-id="' +
        encodedId +
        '">Edit</button>' +
        '<button class="row-action danger" type="button" data-mutual-action="delete" data-id="' +
        encodedId +
        '">Delete</button>' +
        '</div></td></tr>'
      );
    })
    .join('');
}

async function loadMutuals() {
  if (!state.mutualSourceId || !state.mutualTarget) return;
  const connectionVersion = state.connectionVersion;
  setMutualBusy(true);
  showMutualNotice('');
  const params = new URLSearchParams({ limit: '25' });
  if (state.mutualCurrentCursor) {
    params.set('lastKey', state.mutualCurrentCursor);
  }
  try {
    const result = await api(
      '/api/mutuals/' +
        encodeURIComponent(state.entity) +
        '/' +
        encodeURIComponent(state.mutualSourceId) +
        '/' +
        encodeURIComponent(state.mutualTarget) +
        '?' +
        params,
    );
    if (connectionVersion !== state.connectionVersion) return;
    state.mutualItems = Array.isArray(result.entities) ? result.entities : [];
    state.mutualNextCursor = result.lastKey || null;
    renderMutualResults();
  } catch (error) {
    state.mutualItems = [];
    setMutualBusy(false);
    showMutualNotice(error.message);
  }
}

function openMutuals(id) {
  const entity = selectedEntity();
  const targets = mutualTargets(entity);
  if (!targets.length) {
    showToast('No mutual relationships are configured for this entity.', true);
    return;
  }
  state.mutualSourceId = id;
  state.mutualTarget = targets[0].name;
  state.mutualItems = [];
  resetMutualPaging();
  elements.mutualTitle.textContent = entity.displayName + ' · ' + id;
  elements.mutualTarget.innerHTML = targets
    .map(
      (target) =>
        '<option value="' +
        escapeHtml(target.name) +
        '">' +
        escapeHtml(target.displayName) +
        ' (' +
        escapeHtml(target.name) +
        ')</option>',
    )
    .join('');
  elements.mutualTarget.value = state.mutualTarget;
  elements.mutualDialog.showModal();
  loadMutuals();
}

function openMutualEditor(mode, mutual) {
  const source = selectedEntity();
  const target = entityByName(state.mutualTarget);
  const descriptor = mutualDescriptor(source, state.mutualTarget);
  state.mutualEditorMode = mode;
  state.mutualEditingId = mutual ? mutual.entityId : null;
  elements.mutualEditorEyebrow.textContent =
    mode === 'create' ? 'Create mutual' : 'Update mutual';
  elements.mutualEditorTitle.textContent =
    mode === 'create'
      ? 'Link ' + source.displayName + ' to ' + target.displayName
      : target.displayName + ' · ' + mutual.entityId;
  elements.mutualEntityId.value = mutual ? mutual.entityId : '';
  elements.mutualEntityId.disabled = mode === 'edit';
  elements.mutualJsonEditor.value = JSON.stringify(
    mode === 'create'
      ? descriptor.createTemplate || {}
      : mutual.mutualData || {},
    null,
    2,
  );
  elements.mutualFieldList.innerHTML = fieldReferenceHtml(
    descriptor.dataFields || [],
    'This relationship has no configured mutual data fields. Use an empty JSON object.',
  );
  elements.mutualEditorError.textContent = '';
  elements.mutualEditorError.hidden = true;
  elements.mutualSave.textContent =
    mode === 'create' ? 'Create mutual' : 'Save mutual';
  elements.mutualEditorDialog.showModal();
  window.setTimeout(
    () =>
      (mode === 'create'
        ? elements.mutualEntityId
        : elements.mutualJsonEditor
      ).focus(),
    0,
  );
}

async function saveMutual() {
  const entityId = (
    state.mutualEditingId || elements.mutualEntityId.value
  ).trim();
  if (!entityId) {
    elements.mutualEditorError.textContent =
      'Enter the related entity ID.';
    elements.mutualEditorError.hidden = false;
    return;
  }
  let payload;
  try {
    payload = JSON.parse(elements.mutualJsonEditor.value);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('Mutual data must be a JSON object.');
    }
  } catch (error) {
    elements.mutualEditorError.textContent =
      error instanceof SyntaxError
        ? 'Enter valid JSON: ' + error.message
        : error.message;
    elements.mutualEditorError.hidden = false;
    return;
  }

  elements.mutualSave.disabled = true;
  elements.mutualSave.textContent =
    state.mutualEditorMode === 'create' ? 'Creating…' : 'Saving…';
  elements.mutualEditorError.hidden = true;
  try {
    await api(
      '/api/mutuals/' +
        encodeURIComponent(state.entity) +
        '/' +
        encodeURIComponent(state.mutualSourceId) +
        '/' +
        encodeURIComponent(state.mutualTarget) +
        '/' +
        encodeURIComponent(entityId),
      {
        method: state.mutualEditorMode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    elements.mutualEditorDialog.close();
    showToast(
      state.mutualEditorMode === 'create'
        ? 'Mutual relationship created.'
        : 'Mutual relationship updated.',
    );
    await loadMutuals();
  } catch (error) {
    elements.mutualEditorError.textContent = error.message;
    elements.mutualEditorError.hidden = false;
  } finally {
    elements.mutualSave.disabled = false;
    elements.mutualSave.textContent =
      state.mutualEditorMode === 'create' ? 'Create mutual' : 'Save mutual';
  }
}

async function deleteMutual(mutual) {
  const target = entityByName(state.mutualTarget);
  if (
    !window.confirm(
      'Delete the mutual relationship to ' +
        target.displayName +
        ' “' +
        mutual.entityId +
        '”?\\n\\nThis cannot be undone.',
    )
  ) {
    return;
  }
  try {
    await api(
      '/api/mutuals/' +
        encodeURIComponent(state.entity) +
        '/' +
        encodeURIComponent(state.mutualSourceId) +
        '/' +
        encodeURIComponent(state.mutualTarget) +
        '/' +
        encodeURIComponent(mutual.entityId),
      { method: 'DELETE' },
    );
    showToast('Mutual relationship deleted.');
    await loadMutuals();
  } catch (error) {
    showToast(error.message, true);
  }
}

elements.entityNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-entity]');
  if (button) chooseEntity(button.dataset.entity);
});

elements.refresh.addEventListener('click', () => loadEntities());
elements.stage.addEventListener('change', () => {
  if (elements.stage.value === MANUAL_STAGE_ID) {
    openManualConnection();
  } else {
    switchStage(elements.stage.value);
  }
});
elements.key.addEventListener('change', () => switchKey(elements.key.value));
elements.manualForm.addEventListener('submit', (event) => {
  event.preventDefault();
  connectManual();
});
elements.manualClose.addEventListener('click', () =>
  elements.manualDialog.close(),
);
elements.manualCancel.addEventListener('click', () =>
  elements.manualDialog.close(),
);
elements.manualDialog.addEventListener('close', () => {
  elements.manualApiUrl.value = '';
  elements.manualApiKey.value = '';
  elements.manualError.textContent = '';
  elements.manualError.hidden = true;
  elements.stage.value = state.meta.connection.stageId;
});
elements.listingMode.addEventListener('change', () =>
  changeListingMode(elements.listingMode.value),
);
elements.create.addEventListener('click', () => openEditor('create'));
elements.save.addEventListener('click', saveEntity);
elements.fieldList.addEventListener('click', (event) => {
  handleFieldReferenceClick(
    event,
    elements.jsonEditor,
    elements.editorError,
    selectedEntity().fields,
  );
});

elements.tagFilterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyTagFilters();
});
elements.clearTag.addEventListener('click', () => clearTagFilters());

elements.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!selectedEntity().searchable) return;
  state.query = elements.searchInput.value.trim();
  state.currentCursor = null;
  state.cursorHistory = [];
  elements.clearSearch.hidden = !state.query;
  loadEntities();
});

elements.clearSearch.addEventListener('click', () => {
  state.query = '';
  elements.searchInput.value = '';
  elements.clearSearch.hidden = true;
  loadEntities();
});

elements.next.addEventListener('click', () => {
  if (!state.nextCursor) return;
  state.cursorHistory.push(state.currentCursor);
  state.currentCursor = state.nextCursor;
  loadEntities();
});

elements.previous.addEventListener('click', () => {
  if (!state.cursorHistory.length) return;
  state.currentCursor = state.cursorHistory.pop() || null;
  loadEntities();
});

elements.tableBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = decodeURIComponent(button.dataset.id);
  const item = state.items.find((candidate) => candidate.entityId === id);
  if (button.dataset.action === 'mutuals') openMutuals(id);
  if (button.dataset.action === 'edit' && item) openEditor('edit', item);
  if (button.dataset.action === 'delete') deleteEntity(id);
});

elements.mutualClose.addEventListener('click', () =>
  elements.mutualDialog.close(),
);
elements.mutualCreate.addEventListener('click', () =>
  openMutualEditor('create'),
);
elements.mutualRefresh.addEventListener('click', loadMutuals);
elements.mutualTarget.addEventListener('change', () => {
  state.mutualTarget = elements.mutualTarget.value;
  state.mutualItems = [];
  resetMutualPaging();
  loadMutuals();
});
elements.mutualNext.addEventListener('click', () => {
  if (!state.mutualNextCursor) return;
  state.mutualCursorHistory.push(state.mutualCurrentCursor);
  state.mutualCurrentCursor = state.mutualNextCursor;
  loadMutuals();
});
elements.mutualPrevious.addEventListener('click', () => {
  if (!state.mutualCursorHistory.length) return;
  state.mutualCurrentCursor =
    state.mutualCursorHistory.pop() || null;
  loadMutuals();
});
elements.mutualTableBody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mutual-action]');
  if (!button) return;
  const id = decodeURIComponent(button.dataset.id);
  const mutual = state.mutualItems.find(
    (candidate) => candidate.entityId === id,
  );
  if (!mutual) return;
  if (button.dataset.mutualAction === 'edit') {
    openMutualEditor('edit', mutual);
  }
  if (button.dataset.mutualAction === 'delete') deleteMutual(mutual);
});
elements.mutualSave.addEventListener('click', saveMutual);
elements.mutualFieldList.addEventListener('click', (event) => {
  const descriptor = mutualDescriptor(selectedEntity(), state.mutualTarget);
  handleFieldReferenceClick(
    event,
    elements.mutualJsonEditor,
    elements.mutualEditorError,
    descriptor.dataFields || [],
  );
});

elements.jsonEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = elements.jsonEditor.selectionStart;
    const end = elements.jsonEditor.selectionEnd;
    elements.jsonEditor.setRangeText('  ', start, end, 'end');
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveEntity();
});
elements.mutualJsonEditor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = elements.mutualJsonEditor.selectionStart;
    const end = elements.mutualJsonEditor.selectionEnd;
    elements.mutualJsonEditor.setRangeText('  ', start, end, 'end');
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') saveMutual();
});

async function start() {
  try {
    state.meta = await api('/api/meta');
    renderConnection();
    renderNavigation();
    if (state.meta.entities.length) chooseEntity(state.meta.entities[0].name);
  } catch (error) {
    elements.apiLabel.textContent = 'Configuration error';
    showToast(error.message, true);
  }
}

start();
`;
