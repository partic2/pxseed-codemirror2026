
import * as React from 'preact'
import { NewWindowHandle, openNewWindow } from 'partic2/pComponentUi/workspace'
import { assert, GenerateRandomString, requirejs, throwIfAbortError } from 'partic2/jsutils1/base';
import { GetJsEntry, path } from 'partic2/jsutils1/webutils';
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import { Transport } from './lsp-client/index';
import { easyCallRemoteJsonFunction, getAttachedRemoteRigstryFunction, getPersistentRegistered, importRemoteModule, openConnectionFromUrl, ServerHostWorker1RpcName } from 'partic2/pxprpcClient/registry'
import { LanguageServerConnection, PxseedExtendLanguageServer } from 'partic2/typescriptLanguageServer2026/pxseedutils/lspproxy'
import {TjsSfs} from 'partic2/CodeRunner/JsEnviron'

import type {EditorView} from '@codemirror/view'
import { RpcExtendClient1 } from 'pxprpc/extend';
import { Client } from 'pxprpc/base';
import { Singleton, utf8conv } from 'partic2/CodeRunner/jsutils2';
import { buildTjs } from 'partic2/tjshelper/tjsbuilder';

import type { RequestMessage, NotificationMessage, ResponseMessage } from 'vscode-jsonrpc/lib/common/messages';



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
    lspp:PxseedExtendLanguageServer
    constructor(lspserver: LspServer) {
        this.lspp=new PxseedExtendLanguageServer({
            async send(message: RequestMessage | NotificationMessage): Promise<void> {
                let encmsg=JSON.stringify(message);
                //lspConsole.current?.info({summary:'SEND ENCODED DATA',detail:encmsg})
                await lspserver.writeMessage(encmsg);
            },
            async receive(): Promise<ResponseMessage | NotificationMessage> {
                let encmsg=await lspserver.readMessage();
                //lspConsole.current?.info({summary:'RECV ENCODED DATA',detail:encmsg})
                return JSON.parse(encmsg)
            },
            close(){lspserver.close();}
        })
    }
    async send(message: string) {
        let request=JSON.parse(message);
        await this.lspp.send(request);
        lspConsole.current?.info({summary:`SEND ${request.method}`,detail:message});
    }
    cb: ((value: string) => void) | null = null;
    protected async __poll() {
        if (this.cb == null) return;
        let cb = this.cb;
        while (this.cb == cb) {
            let msg = await this.lspp.receive();
            let summary='undefined'
            if('method' in msg){
                summary=msg.method;
            }
            lspConsole.current?.info({summary:`RECV ${summary}`,detail:JSON.stringify(msg)});
            try{cb(JSON.stringify(msg));}catch(err:any){
                throwIfAbortError(err);
                lspConsole.current?.warn({summary:'LSP internal error:'+err,detail:err.stack})
            }
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




async function codemirrorDemoLanguageServerThreadFactory(){
    let conn=await openConnectionFromUrl('iooverpxprpc:server host/'+encodeURIComponent(`webworker:${__name__}.codemirrorDemoLanguageThread`));
    assert(conn!=null);
    let client=await new RpcExtendClient1(new Client(conn)).init();
    return client;
}

export let codemirrorDemoLanguageServerThread=new Singleton(codemirrorDemoLanguageServerThreadFactory)

export async function resetcodemirrorDemoLanguageServerThread(){
    if(codemirrorDemoLanguageServerThread.done){
        let func=await getAttachedRemoteRigstryFunction(codemirrorDemoLanguageServerThread);
        await func.jsExec(`globalThis.close();`,null).catch((err)=>{});
        codemirrorDemoLanguageServerThread=new Singleton(codemirrorDemoLanguageServerThreadFactory);
    }
}

import type {LSPClient} from 'partic2/codemirror2026/lsp-client/index';
async function openTsFileInSubwindow(parentWindow:NewWindowHandle,client:LSPClient){
    let cm = await import('codemirror');
    let cms = await import('@codemirror/state')
    let cmv = await import('@codemirror/view')
    let cmjs = await import('@codemirror/lang-javascript');
    let cmc = await import('@codemirror/autocomplete');
    
    let remoteWWWRoot=await easyCallRemoteJsonFunction(codemirrorDemoLanguageServerThread,'partic2/jsutils1/webutils','getWWWRoot',[]) as string;

    let tsfiles=['source/partic2/codemirror2026/webui.tsx','source/partic2/pxprpcClient/registry.ts','source/partic2/packageManager/misc.ts',
        'source/partic2/jsutils1/serviceworker.ts','source/partic2/JsNotebook/filebrowser.tsx','source/partic2/nodehelper/env.ts'
    ].map(t1=>path.join(remoteWWWRoot.replace(/\\/g,'/'),'..',t1)).map(t1=>'file://'+(t1.startsWith('/')?'':'/')+t1.replace(/:/g,'%3A'));
    let keymap=cms.Prec.high(cmv.keymap.of([
        {
            key: 'Tab',
            run: cmc.acceptCompletion,
        }
    ]));
    let fs=new TjsSfs().from(await buildTjs());
    for(let t1 of tsfiles){
        let divRef=new ReactRefEx<HTMLDivElement>();
        let newWnd=await openNewWindow(<div ref={divRef} style={{ height: '100%', minHeight: '100px' }}></div>,
            {title:t1,parentWindow:parentWindow});
        let div=await divRef.waitValid();
        let ev=new cm.EditorView({
            state: cms.EditorState.create({
                extensions: [
                    cm.basicSetup, cmjs.javascript({ typescript: true }), keymap,
                    client.plugin(t1, 'typescript')
                ],
            }),
            parent: div
        });
        newWnd.waitClose().then(()=>{
            ev.destroy();
        })
        let bindata=await fs.readAll(t1.substring(7));
        if(bindata!=null){
            let content=utf8conv(bindata);
            ev.dispatch({changes:{from:0,to:ev.state.doc.length,insert:content}});
        }
    }
}

async function codemirrorDemoWithTsLsp(){
    await resetcodemirrorDemoLanguageServerThread();
    let remoteLspConnectionMod=await importRemoteModule(codemirrorDemoLanguageServerThread,'partic2/typescriptLanguageServer2026/lsp-connection') as typeof import('partic2/typescriptLanguageServer2026/lsp-connection')
    let conn=await remoteLspConnectionMod.createLspConnection({showMessageLevel:2});
    let lsptransport=new CmLspTransport(conn);
    let cmlsp = await import('partic2/codemirror2026/lsp-client/index')
    let client = new cmlsp.LSPClient({ extensions: cmlsp.languageServerExtensions() }).connect(lsptransport);
    await client.initializing;
    let handler = await openNewWindow(<div style={{minHeight:'400px',display:'flex',flexDirection:'column',height:'100%'}}>
        <div style={{flex:1,minHeight:'0px'}}><LspConsole ref={lspConsole}/></div>
        <button style={{flexShrink:1}} onClick={async ()=>{
            openTsFileInSubwindow(handler,client);
        }}>OPEN Files</button>
    </div>, { title:'language server log' });
    await lspConsole.waitValid();
    let remoteTsService=await importRemoteModule(codemirrorDemoLanguageServerThread,'partic2/typescriptLanguageServer2026/tsServer/serverProcess') as typeof import('partic2/typescriptLanguageServer2026/tsServer/serverProcess');
    handler.waitClose().then(()=>{conn.close();null})
}


async function codemirrorNotebookDemoWithTsLsp() {
    await resetcodemirrorDemoLanguageServerThread();
    let handler = await openNewWindow(<LspConsole ref={lspConsole} />, { title:'language server log' });
    await lspConsole.waitValid();
    let cm = await import('codemirror');
    let cms = await import('@codemirror/state')
    let cmv = await import('@codemirror/view')
    let cmjs = await import('@codemirror/lang-javascript');
    let cmlsp = await import('partic2/codemirror2026/lsp-client/index')
    let cmc = await import('@codemirror/autocomplete');
    let remoteLspConnection=await importRemoteModule(codemirrorDemoLanguageServerThread,'partic2/typescriptLanguageServer2026/lsp-connection')
    let remoteWWWRoot=await easyCallRemoteJsonFunction(codemirrorDemoLanguageServerThread,'partic2/jsutils1/webutils','getWWWRoot',[]) as string;
    let tsdemopath=path.join(remoteWWWRoot.replace(/\\/g,'/'),'..','source/partic2/codemirror2026/webui.tsx');
    if(!tsdemopath.startsWith('/'))tsdemopath='/'+tsdemopath;
    tsdemopath='file://'+tsdemopath.replace(/:/g,'%3A');
    let lsptransport=new CmLspTransport(await remoteLspConnection.createLspConnection({showMessageLevel:2}));
    let client = new cmlsp.LSPClient({ extensions: cmlsp.languageServerExtensions() }).connect(lsptransport);
    await client.initializing;

    await lsptransport.lspp.ensureFileDidOpen({uri:tsdemopath,languageId:'typescript'});
    let predefinePart=await lsptransport.lspp.allocateFilePart(tsdemopath);
    await lsptransport.lspp.sendDidChange({uri:predefinePart.uri,change:{text:`declare let deleteVariables:(names:string[])=>void`}});

    let div1Ref = new ReactRefEx<HTMLDivElement>();
    let cell1Part=await lsptransport.lspp.allocateFilePart(tsdemopath);
    await openNewWindow(<div ref={div1Ref} style={{ height: '100%', minHeight: '100px' }}></div>,
        {title:'Code mirror demo with ts lsp(cell 1)',parentWindow:handler});
    let div1 = await div1Ref.waitValid();

    let codeMirrorBoundSymbol=Symbol.for('codeMirrorBoundSymbol')

    let keymap=cms.Prec.high(cmv.keymap.of([
        {
            key: 'Tab',
            run: cmc.acceptCompletion,
        }
    ]))

    let ev=new cm.EditorView({
        state: cms.EditorState.create({
            extensions: [
                cm.basicSetup, cmjs.javascript({ typescript: true }), keymap,
                client.plugin(cell1Part.uri, 'typescript')
            ],
        }),
        parent: div1
    });
    (ev as any)[codeMirrorBoundSymbol]={tsurl:cell1Part.uri};
    ev.dispatch({
        changes:{from:0,to:ev.state.doc.toString().length,insert:`let _ENV=globalThis;\nconsole.info("hello codemirror")`}
    });
    
        
    let div3Ref=new ReactRefEx<HTMLDivElement>();
    let cell3Part=await lsptransport.lspp.allocateFilePart(tsdemopath);
    await openNewWindow(<div ref={div3Ref} style={{ height: '100%', minHeight: '100px' }}></div>,
        {title:'Code mirror demo with ts lsp(cell 3)',parentWindow:handler});
    let div3 = await div3Ref.waitValid();
    ev=new cm.EditorView({
        state: cms.EditorState.create({
            extensions: [
                cm.basicSetup, cmjs.javascript({ typescript: true }), keymap,
                client.plugin(cell3Part.uri, 'typescript')
            ],
        }),
        parent: div3
    });
    (ev as any)[codeMirrorBoundSymbol]={tsurl:cell3Part.uri};

    let div2Ref=new ReactRefEx<HTMLDivElement>();
    let cell2Part=await lsptransport.lspp.allocateFilePart(tsdemopath,{insertBefore:cell3Part});
    await openNewWindow(<div ref={div2Ref} style={{ height: '100%', minHeight: '100px' }}></div>,
        {title:'Code mirror demo with ts lsp(cell 2)',parentWindow:handler});
    let div2 = await div2Ref.waitValid();
    ev=new cm.EditorView({
        state: cms.EditorState.create({
            extensions: [
                cm.basicSetup, cmjs.javascript({ typescript: true }), keymap,
                client.plugin(cell2Part.uri, 'typescript')
            ],
        }),
        parent: div2
    });
    (ev as any)[codeMirrorBoundSymbol]={tsurl:cell1Part.uri};
    await handler.waitClose();
}

//Open from packageManager.
export function main(args: string) {
    if (args == 'webui') {
        codemirrorDemoWithTsLsp();
    }
}