
import * as React from 'preact'
import { ReactRefEx } from 'partic2/pComponentUi/domui';

import * as cms from './prebuilt/@codemirror-state';
import * as cmjs from './prebuilt/@codemirror-lang-javascript';
import * as cmv from './prebuilt/@codemirror-view';
import * as cmac from './prebuilt/@codemirror-autocomplete';
import * as cml from './prebuilt/@codemirror-lint';
import * as codemirror from './prebuilt/codemirror'



export class CodeMirrorEditor<P = {}> extends React.Component<P & {
    layoutHeight?:'fill parent'|'match content'
    divAttr?: React.HTMLAttributes<HTMLDivElement>, divStyle?: React.CSSProperties,
    onDocumentChange?: (editor: CodeMirrorEditor, update: cmv.ViewUpdate) => void,
}> {
    containerDiv = new ReactRefEx<HTMLDivElement>();
    codemirrorKeybinding = new Array<cmv.KeyBinding>();
    keymapCompartment = new cms.Compartment();
    domEventCompartment=new cms.Compartment();
    domEventHandlers:cmv.DOMEventHandlers<any>={};
    async getCodemirrorExtendsions() {
        return [
            codemirror.basicSetup, cmjs.javascript({ typescript: true }),
            this.keymapCompartment.of(cms.Prec.high(cmv.keymap.of(this.codemirrorKeybinding))),
            this.domEventCompartment.of(cmv.EditorView.domEventHandlers(this.domEventHandlers)),
            cmv.EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    this.onDocumentChange(update);
                }
            }),
            cml.linter((view) => this.provideLint(view)),
            cmac.autocompletion({
                override: [(context) => this.provideCompletion(context) ?? null],
                activateOnCompletion: () => true
            }),
            cmv.hoverTooltip((view, pos, side) => this.provideHoverTooltip(view, pos, side))
        ]
    }
    codemirrorEditorView?: cmv.EditorView;
    async componentDidMount() {
        let div = await this.containerDiv.waitValid();
        let extensions: cms.Extension[] = [
            ...await this.getCodemirrorExtendsions()
        ]
        this.codemirrorEditorView = new cmv.EditorView({
            state: cms.EditorState.create({
                extensions,
            }),
            parent: div,
        });
        if(this.props.layoutHeight==='fill parent'){
            let  editorDiv=div.querySelector('.cm-editor') as HTMLDivElement|null;
            if(editorDiv!=null){
                editorDiv.style.height='100%'
            }
        }
    }
    getCurrentDocumentText(){
        let t1=this.codemirrorEditorView!.state.doc.toString();
        return t1;
    }
    async setCurrentDocumentText(text:string){
        let view=this.codemirrorEditorView
        if(view==undefined)return;
        let length=this.getCurrentDocumentText().length;
        view.dispatch({
            changes:{from:0,to:length,insert:text}
        });
    }
    async addKeybinding(binding: cmv.KeyBinding) {
        this.codemirrorKeybinding = [...this.codemirrorKeybinding, binding];
        this.codemirrorEditorView?.dispatch({
            effects: this.keymapCompartment.reconfigure(cms.Prec.high(cmv.keymap.of(this.codemirrorKeybinding))),
        });
    }
    async removeKeyBinding(key: string) {
        this.codemirrorKeybinding = this.codemirrorKeybinding.filter((b) => b.key !== key);
        this.codemirrorEditorView?.dispatch({
            effects: this.keymapCompartment.reconfigure(cms.Prec.high(cmv.keymap.of(this.codemirrorKeybinding))),
        });
    }
    async setDomEventHandlers(domEventHandlers:cmv.DOMEventHandlers<any>){
        this.domEventHandlers=domEventHandlers;
        this.codemirrorEditorView?.dispatch({
            effects:this.domEventCompartment.reconfigure(cmv.EditorView.domEventHandlers(this.domEventHandlers))
        });        
    }
    async provideCompletion(context: cmac.CompletionContext): Promise<cmac.CompletionResult | null> {
        return null;
    }
    async provideLint(view: cmv.EditorView): Promise<cml.Diagnostic[]> {
        return [];
    }
    async provideHoverTooltip(view: cmv.EditorView, pos: number, side: number): Promise<cmv.Tooltip | readonly cmv.Tooltip[] | null> {
        return null
    }
    async onDocumentChange(update: cmv.ViewUpdate) {
        this.props.onDocumentChange?.(this, update)
    }
    focus(){
        this.codemirrorEditorView!.focus();
    }
    select(args:{anchor:number,focus:number,scrollTo?:boolean}){
        let spec:cms.TransactionSpec={
            selection: { anchor: args.anchor,head:args.focus },
        }
        if(args.scrollTo){
            spec.effects=cmv.EditorView.scrollIntoView(args.focus, { y: 'center' }) // 'center' let the selected line be centered
        }
        this.codemirrorEditorView!.dispatch(spec);
    }
    activateHover(pos: number, side: -1 | 1) {
        cmv.activateHover(this.codemirrorEditorView!, pos, side, {
            until: (tr) => tr.docChanged
        })
    }
    render(): React.ComponentChildren {
        if(this.props.layoutHeight==='fill parent'){
            return <div style={{position:'relative',width:'100%',height:'100%'}}>
                <div {...this.props.divAttr} style={{overflow:'hidden',
                position:'absolute',left:'0px', top:'0px',width:'100%',height:'100%',
                ...this.props.divStyle }} ref={this.containerDiv}></div>
            </div>
        }else{
            return <div {...this.props.divAttr} style={{
            overflow:'hidden' ,...this.props.divStyle }} ref={this.containerDiv}></div>
        }
    }
}