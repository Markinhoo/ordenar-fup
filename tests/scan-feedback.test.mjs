import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const src=await readFile(new URL('../src/lib/scanFeedback.js',import.meta.url),'utf8');
const {scanFeedback}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
test('vibration failure cannot turn a saved scan into an error',()=>{
 Object.defineProperty(globalThis,'navigator',{value:{vibrate(){throw Error('Unsupported')}},configurable:true});
 assert.doesNotThrow(()=>scanFeedback('saved'));
});
test('success and duplicate use different vibration patterns',()=>{
 const calls=[];Object.defineProperty(globalThis,'navigator',{value:{vibrate(value){calls.push(value)}},configurable:true});
 scanFeedback('saved');scanFeedback('duplicate');assert.notDeepEqual(calls[0],calls[1]);
});
