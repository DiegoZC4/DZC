// Pure JavaScript tests, not browser automation. Exercise history migration and
// grouping without touching the user's browser storage.
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = readFileSync(__dirname + '/index.html', 'utf8');
const script = html.split('<script>')[1].split('</script>')[0].replace('\ninit();', '');
const context = vm.createContext({document:{getElementById:()=>({})}});
vm.runInContext(script, context);
function evaluate(code) { return JSON.parse(JSON.stringify(vm.runInContext(code, context))); }
assert.deepEqual(evaluate("migrateCollectionFilters('mrgirl', [])"), [{type:'channel',value:'mrgirl',label:'mrgirl'}]);
assert.deepEqual(evaluate("migrateCollectionFilters('yarvin', [])")[0].value, 'Curtis Yarvin / Moldbug');
assert.deepEqual(evaluate("migrateCollectionFilters('barry-harris', [])")[0].value, 'Barry Harris');
assert.equal(evaluate("normalizeCachedSearch({collection:'yarvin',query:'monarchy',payload:{results:[{youtube_id:'old'}]}})").payload, undefined);
assert.equal(evaluate("normalizeCachedSearch({collection:'yarvin',query:'monarchy'})").channels[0].value, 'Curtis Yarvin / Moldbug');
assert.equal(evaluate("normalizeCachedSearch({cacheVersion:2,query:'monarchy',payload:{results:[{interview_id:'new'}]}})").payload.results[0].interview_id, 'new');
assert.equal(evaluate("groupResultsByVideo([{interview_id:'same',recording_id:'a'},{interview_id:'same',recording_id:'b'},{recording_id:'different'}])").length, 2);
assert.ok(!html.includes('id="collections"'));
assert.ok(!script.includes('selectedCollection'));
console.log('History migration, cache invalidation, unified picker and card grouping passed.');
