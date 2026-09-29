import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeMeetingSpeakers} from '../app/speakers.mjs';
test('ASR speakers appear without AI; zero, repeats and unknown labels handled',()=>{
  const meeting={speakers:[],transcriptSegments:[{speaker:0,speakerLabel:'发言人 0'},{speaker:'1',speakerLabel:'发言人 1'},{speaker:0,speakerLabel:'发言人 0'},{speaker:'',speakerLabel:'发言人 未区分'}]};
  const actual=mergeMeetingSpeakers(meeting);
  assert.deepEqual(actual,[{label:'发言人 0',assigneeId:'',ignored:false},{label:'发言人 1',assigneeId:'',ignored:false}]);
  assert.deepEqual(mergeMeetingSpeakers({...meeting,speakers:actual}),actual);
});
test('reanalysis preserves explicit member bindings and ignored speakers',()=>{
  const original={label:'发言人 0',assigneeId:'member_a',ignored:true};
  assert.deepEqual(mergeMeetingSpeakers({speakers:[original],transcriptSegments:[{speaker:1,speakerLabel:'发言人 1'}]},[{label:'发言人 0',assigneeId:'member_b',ignored:false}]),[original,{label:'发言人 1',assigneeId:'',ignored:false}]);
});
