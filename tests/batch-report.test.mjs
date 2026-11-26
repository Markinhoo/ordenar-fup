import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/lib/batchReport.js',import.meta.url),'utf8');
const {batchSummary,batchReportRows}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const batch={fileName:'Lote.xlsx',qna:'202622',workers:[{id:'a',name:'Ana'},{id:'b',name:'Bea'}],records:[
{folio:'1',assignedWorkerId:'a',digital:true,checkedAt:'2026-11-26T10:00:00Z',checkedBy:'Bea'},
{folio:'2',assignedWorkerId:'b',digital:true,checkedAt:null},
{folio:'3',assignedWorkerId:null,digital:false,checkedAt:'2026-11-26T11:00:00Z',checkedBy:'Admin',observation:'Documento físico adicional'}]};
test('report counts include pending and manually added documents',()=>{
 assert.deepEqual(batchSummary(batch),{total:3,checked:2,pending:1,added:1});
 const rows=batchReportRows(batch,'2026-11-26');
 assert.ok(rows.some(r=>r[0]==='Sin asignar' && r[1]===1 && r[2]===1));
 assert.ok(rows.some(r=>r[1]==='1' && r[2]==='Ana' && r[4]==='Bea'));
 assert.ok(rows.some(r=>r[1]==='3' && r[9]==='Añadido manualmente'));
 assert.ok(rows.some(r=>r[0]==='Estado' && r[1]==='Con pendientes'));
});
test('empty batch totals are zero',()=>assert.deepEqual(batchSummary({...batch,records:[]}),{total:0,checked:0,pending:0,added:0}));
