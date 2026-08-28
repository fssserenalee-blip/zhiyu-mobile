import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonalSetup, decodePersonalSetup, mergeSetupPlans } from '../src/personal-plan.ts';

// Synthetic fixtures only. Never commit an actual user's configuration here.
const fixture = () => ({v:1, k:'synthetic-test', s:[83,500,40,20,7], c:[['孩子',10],['水电物业通讯',10.25],['其他',2.75]], x:['老人赡养','车辆交通'], b:['物业费'], p:[['test-quarter','季度测试',7.25,'2026-10-01','quarterly','物业费']]});
test('decodes a private UTF-8 fragment without a network request', () => {
  const parsed = decodePersonalSetup(Buffer.from(JSON.stringify(fixture())).toString('base64url'));
  assert.equal(parsed.settings.monthlyBudget,83);
  assert.equal(parsed.plannedExpenses[0].frequency,'quarterly');
  assert.equal(parsed.plannedExpenses[0].amount,7.25);
});
for(const [name,mutate] of [
  ['negative amount', f => f.s[0] = -1],
  ['fractional cent', f => f.s[0] = 1.001],
  ['invalid date', f => f.p[0][3] = '2026-02-30'],
  ['invalid frequency', f => f.p[0][4] = 'sometimes'],
  ['unknown category', f => f.c[0][0] = 'unknown'],
  ['duplicate plan id', f => f.p.push([...f.p[0]])],
  ['invalid version', f => f.v = 2],
]) test(`rejects ${name}`, () => { const f=fixture(); mutate(f); assert.throws(()=>parsePersonalSetup(f)); });
test('rejects corrupted and oversized encoded input',()=> {
  assert.throws(()=>decodePersonalSetup('%broken'));
  assert.throws(()=>decodePersonalSetup('A'.repeat(20001)));
});
test('preserves existing plans, paid occurrences, disabled state and input arrays',()=> {
  const incoming=parsePersonalSetup(fixture()).plannedExpenses;
  const existing=[{...incoming[0], dueDate:'2026-07-01', active:false, paidOccurrences:['2026-07-01']}, {...incoming[0],id:'unrelated',title:'保留此计划'}];
  const result=mergeSetupPlans(existing,incoming);
  assert.equal(result.length,2);
  assert.equal(result[0].dueDate,'2026-10-01');
  assert.equal(result[0].active,false);
  assert.deepEqual(result[0].paidOccurrences,['2026-07-01']);
  assert.equal(existing[0].dueDate,'2026-07-01');
  assert.deepEqual(mergeSetupPlans(result,incoming),result);
});
test('recognizes same manually created plan without duplicating it',()=> {
  const incoming=parsePersonalSetup(fixture()).plannedExpenses;
  const existing=[{...incoming[0],id:'manual-id',paidOccurrences:['2026-10-01']}];
  const result=mergeSetupPlans(existing,incoming);
  assert.equal(result.length,1);
  assert.equal(result[0].id,'manual-id');
  assert.deepEqual(result[0].paidOccurrences,['2026-10-01']);
});
