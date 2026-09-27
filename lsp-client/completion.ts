import type * as lsp from "vscode-languageserver-protocol/lib/common/api"
import {EditorState, Extension, Facet, ChangeDesc, ChangeSpec} from "@codemirror/state"
import {EditorView} from "@codemirror/view"
import {CompletionSource, Completion, CompletionResult, CompletionContext,
        snippet, autocompletion, insertCompletionText} from "@codemirror/autocomplete"
import {LSPPlugin} from "./plugin"
import {fromPositionChecked} from "./pos"

// Convert from LSP's snippet syntax to @codemirror/autocompletion's
// one. Remove backslashes before `$}]`, which don't support backslash
// escapes in CodeMirror, and expand `$1` to `${1}`.
function lspToSnippet(text: string): string {
  return text.replace(/\\([$}\\])|\$(\d+)/g, (_m, esc, field) => esc || `\${${field}}`)
}

/// Register the [language server completion
/// source](#lsp-client.serverCompletionSource) as an autocompletion
/// source.
export function serverCompletion(config: {
  /// By default, the completion source that asks the language server
  /// for completions is added as a regular source, in addition to any
  /// other sources. Set this to true to make it replace all
  /// completion sources.
  override?: boolean
  /// Set a custom
  /// [`validFor`](#autocomplete.CompletionResult.validFor) expression
  /// to use in the completion results. By default, the library uses an
  /// expression that accepts word characters, optionally prefixed by
  /// any non-word prefixes found in the results.
  validFor?: RegExp
} = {}): Extension {
  let result: Extension[]
  if (config.override) {
    result = [autocompletion({override: [serverCompletionSource]})]
  } else {
    let data = [{autocomplete: serverCompletionSource}]
    result = [autocompletion(), EditorState.languageData.of(() => data)]
  }
  if (config.validFor) result.push(completionConfig.of({validFor: config.validFor}))
  return result
}

const completionConfig = Facet.define<{validFor: RegExp}, {validFor: RegExp | null}>({
  combine: results => results.length ? results[0] : {validFor: null}
})

function getCompletions(plugin: LSPPlugin, pos: number, context: lsp.CompletionContext, abort?: CompletionContext) {
  if (plugin.client.hasCapability("completionProvider") === false) return Promise.resolve(null)
  plugin.client.sync()
  let params: lsp.CompletionParams = {
    position: plugin.toPosition(pos),
    textDocument: {uri: plugin.uri},
    context
  }
  if (abort) abort.addEventListener("abort", () => plugin.client.cancelRequest(params))
  return plugin.client.request<lsp.CompletionParams, lsp.CompletionItem[] | lsp.CompletionList | null>(
    "textDocument/completion", params)
}

// Look for non-alphanumeric prefixes in the completions, and return a
// regexp that matches them, to use in validFor
function prefixRegexp(items: readonly lsp.CompletionItem[]) {
  let step = Math.ceil(items.length / 50), prefixes: string[] = []
  for (let i = 0; i < items.length; i += step) {
    let item = items[i], text = item.textEdit?.newText || item.textEditText || item.insertText || item.label
    if (!/^\w/.test(text)) {
      let prefix = /^[^\w]*/.exec(text)![0]
      if (prefixes.indexOf(prefix) < 0) prefixes.push(prefix)
    }
  }
  if (!prefixes.length) return /^\w*$/
  return new RegExp("^(?:" + prefixes.map((RegExp as any).escape || (s => s.replace(/[^\w\s]/g, "\\$&"))).join("|") + ")?\\w*$")
}

function shouldTriggerCompletion(plugin: LSPPlugin, character: string) : "identifier" | "triggerCharacter" | null {
  let triggers = plugin.client.serverCapabilities?.completionProvider?.triggerCharacters
  if (triggers && triggers.indexOf(character) > -1) return "triggerCharacter"
  if (/[a-zA-Z_]/.test(character)) return "identifier"
  return null
}

type TextEdit = {from: number, to: number, text: string}

type ExtraEdits = {index: number, edits: readonly TextEdit[], text: string}

function resultMapper(changes: ChangeDesc | null, extraEdits: ExtraEdits[]) {
  return (result: CompletionResult, newChanges: ChangeDesc): CompletionResult => {
    changes = changes ? changes.composeDesc(newChanges) : newChanges
    let options = result.options.slice()
    for (let {index, edits, text} of extraEdits)
      options[index] = {...options[index], apply: applyEdits(edits, text, changes)}
    return {
      ...result,
      options,
      map: resultMapper(changes, extraEdits)
    }
  }
}

function applyEdits(edits: readonly TextEdit[], text: string, mapped: ChangeDesc | null) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    let base = insertCompletionText(view.state, text, from, to)
    let changes: ChangeSpec[] = []
    for (let {from, to, text} of edits) {
      if (mapped) {
        if (mapped.touchesRange(from, to)) continue
        let len = to - from
        from = mapped.mapPos(from, 1)
        to = from + len
      }
      changes.push({from, to, insert: text})
    }
    view.dispatch(base, {changes})
  }
}

function makeResolveApply(
  plugin: LSPPlugin,
  item: lsp.CompletionItem,
  insert: string | ((view: EditorView, c: Completion, from: number, to: number) => void)
) {
  return (view: EditorView, completion: Completion, from: number, to: number)  => {
    debugger
    // 保存插入前的文档和插入参数
    let docBefore = view.state.doc
    let inserted: {from: number, to: number, text: string} | null =
      typeof insert == "string" ? {from, to, text: insert} : null

    // 执行主插入
    if (typeof insert == "function") {
      insert(view, completion, from, to)
    } else {
      let base = insertCompletionText(view.state, insert, from, to)
      view.dispatch(base)
    }

    // 异步 resolve
    plugin.client.request<lsp.CompletionItem, lsp.CompletionItem>(
      "completionItem/resolve",
      item
    ).then(resolved => {
      if (!view.dom.isConnected) return
      let edits = resolved.additionalTextEdits
      if (!edits || !edits.length) return

      // 把 resolve 的 range（基于 docBefore）映射到当前文档
      let changes: ChangeSpec[] = []
      for (let edit of edits) {
        let uri:string|null=null;
        if((edit as any).textDocument!=undefined){
          uri=(edit as any).textDocument.uri;
        }
        if(uri===null || uri===plugin.uri){
          let sf = fromPositionChecked(docBefore, edit.range.start)
          let st = fromPositionChecked(docBefore, edit.range.end)
          if (sf == null || st == null) continue

          // 若 edit 与被替换区间 [from, to] 重叠，跳过（避免破坏主插入）
          if (inserted) {
            if (sf < to && st > from) continue
            // 映射到当前文档
            let delta = inserted.text.length - (inserted.to - inserted.from)
            let nf = sf >= inserted.to ? sf + delta : sf
            let nt = st >= inserted.to ? st + delta : st
            if (nf > nt) continue
            changes.push({from: nf, to: nt, insert: edit.newText})
          } else {
            // snippet 路径：无法精确映射，退化为直接使用原位置（可能偏移）
            changes.push({from: sf, to: st, insert: edit.newText})
          }
        }
      }
      if (changes.length) view.dispatch({changes})
    }, err => {
      if ("code" in err && (err as lsp.ResponseError).code == -32800) return
      console.error("completionItem/resolve failed", err)
    })
  }
}

/// A completion source that requests completions from a language
/// server.
export const serverCompletionSource: CompletionSource = context => {
  const plugin = context.view && LSPPlugin.get(context.view)
  if (!plugin) return null
  let triggerChar = context.state.sliceDoc(context.pos - 1, context.pos)
  let triggerReason = context.explicit ? "invoked" : shouldTriggerCompletion(plugin, triggerChar)
  if (!triggerReason) return null
  let completionContext: lsp.CompletionContext = triggerReason == "triggerCharacter"
    ? {triggerKind: 2 /* TriggerCharacter */, triggerCharacter: triggerChar}
    : {triggerKind: 1 /* Invoked */}
  return getCompletions(plugin, context.pos, completionContext, context).then(result => {
    if (!result) return null
    if (Array.isArray(result)) result = {items: result} as lsp.CompletionList
    let {from, to} = completionResultRange(context, result)
    let defaultCommitChars = result.itemDefaults?.commitCharacters
    let config = context.state.facet(completionConfig)
    let extraEdits: ExtraEdits[] = []
    return {
      from, to,
      options: result.items.map<Completion>((item, i) => {
    let text = item.textEdit?.newText || item.textEditText || item.insertText || item.label
    let option: Completion = {
      label: item.filterText || item.label,
      displayLabel: item.label,
      type: item.kind && kindToType[item.kind],
    }
    let insertTextFormat = item.insertTextFormat ?? result.itemDefaults?.insertTextFormat
    if (item.commitCharacters && item.commitCharacters != defaultCommitChars)
      option.commitCharacters = item.commitCharacters
    if (item.detail) option.detail = item.detail
    if (item.sortText) option.sortText = item.sortText

    let canResolve = !!plugin.client.serverCapabilities?.completionProvider?.resolveProvider
      && item.data !== undefined
      && !item.additionalTextEdits

    if (insertTextFormat == 2 /* Snippet */) {
      if (canResolve) {
        option.apply = makeResolveApply(plugin, item, (view, c, from, to) =>
          snippet(lspToSnippet(text))(view, c, from, to))
      } else {
        option.apply = (view, c, from, to) => snippet(lspToSnippet(text))(view, c, from, to)
      }
    } else if (item.additionalTextEdits) {
      let edits: TextEdit[] = []
      for (let edit of item.additionalTextEdits) {
        let from = fromPositionChecked(context.state.doc, edit.range.start)
        let to = fromPositionChecked(context.state.doc, edit.range.end)
        if (from != null && to != null) edits.push({from, to, text: edit.newText})
      }
      extraEdits.push({index: i, text, edits})
      option.apply = applyEdits(edits, text, null)
    } else if (canResolve) {
      option.apply = makeResolveApply(plugin, item, text)
    } else if (option.label != text) {
      option.apply = text
    }

    if (item.documentation) option.info = () => renderDocInfo(plugin, item.documentation!)
    return option
  }),
      commitCharacters: defaultCommitChars,
      validFor: result.isIncomplete ? undefined : (config.validFor ?? prefixRegexp(result.items)),
      map: extraEdits.length ? resultMapper(null, extraEdits) : undefined
    }
  }, err => {
    if ("code" in err && (err as lsp.ResponseError).code == -32800 /* RequestCancelled */)
      return null
    throw err
  })
}

function completionResultRange(cx: CompletionContext, result: lsp.CompletionList): {from: number, to: number} {
  if (!result.items.length) return {from: cx.pos, to: cx.pos}
  let defaultRange = result.itemDefaults?.editRange, item0 = result.items[0]
  let range = defaultRange ? ("insert" in defaultRange ? defaultRange.insert : defaultRange)
    : item0.textEdit ? ("range" in item0.textEdit ? item0.textEdit.range : item0.textEdit.insert)
    : null
  if (!range) return cx.state.wordAt(cx.pos) || {from: cx.pos, to: cx.pos}
  let line = cx.state.doc.lineAt(cx.pos)
  return {from: line.from + range.start.character, to: line.from + range.end.character}
}

function renderDocInfo(plugin: LSPPlugin, doc: string | lsp.MarkupContent) {
  let elt = document.createElement("div")
  elt.className = "cm-lsp-documentation cm-lsp-completion-documentation"
  elt.innerHTML = plugin.docToHTML(doc)
  return elt
}

const kindToType: {[kind: number]: string} = {
  1: "text", // Text
  2: "method", // Method
  3: "function", // Function
  4: "class", // Constructor
  5: "property", // Field
  6: "variable", // Variable
  7: "class", // Class
  8: "interface", // Interface
  9: "namespace", // Module
  10: "property", // Property
  11: "keyword", // Unit
  12: "constant", // Value
  13: "constant", // Enum
  14: "keyword", // Keyword
  16: "constant", // Color
  20: "constant", // EnumMember
  21: "constant", // Constant
  22: "class", // Struct
  25: "type" // TypeParameter
}
