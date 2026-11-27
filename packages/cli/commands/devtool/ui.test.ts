import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_JS, INDEX_HTML } from './ui';

test('devtool embeds a valid tag and mutual browser script', () => {
  assert.doesNotThrow(() => new Function(APP_JS));
  assert.match(INDEX_HTML, /id="listing-mode"/);
  assert.match(INDEX_HTML, /id="tag-filter-form"/);
  assert.match(INDEX_HTML, /id="mutual-dialog"/);
  assert.match(INDEX_HTML, /id="mutual-editor-dialog"/);
  assert.match(APP_JS, /\/api\/tags\//);
  assert.match(APP_JS, /\/api\/mutuals\//);
  assert.match(APP_JS, /data-mutual-action="edit"/);
  assert.match(APP_JS, /data-mutual-action="delete"/);
  assert.match(APP_JS, /badge unique/);
});
