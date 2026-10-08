/**
 * Browser half of @local/dsh-plugin-document-editor: an editable document renderer.
 *
 * The shipped document preview keeps a registry of renderers and appends the
 * plain-text fallback last, then selects the first candidate. A registration
 * that declares explicit suffixes therefore becomes the default for those
 * suffixes, while the plain-text viewer stays one dropdown click away — no
 * shipped renderer is replaced and nothing is shadowed.
 *
 * The body receives its file through the preview's own plumbing
 * (`resourceAddress`, `useTabInfo`, `useResource`, and the `text-pages`
 * `content`), so reads are the shipped, already-working path. Only the save
 * differs: it posts to this plugin's own authenticated Host route, which is the
 * one thing the workspace-files Remote cannot do.
 *
 * Saving is refused on an incomplete read. `text-pages` loads one bounded page
 * at a time, so a file past the page cap would be written back truncated; the
 * body shows the read-only text with an explanation instead of offering a save
 * that would destroy the rest of the file.
 *
 * @module @local/dsh-plugin-document-editor/client
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-document-editor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace this plugin owns. */
    const NS = 'documentEditor'
    /** Class prefix keeping these rules out of the host's namespace. */
    const CLS = 'dsde'
    /** The Host route that performs the write. */
    const ROUTE = '/api/dsh-doc-editor'
    /** Default renderer identity: the file's own editable view. */
    const PLAIN_ID = '@local/dsh-plugin-document-editor/editable'
    /** Alternative renderer identity: editing offered beside the Markdown preview. */
    const MARKDOWN_ID = '@local/dsh-plugin-document-editor/editable-markdown'
    /** Two spaces per Tab press, the conventional indent for the editable suffixes. */
    const INDENT = '  '

    /** Suffixes edited out of the box; the Host row's `extensions` overrides this. */
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

    /** Markdown keeps its rendered preview as the default; editing is the alternative. */
    const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']

    /** Host-embedded settings, with the shipped defaults as the fallback. */
    const CONFIG = (() => {
      const raw = globalThis.__DSH_DOC_EDITOR_CONFIG__
      return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    })()

    /** The suffix list this page edits, taken from the Host row when it lists one. */
    const EDITABLE_EXTENSIONS = Array.isArray(CONFIG.extensions)
      ? CONFIG.extensions.filter((entry) => typeof entry === 'string' && entry.length > 0)
      : DEFAULT_EXTENSIONS

    /** Whether the Markdown alternative is offered at all. */
    const OFFER_MARKDOWN = CONFIG.markdown !== false

    const en = {
      'viewer.label': 'Edit',
      'viewer.labelMarkdown': 'Edit source',
      save: 'Save',
      saving: 'Saving…',
      revert: 'Revert',
      stateClean: 'Saved',
      stateDirty: 'Unsaved changes',
      stateSaving: 'Saving…',
      savedNotice: 'Saved',
      conflictNotice: 'The file changed on disk since this editor opened it. Nothing was overwritten.',
      overwrite: 'Overwrite with mine',
      reload: 'Discard mine and reload',
      externalNotice: 'The file changed on disk. Reloading replaces the buffer below.',
      loadFromDisk: 'Load disk version',
      reading: 'Loading the document…',
      incomplete: 'This file is larger than one preview page, so only its first part was read. Saving is disabled to avoid truncating it — open it with “Open in app” instead.',
      binary: 'This file cannot be read as text.',
      noAddress: 'This tab does not name a file path.',
      readFailed: 'The file could not be read.',
      saveFailed: 'The save failed.',
      saving_bytes: 'Saved',
      kb: 'KB',
    }

    const zh = {
      'viewer.label': '编辑',
      'viewer.labelMarkdown': '编辑源码',
      save: '保存',
      saving: '保存中…',
      revert: '撤销改动',
      stateClean: '已保存',
      stateDirty: '有未保存改动',
      stateSaving: '保存中…',
      savedNotice: '已保存',
      conflictNotice: '这个编辑器打开之后文件已在磁盘上变化，未覆盖。',
      overwrite: '用我的覆盖',
      reload: '放弃我的改动并重新载入',
      externalNotice: '磁盘上的文件已变化。重新载入会替换下面的内容。',
      loadFromDisk: '载入磁盘版本',
      reading: '正在载入文档…',
      incomplete: '这个文件超过一页预览的读取上限，只读到了前一部分。为避免把文件截断，保存已停用——请改用「用应用打开」编辑。',
      binary: '这个文件无法按文本读取。',
      noAddress: '这个标签页没有给出文件路径。',
      readFailed: '读不到这个文件。',
      saveFailed: '保存失败。',
      saving_bytes: '已保存',
      kb: 'KB',
    }

    const styles = [
      `.${CLS}-root{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;background:transparent}`,
      `.${CLS}-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}`,
      `.${CLS}-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}`,
      `.${CLS}-state{flex:0 0 auto;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}`,
      `.${CLS}-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:currentColor}`,
      `.${CLS}-dot-dirty{color:var(--dsw-alias-state-warning-primary)}`,
      `.${CLS}-dot-clean{color:var(--dsw-alias-state-success-primary)}`,
      `.${CLS}-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;cursor:pointer}`,
      `.${CLS}-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}`,
      `.${CLS}-btn:disabled{cursor:not-allowed;opacity:.4}`,
      `.${CLS}-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}`,
      `.${CLS}-btn-primary:hover:enabled{background:var(--dsw-alias-button-primary-hover)}`,
      `.${CLS}-notice{flex:0 0 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}`,
      `.${CLS}-notice-text{flex:1 1 auto;min-width:0}`,
      `.${CLS}-notice-ok .${CLS}-notice-text{color:var(--dsw-alias-state-success-primary)}`,
      `.${CLS}-notice-error .${CLS}-notice-text,.${CLS}-notice-conflict .${CLS}-notice-text{color:var(--dsw-alias-state-error-primary)}`,
      `.${CLS}-notice-actions{flex:0 0 auto;display:flex;align-items:center;gap:6px}`,
      `.${CLS}-editor{flex:1 1 auto;min-height:0;width:100%;box-sizing:border-box;margin:0;padding:12px 14px;border:none;outline:none;resize:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.75;tab-size:2}`,
      `.${CLS}-editor::selection{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent)}`,
      `.${CLS}-static{flex:1 1 auto;min-height:0;overflow:auto;margin:0;padding:12px 14px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-word}`,
      `.${CLS}-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.7;text-align:center}`,
      `.${CLS}-empty p{margin:0;max-width:420px}`,
    ].join('\n')

    /** A translate function that degrades to the key instead of throwing. */
    function identityTranslate(key) {
      return key
    }

    /**
     * Read one `dsh-resource://file/session/<sessionId>/<path>` address.
     *
     * A local copy of the grammar the preview owns; importing it would mean
     * reaching into a shipped bundle's internals. Returns `undefined` rather
     * than throwing so a malformed address renders a message.
     *
     * @param address - a tab's file address.
     * @returns its decoded parts, or `undefined`.
     */
    function parseFileAddress(address) {
      if (typeof address !== 'string' || !address.startsWith('dsh-resource://file/')) return undefined
      try {
        const end = address.search(/[?#]/u)
        const parts = address.slice(20, end === -1 ? undefined : end).split('/')
        if (parts[0] !== 'session') return undefined
        const [, id, ...segments] = parts
        if (id === undefined || id.length === 0 || segments.length === 0) return undefined
        return {
          sessionId: decodeURIComponent(id),
          path: segments.map((segment) => decodeURIComponent(segment)).join('/'),
        }
      } catch {
        return undefined
      }
    }

    /** A compact byte count for the status line. */
    function formatBytes(bytes, t) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return ''
      if (bytes < 1024) return `${bytes} B`
      return `${(bytes / 1024).toFixed(1)} ${t('kb')}`
    }

    /**
     * The editable document body.
     *
     * Props come from the preview's own slot: `content` is the `text-pages`
     * result, `resourceAddress` names the file, and the standard `useTabInfo` /
     * `useResource` / `scrollportRef` handles come from the enclosing tab.
     *
     * @param props - composed slot props.
     * @returns the editor, or the reason it cannot edit.
     */
    function EditableBody(props) {
      const t = typeof props.t === 'function' ? props.t : identityTranslate
      const { content, resourceAddress, useResource, useTabInfo, scrollportRef } = props
      const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined
      const tab = info?.tab
      const address = typeof resourceAddress === 'string' ? resourceAddress : tab?.contentId
      const meta = typeof useResource === 'function' ? useResource(address) : undefined

      const absolutePath = meta?.value?.absolutePath
      const metaVersion = meta?.value?.version
      const loaded = content?.kind === 'text' && typeof content.text === 'string' ? content.text : undefined
      const complete = content?.kind === 'text' && content.eof === true
      const wrap = props.wrap !== false

      const [draft, setDraft] = React.useState(null)
      const [baseline, setBaseline] = React.useState(null)
      const [version, setVersion] = React.useState(undefined)
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      // Adopt the read once, and only while the buffer is still untouched: a
      // late page or an external change must never overwrite what the user typed.
      React.useEffect(() => {
        if (draft !== null || complete !== true || typeof loaded !== 'string') return
        setDraft(loaded)
        setBaseline(loaded)
        if (metaVersion !== undefined) setVersion(metaVersion)
      }, [draft, complete, loaded, metaVersion])

      const dirty = draft !== null && baseline !== null && draft !== baseline
      // A newer version than the one this buffer was built from, seen only after
      // a save recorded its own version — otherwise the first metadata frame
      // would read as a concurrent change.
      const superseded = dirty
        && version !== undefined
        && metaVersion !== undefined
        && metaVersion !== version
        && typeof loaded === 'string'
        && loaded !== baseline

      const save = React.useCallback(async (options) => {
        if (draft === null || saving) return
        const file = parseFileAddress(address)
        if (file === undefined) {
          setNotice({ kind: 'error', text: t('noAddress') })
          return
        }
        setSaving(true)
        setNotice(null)
        try {
          const payload = { sessionId: file.sessionId, path: file.path, content: draft }
          // `force` is the user accepting the overwrite after a conflict.
          const known = options?.force === true ? undefined : version ?? metaVersion
          if (known !== undefined) payload.version = known
          const response = await fetch(ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: tab?.signal,
          })
          const result = await response.json().catch(() => undefined)
          if (response.ok && result?.ok === true) {
            setBaseline(draft)
            setVersion(result.version)
            setNotice({ kind: 'ok', text: `${t('savedNotice')} · ${formatBytes(result.bytes, t)}` })
            return
          }
          if (response.status === 409) {
            setNotice({ kind: 'conflict', text: result?.message ?? t('conflictNotice') })
            return
          }
          setNotice({ kind: 'error', text: result?.message ?? `${t('saveFailed')} HTTP ${response.status}` })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')} ${error?.message ?? String(error)}` })
        } finally {
          setSaving(false)
        }
      }, [draft, saving, version, metaVersion, address, tab, t])

      const revert = React.useCallback(() => {
        const next = typeof loaded === 'string' ? loaded : baseline
        setDraft(next)
        setBaseline(next)
        if (metaVersion !== undefined) setVersion(metaVersion)
        setNotice(null)
      }, [loaded, baseline, metaVersion])

      // Ctrl+S saves while there is something to save; the same effect installs
      // the only unload guard a web page can raise.
      React.useEffect(() => {
        if (!dirty) return undefined
        const onKeyDown = (event) => {
          if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
            event.preventDefault()
            void save()
          }
        }
        const onBeforeUnload = (event) => {
          event.preventDefault()
          event.returnValue = ''
        }
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => {
          window.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('beforeunload', onBeforeUnload)
        }
      }, [dirty, save])

      /** Indent with Tab rather than moving focus out of the document. */
      const onEditorKeyDown = React.useCallback((event) => {
        if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        const element = event.target
        const start = element.selectionStart ?? 0
        const end = element.selectionEnd ?? start
        setDraft((current) => `${(current ?? '').slice(0, start)}${INDENT}${(current ?? '').slice(end)}`)
        requestAnimationFrame(() => {
          element.selectionStart = start + INDENT.length
          element.selectionEnd = start + INDENT.length
        })
      }, [])

      if (content !== undefined && content.kind !== 'text') {
        return h('div', { className: `${CLS}-root` },
          h('style', null, styles),
          h('div', { className: `${CLS}-empty` }, h('p', null, content.kind === 'renderer' ? t('binary') : t('reading')))
        )
      }

      if (typeof loaded !== 'string') {
        return h('div', { className: `${CLS}-root` },
          h('style', null, styles),
          h('div', { className: `${CLS}-empty` }, h('p', null, meta?.failure === undefined ? t('reading') : t('readFailed')))
        )
      }

      if (complete !== true) {
        return h('div', { className: `${CLS}-root` },
          h('style', null, styles),
          h('div', { className: `${CLS}-bar` },
            h('span', { className: `${CLS}-path`, title: absolutePath ?? '' }, absolutePath ?? t('incomplete')),
            h('span', { className: `${CLS}-state` }, t('stateClean'))
          ),
          h('div', { className: `${CLS}-notice ${CLS}-notice-conflict` },
            h('span', { className: `${CLS}-notice-text` }, t('incomplete'))
          ),
          h('pre', { className: `${CLS}-static` }, loaded)
        )
      }

      const conflict = notice?.kind === 'conflict'

      return h('div', { className: `${CLS}-root` },
        h('style', null, styles),
        h('div', { className: `${CLS}-bar` },
          h('span', { className: `${CLS}-path`, title: absolutePath ?? address ?? '' }, absolutePath ?? address ?? ''),
          h('span', { className: `${CLS}-dot ${dirty ? `${CLS}-dot-dirty` : `${CLS}-dot-clean`}` }),
          h('span', { className: `${CLS}-state` }, saving ? t('stateSaving') : dirty ? t('stateDirty') : t('stateClean')),
          h('button', {
            type: 'button',
            className: `${CLS}-btn ${CLS}-btn-primary`,
            disabled: !dirty || saving,
            onClick: () => { void save() },
          }, saving ? t('saving') : t('save')),
          h('button', {
            type: 'button',
            className: `${CLS}-btn`,
            disabled: !dirty || saving,
            onClick: revert,
          }, t('revert'))
        ),

        notice === null && !superseded ? null : h('div', {
          className: `${CLS}-notice ${CLS}-notice-${notice?.kind ?? 'conflict'}`,
        },
          h('span', { className: `${CLS}-notice-text` }, notice?.text ?? t('externalNotice')),
          h('span', { className: `${CLS}-notice-actions` },
            conflict ? h('button', {
              type: 'button',
              className: `${CLS}-btn`,
              onClick: () => { setNotice(null); void save({ force: true }) },
            }, t('overwrite')) : null,
            conflict || superseded ? h('button', {
              type: 'button',
              className: `${CLS}-btn`,
              onClick: revert,
            }, conflict ? t('reload') : t('loadFromDisk')) : null
          )
        ),

        h('textarea', {
          className: `${CLS}-editor`,
          ref: scrollportRef ?? undefined,
          value: draft ?? '',
          wrap: wrap ? 'soft' : 'off',
          spellCheck: false,
          autoComplete: 'off',
          autoCorrect: 'off',
          autoCapitalize: 'off',
          'aria-label': absolutePath ?? '',
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: onEditorKeyDown,
        })
      )
    }

    /** Renderer metadata for one editable registration. */
    function editableDefinition(id, extensions, priority, title) {
      return {
        id,
        extensions,
        priority,
        title,
        loading: 'text-pages',
        wrap: true,
      }
    }

    /** Services this page needs before it can render. */
    const inject = ['slots', 'locale', 'documentPreviews']

    /**
     * Register the editable renderers.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'document-editor: dictionaries')

      const previews = ctx.documentPreviews
      if (previews === undefined || typeof previews.register !== 'function') {
        ctx.logger?.warn?.('document-editor: ctx.documentPreviews is unavailable; no editable renderer was registered')
        return
      }

      if (EDITABLE_EXTENSIONS.length > 0) {
        ctx.effect(() => previews.register(
          editableDefinition(PLAIN_ID, EDITABLE_EXTENSIONS, 'extension', () => t('viewer.label'))
        ), 'document-editor: editable renderer')
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document',
          key: PLAIN_ID,
          locale: NS,
        }, EditableBody)), 'document-editor: editable body')
      }

      // Markdown keeps rendering by default: an equal-priority registration
      // sorts after the shipped one by registration order, so this only adds a
      // dropdown entry next to "Markdown".
      if (OFFER_MARKDOWN) {
        ctx.effect(() => previews.register(
          editableDefinition(MARKDOWN_ID, MARKDOWN_EXTENSIONS, 'builtin', () => t('viewer.labelMarkdown'))
        ), 'document-editor: markdown renderer')
        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document',
          key: MARKDOWN_ID,
          locale: NS,
        }, EditableBody)), 'document-editor: markdown body')
      }
    }

    return { inject, apply }
  },
})
