const {test}=require('node:test'),assert=require('node:assert/strict');
const {safeShotName,trimRange,cropRect}=require('../studio-shared');
test('screenshot paths cannot escape their folder',()=>{assert.equal(safeShotName('Снимок 1.png'),'Снимок 1.png');for(const n of ['../x.png','a\\b.png','C:x.png','video.mp4','x\0.png'])assert.throws(()=>safeShotName(n));});
test('trim ranges reject invalid values and preserve duration',()=>{assert.deepEqual(trimRange(1,3,4),{start:1,end:3});for(const r of [[-1,2,3],[2,1,3],[0,4,3],[NaN,2,3],[0,Infinity,3],[0,2,null]])assert.throws(()=>trimRange(...r));});
test('crop is clamped to source pixels',()=>{assert.deepEqual(cropRect({x:-10,y:20,width:300,height:500},200,100),{x:0,y:20,width:200,height:80});assert.deepEqual(cropRect(null,1920,1080),{x:0,y:0,width:1920,height:1080});});
