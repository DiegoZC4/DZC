import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../nutshell/app.js', import.meta.url), 'utf8');
class FakeElement {
  constructor() {
    this.dataset = {}; this.attrs = {}; this.events = {}; this.children = []; this.capture = null;
    this.classList = {add() {}, remove() {}};
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.events[event.type] || []) fn(event); }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
  emit(type, fields) { this.dispatchEvent({type, preventDefault() {}, ...fields}); }
}
const context = vm.createContext({
  document: {createElement: () => new FakeElement()}, Event,
  phaseNames: {write:'Write', mask:'Mask', guess:'Guess'}, settingsDirty: false,
  settingsTimer: null, saveSettings() {}, clearTimeout() {}, setTimeout() { return 1; }
});
const helpers = source.slice(source.indexOf('function element('), source.indexOf('function playerName('));
const control = source.slice(source.indexOf('class NumSlider {'), source.indexOf('const sliders ='));
vm.runInContext(`${helpers}\n${control}\nglobalThis.slider = new NumSlider('write', 60);`, context);
const slider = context.slider;
let changes = 0;
slider.num.addEventListener('input', () => changes++);
slider.num.emit('pointerdown', {button:0, pointerId:1, clientY:100, clientX:100});
slider.num.emit('pointermove', {pointerId:1, clientY:100, clientX:900});
assert.equal(slider.value, 60); assert.equal(changes, 0, 'sideways movement must not change time');
slider.num.emit('pointermove', {pointerId:1, clientY:96, clientX:900});
assert.equal(slider.value, 65); assert.equal(changes, 1);
slider.num.emit('pointermove', {pointerId:1, clientY:96, clientX:1200});
assert.equal(changes, 1, 'no-op steps must not emit');
slider.num.emit('pointermove', {pointerId:1, clientY:100, clientX:1200});
assert.equal(slider.value, 60, 'returning to original height restores value');
slider.num.emit('pointermove', {pointerId:1, clientY:-1000}); assert.equal(slider.value, 300);
slider.num.emit('pointermove', {pointerId:1, clientY:1000}); assert.equal(slider.value, 5);
slider.num.emit('pointerup', {pointerId:1}); assert.equal(slider.drag, null);
slider.num.emit('keydown', {key:'ArrowUp'}); assert.equal(slider.value, 10);
slider.num.emit('keydown', {key:'End'}); assert.equal(slider.value, 300);
slider.num.emit('keydown', {key:'Home'}); assert.equal(slider.value, 5);
assert.equal(slider.num.dataset.value, '5');
assert.equal(slider.num.attrs['aria-valuenow'], '5');
assert.equal(slider.num.attrs['aria-valuetext'], '5 seconds');
console.log('Vertical dragging, horizontal invariance, return-to-origin, snapping, clamps and keyboard access passed.');
