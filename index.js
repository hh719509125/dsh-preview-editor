/**
 * In-place document editing for DeepSeek Harness (DSH).
 *
 * The shipped Sidebar document preview is read-only by design: its README names
 * "Preview, not editing" as a deliberate limitation, and the workspace files
 * Remote exposes no mutation operation at all — `Read`, `readBytes`, `stat`,
 * `list` and `changes`, nothing that writes. A plugin therefore cannot reuse a
 * shipped write endpoint, and it cannot add one to the Remote system either:
 * `@deepseek-ai/dsh-api-remotes` fixes the Client's `ctx.remote` namespace set
 * at build time.
 *
 * What a plugin *can* do is claim an exact Fetch route on the Connection
 * `/api` bridge. Connection owns the single `/api` prefix route, admits each
 * request through the loopback/Origin trust fence and the browser session
 * cookie, and only then dispatches to the shared Fetch handler — which consults
 * these exact routes first. Registering here therefore inherits the shipped
 * authentication instead of inventing a second scheme.
 *
 * The write itself goes through `ctx.fs.writeText` with the requesting
 * Session's standing sandbox policy, resolved the same way `dsh-tool-fs`
 * resolves it for the model's own `write` tool. An in-place save is confined by
 * the same mode and the same workspace root as an agent write, so this cannot
 * become a way around the file fence.
 *
 * Line endings are preserved rather than normalized: the text reader joins
 * lines with `\n` and drops the final terminator, so writing that text back
 * verbatim would silently convert every CRLF in a file. The route probes the
 * target's existing bytes, restores its ending, and ends the file with a
 * newline, which makes a save of an unmodified buffer a no-op on disk.
 *
 * The module imports nothing at all — no DSH package, no npm package — so a
 * profile-installed copy loads even when pnpm links the package from outside
 * the profile directory, where bare-specifier resolution of `@deepseek-ai/*`
 * would fail.
 *
 * @module @local/dsh-plugin-document-editor
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-editor'

/** The filesystem is the only required service; Connection and the web server are injected when present. */
export const inject = ['fs']

/** Exact Fetch route claimed on the Connection `/api` bridge. Must be one `/api/<segment>`. */
const ROUTE_PATH = '/api/dsh-doc-editor'

/** Refuse a save larger than this many UTF-8 bytes. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/** Bytes read to decide whether the target already uses CRLF. */
const LINE_ENDING_PROBE_BYTES = 65536

/**
 * Suffixes whose files open in this plugin's editor instead of the plain-text
 * viewer. Anything with a better shipped default — Markdown, HTML, SVG,
 * spreadsheets, images — is deliberately left out; Markdown is offered as an
 * alternative renderer instead, so `.md` keeps rendering while staying one
 * dropdown click away from editing.
 */
const DEFAULT_EXTENSIONS = [
  'txt', 'text', 'log', 'nfo',
  'json', 'jsonc', 'json5', 'ndjson',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs',
  'php', 'swift', 'scala', 'lua', 'pl', 'r', 'jl', 'dart', 'vue', 'svelte', 'astro',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'diff', 'patch',
  'css', 'scss', 'less', 'styl',
]

/**
 * Read the row's config with defaults, accepting anything the patch layer holds.
 *
 * @param raw - the loader row config, possibly absent or malformed.
 * @returns resolved settings.
 */
function readConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    extensions: extensionList(source.extensions) ?? DEFAULT_EXTENSIONS,
    markdown: source.markdown !== false,
    maxBytes: positiveInteger(source.maxBytes) ?? DEFAULT_MAX_BYTES,
  }
}

/** A normalized suffix list, an empty list, or `undefined` when the value is unusable. */
function extensionList(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const suffixes = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const suffix = entry.trim().replace(/^\./u, '').toLowerCase()
    if (suffix.length > 0 && !suffixes.includes(suffix)) suffixes.push(suffix)
  }
  return suffixes
}

/** A trimmed non-empty string, or `undefined`. */
function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** A positive integer, or `undefined`. */
function positiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** One JSON response with caching disabled. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** HTTP status for each structured filesystem failure this route can produce. */
const STATUS_BY_CODE = {
  FS_STALE_VERSION: 409,
  FS_NOT_OBSERVED: 409,
  FS_SANDBOX_DENIED: 403,
  FS_NOT_FOUND: 404,
  FS_NOT_REGULAR_FILE: 400,
}

/** Turn one thrown filesystem error into a typed JSON failure. */
function failure(error, prefix) {
  const code = typeof error?.code === 'string' ? error.code : 'write-failed'
  const status = STATUS_BY_CODE[code] ?? 500
  const detail = error?.message ?? String(error)
  return json({ ok: false, code, message: prefix === undefined ? detail : `${prefix} — ${detail}` }, status)
}

/**
 * Resolve the requesting Session's standing sandbox policy.
 *
 * Mirrors `dsh-tool-fs`: the model's mutations carry the calling Session's mode
 * and workspace root, so an agentless caller must resolve the same policy
 * itself or the fence and the tools would confine to different roots. Without a
 * confining backend, `ctx.fs.sandboxMode` is `undefined` and the mutation needs
 * no policy at all.
 *
 * @param ctx - plugin context carrying the filesystem and policy services.
 * @param sessionId - the Session named by the file address, when the client could read one.
 * @returns the policy to stamp onto the write, or `undefined` for an unfenced backend.
 */
function resolvePolicy(ctx, sessionId) {
  if (ctx.fs?.sandboxMode === undefined) return undefined
  const service = typeof ctx.get === 'function' ? ctx.get('sandboxPolicy') : undefined
  if (service === undefined || typeof service.resolve !== 'function') return undefined
  const agent = sessionId === undefined || typeof ctx.get !== 'function' ? undefined : ctx.get('agents')?.get(sessionId)
  try {
    return agent?.session === undefined ? service.resolve({}) : service.resolve({ session: agent.session })
  } catch (error) {
    ctx.logger?.debug?.(`document-editor: sandboxPolicy.resolve failed for ${sessionId ?? '(no session)'} — ${error?.message ?? String(error)}`)
    return undefined
  }
}

/** Provider resolution options: the policy's workspace root, and the request's cancellation. */
function resolveOptions(policy, signal) {
  const options = {}
  if (typeof policy?.workspaceRoot === 'string' && policy.workspaceRoot.length > 0) options.cwd = policy.workspaceRoot
  if (signal !== undefined) options.signal = signal
  return options
}

/**
 * Decide whether the target already uses CRLF, from its own bytes.
 *
 * A byte scan needs no decoding and cannot fail on invalid UTF-8; an unreadable
 * or absent file falls back to LF, which is what a fresh file wants anyway.
 *
 * @param ctx - plugin context carrying the filesystem.
 * @param target - the resolved write target.
 * @param signal - the request's cancellation signal.
 * @returns `'crlf'` or `'lf'`.
 */
async function detectLineEnding(ctx, target, signal) {
  let probe
  try {
    probe = await ctx.fs.readBytes(target, signal, LINE_ENDING_PROBE_BYTES)
  } catch {
    return 'lf'
  }
  if (probe === undefined || probe === null) return 'lf'
  for (let index = 1; index < probe.length; index += 1) {
    if (probe[index - 1] === 13 && probe[index] === 10) return 'crlf'
  }
  return 'lf'
}

/**
 * Restore the file's line ending and terminal newline.
 *
 * The text reader joins lines with `\n` and carries no terminator after the
 * last, so the editor's buffer is always LF-only and unterminated. Writing that
 * back unchanged would rewrite every line of a CRLF file and strip its final
 * newline; restoring both keeps a save of an untouched buffer byte-identical.
 *
 * @param content - the editor's buffer, LF-joined.
 * @param ending - the target's existing ending.
 * @returns the bytes to write.
 */
function normalizeForWrite(content, ending) {
  const lf = content.replace(/\r\n?/gu, '\n')
  if (lf.length === 0) return ''
  const terminated = lf.endsWith('\n') ? lf : `${lf}\n`
  return ending === 'crlf' ? terminated.replace(/\n/gu, '\r\n') : terminated
}

/**
 * Answer one save request.
 *
 * Body: `{ sessionId?, path, content, version? }`. `version` is the file
 * version the editor opened, so a concurrent change on disk is refused with
 * `409 FS_STALE_VERSION` rather than overwritten.
 *
 * @param ctx - plugin context carrying the filesystem.
 * @param settings - resolved plugin settings.
 * @param request - the Fetch request from the page.
 * @returns a JSON response the editor renders.
 */
async function handleWrite(ctx, settings, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'bad-request', message: 'the request body is not JSON' }, 400)
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, code: 'bad-request', message: 'the request body must be a JSON object' }, 400)
  }
  const path = nonBlank(body.path)
  if (path === undefined) {
    return json({ ok: false, code: 'bad-request', message: '"path" must be a non-empty string' }, 400)
  }
  if (typeof body.content !== 'string') {
    return json({ ok: false, code: 'bad-request', message: '"content" must be a string' }, 400)
  }
  const bytes = Buffer.byteLength(body.content, 'utf8')
  if (bytes > settings.maxBytes) {
    return json({
      ok: false,
      code: 'too-large',
      message: `this buffer is ${bytes} bytes; the configured limit is ${settings.maxBytes}`,
    }, 413)
  }

  const version = nonBlank(body.version)
  const sessionId = nonBlank(body.sessionId)
  const signal = request.signal ?? undefined
  const policy = resolvePolicy(ctx, sessionId)

  let target
  try {
    target = await ctx.fs.resolve(path, resolveOptions(policy, signal))
  } catch (error) {
    return failure(error, 'could not resolve the path')
  }

  // This route edits a document that is already open, so a target that no
  // longer exists is a deleted file, not a request to create one. Without this
  // guard the backend's create-or-overwrite semantics would silently recreate a
  // file the user deleted, and would create missing parent directories too.
  let info
  try {
    info = await ctx.fs.stat(target, signal)
  } catch (error) {
    return failure(error, 'could not inspect the path')
  }
  if (info === undefined) {
    return json({
      ok: false,
      code: 'missing',
      message: `cannot save "${target.displayPath ?? path}": the file no longer exists`,
    }, 404)
  }

  const ending = await detectLineEnding(ctx, target, signal)
  const text = normalizeForWrite(body.content, ending)
  const intent = version === undefined ? undefined : { kind: 'replaceIfVersion', version }

  try {
    const outcome = await ctx.fs.writeText(target, text, intent, signal, policy)
    return json({
      ok: true,
      version: outcome?.version,
      bytes: Buffer.byteLength(text, 'utf8'),
      displayPath: target.displayPath ?? path,
      lineEnding: ending,
    })
  } catch (error) {
    return failure(error)
  }
}

/**
 * Claim the write route and publish the browser-side settings.
 *
 * @param ctx - context whose `fs` service performs the write.
 * @param config - the loader row's config: `extensions`, `markdown`, `maxBytes`.
 */
export function apply(ctx, config) {
  const settings = readConfig(config)

  // The Client half cannot read the row's config, so it is embedded in each
  // served page exactly as the shipped document preview embeds its own limits.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.on('webserver/index-inject', (table) => {
      table.push({
        kind: 'global',
        name: '__DSH_DOC_EDITOR_CONFIG__',
        value: {
          extensions: settings.extensions,
          markdown: settings.markdown,
          maxBytes: settings.maxBytes,
        },
      })
    })
  })

  // Claiming the exact route on the shared `/api` bridge is what grants the
  // browser cookie and the loopback/Origin fence; without Connection there is
  // no authenticated transport for the page to reach, so the editor stays inert.
  ctx.inject(['connection'], (connectionCtx) => {
    try {
      connectionCtx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handleWrite(ctx, settings, request),
      })
      ctx.logger?.info?.(`document-editor: ${ROUTE_PATH} claimed — ${settings.extensions.length} editable suffix(es)`)
    } catch (error) {
      ctx.logger?.warn?.(`document-editor: could not claim ${ROUTE_PATH} — ${error?.message ?? String(error)}`)
    }
  })

  if (settings.extensions.length === 0) {
    ctx.logger?.warn?.('document-editor: the configured extension list is empty; no file opens in the editor')
  }
}
