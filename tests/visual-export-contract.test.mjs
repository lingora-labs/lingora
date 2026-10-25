// Static release contract. Chromium verifies actual bytes and downloaded
// visual fidelity separately; this only prevents accidental wiring removal.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const view=fs.readFileSync(new URL('../app/beta/beta-schema-b.tsx',import.meta.url),'utf8')
const plan=fs.readFileSync(new URL('../server/core/tutor-first-plan.ts',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
for (const signal of [
 "ref={exportRef}","import('html-to-image')","import('pdf-lib')",
 "pdf.embedPng(","onClick={()=>void exportVisual('png')}","onClick={()=>void exportVisual('pdf')}","t('Descargar PNG')","t('Descargar PDF')",
 "setCollapsed({})","setCollapsed(previous)","data-export-ignore",
 "new Blob([bytes as BlobPart]","role=\"alert\"",
 "const captureWidth = 580","toPng(exportRef.current", "width:captureWidth", "style:{width:captureWidth",
]) assert.ok(view.includes(signal),'missing export mechanism: '+signal)
assert.ok(!view.includes("'-10000px'"),'offscreen foreignObject clone can export empty color-only raster')
assert.ok(pkg.dependencies['html-to-image'],'missing renderer dependency')
assert.ok(plan.includes('freeOpeningGreeting'),'first real free learner greeting must get first-turn treatment')
assert.ok(plan.includes("? 'FIRST_TURN_DIRECTIVE'"),'free greeting must reach the Tutor Maestro')
console.log('PASS — visual exporter wiring and first real free greeting routing. E2E bytes still required.')
