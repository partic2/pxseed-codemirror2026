
import * as React from 'preact'
import { openNewWindow } from 'partic2/pComponentUi/workspace'
import { requirejs } from 'partic2/jsutils1/base';
import { GetJsEntry, path } from 'partic2/jsutils1/webutils';
import { setBaseWindowView } from 'partic2/pComponentUi/workspace';
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import { Transport } from './lsp-client';
import { easyCallRemoteJsonFunction, getPersistentRegistered, importRemoteModule, ServerHostWorker1RpcName } from 'partic2/pxprpcClient/registry'

const __name__ = requirejs.getLocalRequireModule(require);



let lspConsole = new ReactRefEx<{
    info: (msg:{summary:string,detail?:string}) => void
    warn: (msg:{summary:string,detail?:string}) => void
}>();

interface LspServer {
    writeMessage(msg: string): Promise<void>;
    readMessage(): Promise<string>;
    close(): Promise<void>;
}

class CmLspTransport implements Transport {
    constructor(public lspserver: LspServer) { }
    async send(message: string) {
        this.lspserver.writeMessage(message);
        let {method}=JSON.parse(message);
        lspConsole.current?.info({summary:`SEND ${method}`,detail:message});
    }
    cb: ((value: string) => void) | null = null;
    protected async __poll() {
        if (this.cb == null) return;
        let cb = this.cb;
        while (this.cb == cb) {
            let msg = await this.lspserver.readMessage()
            let {method}=JSON.parse(msg);
            lspConsole.current?.info({summary:`RECV ${method}`,detail:msg});
            cb(msg);
        }
    }
    subscribe(handler: (value: string) => void): void {
        this.cb = handler;
        this.__poll();
    }
    unsubscribe(handler: (value: string) => void): void {
        this.cb = null;
    }
}

class LspConsole extends React.Component<{}, { history: Array<{ level: 'info' | 'warn', summary:string,detail?:string }>, filter: string,expanded:Set<number> }> {
    constructor(p: any, c: any) {
        super(p, c);
        this.setState({ history: [], filter: '',expanded:new Set<number>() });
    }
    info(msg:{summary:string,detail?:string}) {
        this.state.history.push({level:'info',...msg});
        this.setState({})
    }
    warn(msg:{summary:string,detail?:string}) {
        this.state.history.push({level:'warn',...msg});
        this.setState({})
    }
    onFilterChange = (ev: React.TargetedInputEvent<HTMLInputElement>) => {
        this.setState({ filter: (ev.target as any).value })
    }
    clearHistory() {
        this.setState({ history: [] })
    }
    render(props?: Readonly<React.Attributes & { children?: React.ComponentChildren; ref?: React.Ref<any> | undefined; }> | undefined, state?: Readonly<{}> | undefined, context?: any): React.ComponentChildren {
        return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flexGrow: '1', flexShrink: '1', overflow: 'auto' }}>{this.state.history.filter(t1 => t1.summary.includes(this.state.filter) || t1.detail?.includes(this.state.filter)).map((t1,t2) => {
                return <div style={{ whiteSpace: 'pre-wrap' }}>
                <a onClick={()=>{
                    if(this.state.expanded.has(t2)){this.state.expanded.delete(t2);}else{this.state.expanded.add(t2);}
                    this.setState({})
                }} href="javascript:;">[{t1.level}]:{t1.summary}</a>
                {this.state.expanded.has(t2)?<div style={{whiteSpace:'pre-wrap'}}>{t1.detail}</div>:null}</div>
            })}</div>
            <div style={{ flexShrink: '0', display: 'flex', flexDirection: 'row' }}>
                <input type='button' style={{ flexGrow: '0' }} value='clear' onClick={() => this.clearHistory()} />
                <input type='text' onChange={this.onFilterChange} style={{ flexGrow: '1' }} placeholder='filter' />
            </div>
        </div>
    }

}

async function codeMirrorDemoWithTsLsp() {
    let div1Ref = new ReactRefEx<HTMLDivElement>();
    let handler = await openNewWindow(<div ref={div1Ref} style={{ height: '100%', minHeight: '100px' }}></div>,{title:'Code mirror demo with ts lsp'});
    let div1 = await div1Ref.waitValid();
    let cm = await import('codemirror');
    let cms = await import('@codemirror/state')
    let cmv = await import('@codemirror/view')
    let cmjs = await import('@codemirror/lang-javascript');
    let cmlsp = await import('partic2/codemirror2026/lsp-client/index')
    let cmc = await import('@codemirror/autocomplete');
    let rpc1=await (await getPersistentRegistered(ServerHostWorker1RpcName))!.ensureConnected();
    let remoteLspConnection=await importRemoteModule(rpc1,'partic2/typescriptLanguageServer2026/lsp-connection')
    let remoteWWWRoot=await easyCallRemoteJsonFunction(rpc1,'partic2/jsutils1/webutils','getWWWRoot',[]) as string;
    let tsdemopath=path.join(remoteWWWRoot.replace(/\\/g,'/'),'..','source/partic2/codemirror2026/webui.tsx');
    if(!tsdemopath.startsWith('/'))tsdemopath='/'+tsdemopath;
    let client = new cmlsp.LSPClient({ extensions: cmlsp.languageServerExtensions() }).connect(new CmLspTransport(await remoteLspConnection.createLspConnection({showMessageLevel:3})));
    await client.initializing
    let ev = new cm.EditorView({
        state: cms.EditorState.create({
            extensions: [
                cm.basicSetup, cmjs.javascript({ typescript: true }), cmv.keymap.of([
                    {
                        key: 'Tab',
                        run: cmc.acceptCompletion,
                    },
                ]),
                client.plugin('file://'+tsdemopath, 'typescript')
            ],
        }),
        parent: div1
    });
    openNewWindow(<LspConsole ref={lspConsole} />, { parentWindow: handler,title:'language server log' });
    await handler.waitClose();
}

//Open from packageManager.
export function main(args: string) {
    if (args == 'webui') {
        codeMirrorDemoWithTsLsp()
    }
}