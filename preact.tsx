
import * as React from 'preact'
import { ReactRefEx } from 'partic2/pComponentUi/domui';

import * as cms from '@codemirror/state';
import * as cmjs from '@codemirror/lang-javascript';
import * as cmv from '@codemirror/view';
import * as cmac from '@codemirror/autocomplete';
import * as cml from '@codemirror/lint';
import * as codemirror from 'codemirror'


export class CodeMirrorEditor<P={}> extends React.Component<P&{
    divAttr?:React.HTMLAttributes<HTMLDivElement>,divStyle?:React.CSSProperties,
    onDocumentChange?:(editor:CodeMirrorEditor,update:cmv.ViewUpdate)=>void,
}>{
    divRef=new ReactRefEx<HTMLDivElement>()
    async getCodemirrorExtendsions(){
        return [
            codemirror.basicSetup, cmjs.javascript({ typescript: true }), cms.Prec.high(cmv.keymap.of([])),
            cmv.EditorView.updateListener.of((update)=>{
                if(update.docChanged){
                    this.onDocumentChange(update);
                }
            }),
            cml.linter((view)=>this.provideLint(view)),
            cmac.autocompletion({
                override: [(context)=>this.provideCompletion(context)??null],
            }),
            cmv.hoverTooltip((view,pos,side)=>this.provideHoverTooltip(view,pos,side))
        ]
    }
    codemirrorEditorView?:cmv.EditorView;
    async componentDidMount() {
        let div=await this.divRef.waitValid();
        let extensions:cms.Extension[] = [
            ...await this.getCodemirrorExtendsions()
        ]
        this.codemirrorEditorView = new cmv.EditorView({
            state: cms.EditorState.create({
                extensions,
            }),
            parent: div,
        });
    }
    async provideCompletion(context:cmac.CompletionContext):Promise<cmac.CompletionResult|null>{
        return null;
    }
    async provideLint(view:cmv.EditorView):Promise<cml.Diagnostic[]>{
        return [];
    }
    async provideHoverTooltip(view: cmv.EditorView, pos: number, side: number):Promise<cmv.Tooltip | readonly cmv.Tooltip[] | null>{
        return null
    }
    async onDocumentChange(update:cmv.ViewUpdate){
        this.props.onDocumentChange?.(this,update)
    }
    render(): React.ComponentChildren {
        return <div {...this.props.divAttr} style={{...this.props.divStyle}} ref={this.divRef}></div>
    }
}