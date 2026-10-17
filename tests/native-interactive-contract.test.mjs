// FIELD QA 11 regression — no placeholders, no second model.
// Run from repository root: node tests/native-interactive-contract.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

function load(relative) {
  const filename = fileURLToPath(new URL('../' + relative, import.meta.url))
  const transpiled = ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText
  const mod = new Module(filename)
  mod.filename=filename
  mod.paths=Module._nodeModulePaths(path.dirname(filename))
  mod._compile(transpiled,filename)
  return mod.exports
}

const { parseClosedTutorTurn, COMPLETE_TUTOR_TURN_TOOL } = load('lib/artifact-signal.ts')
const { materializeNativeArtifact } = load('server/core/native-artifact.ts')
const allowed = COMPLETE_TUTOR_TURN_TOOL.function.parameters.properties.artifacts.items.properties.type.enum
for (const type of ['emit_pdf','emit_audio','table_matrix','schema_pro','quiz'])
  assert.ok(allowed.includes(type),'single closure must expose '+type)
const matrix = {
  type:'table_matrix',trigger:'explicit_user_request',subject:'SER/ESTAR',format:'native',
  content:{ title:'Matriz de SER y ESTAR',
    columns:[{key:'uso',label:'Uso'},{key:'ej',label:'Ejemplo'},{key:'error',label:'Error'},{key:'fix',label:'Corrección'}],
    rows:[
      [{text:'Identidad',tone:'info'},{text:'Soy médico',tone:'ok'},{text:'Estoy médico',tone:'danger'},{text:'Soy médico',tone:'ok'}],
      [{text:'Estado',tone:'warn'},{text:'Estoy cansado',tone:'ok'},{text:'Soy cansado',tone:'danger'},{text:'Estoy cansado',tone:'ok'}],
    ],
  },
}
const schema = { type:'schema_pro',trigger:'explicit_user_request',subject:'Esquema SER/ESTAR',format:'native',
  content:{title:'Diferenciar SER y ESTAR',blocks:[
    {type:'concept',title:'Identidad',body:'Soy médico describe una profesión.'},
    {type:'concept',title:'Estado',body:'Estoy cansado describe cómo me encuentro.'},
    {type:'flow',steps:['Identifica el significado','Elige ser o estar']},
  ]},
}
const quiz = { type:'quiz',trigger:'explicit_user_request',subject:'Simulacro SER/ESTAR',format:'native',
  content:{title:'Quiz de tres preguntas',questions:[
    {question:'Ella ___ médica',options:['es','está','soy'],correct:0,explanation:'Profesión'},
    {question:'Hoy ___ contento',options:['soy','estoy','es'],correct:1,explanation:'Estado'},
    {question:'Madrid ___ en España',options:['es','está','somos'],correct:1,explanation:'Ubicación'},
  ]},
}
for (const signal of [matrix,schema,quiz]) {
  const closure = parseClosedTutorTurn({reply:'Una explicación útil con ejemplos.',artifacts:[signal]})
  assert.ok(closure,'tutor closure must accept '+signal.type)
  const actual = materializeNativeArtifact(closure.artifacts[0])
  assert.equal(actual?.type,signal.type)
  assert.equal(actual?.content?.title,signal.content.title)
}
assert.equal(materializeNativeArtifact({...matrix,content:{...matrix.content,rows:[]}}),null)
assert.equal(materializeNativeArtifact({...schema,content:{...schema.content,blocks:[]}}),null)
assert.equal(materializeNativeArtifact({...quiz,content:{...quiz.content,questions:[{question:'?',options:['A','B'],correct:3,explanation:'No'}]}}),null)
assert.equal(materializeNativeArtifact({...matrix,content:{...matrix.content,title:'<script>alert(1)</script>'}}),null)
assert.equal(parseClosedTutorTurn({reply:'Hi',artifacts:[{...matrix,format:'pdf'}]}),null)
assert.equal(parseClosedTutorTurn({reply:'Hi',artifacts:[]})?.artifacts.length,0)
console.log('PASS — closed tutor turn accepts validated matrix, schema and quiz; rejects empty, malicious and incompatible payloads')
