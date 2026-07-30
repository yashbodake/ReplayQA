import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findNextAction, isFlowAction, isMenuToggle } from './action-selection.js';
import type { ActionCandidate } from '../discovery/browser/selector.js';

function action(label: string, type: ActionCandidate['type']): ActionCandidate {
  return { label, type, selector: label };
}

describe('action-selection', () => {
  it('prefers primary Add to cart over flow Shopping Cart', () => {
    const actions: ActionCandidate[] = [
      action('Open Menu', 'button'),
      action('Add to cart', 'button'),
      action('Shopping Cart', 'link'),
    ];
    const candidate = findNextAction(actions, new Set(), '', 0);
    assert.equal(candidate?.label, 'Add to cart');
  });

  it('prefers Shopping Cart over product links', () => {
    const actions: ActionCandidate[] = [
      action('Sauce Labs Backpack', 'link'),
      action('Shopping Cart', 'link'),
      action('Sauce Labs Bike Light', 'link'),
    ];
    const candidate = findNextAction(actions, new Set(), '', 0);
    assert.equal(candidate?.label, 'Shopping Cart');
  });

  it('skips menu togglers', () => {
    const actions: ActionCandidate[] = [
      action('Open Menu', 'button'),
      action('Close Menu', 'button'),
      action('Add to cart', 'button'),
    ];
    const candidate = findNextAction(actions, new Set(), '', 0);
    assert.equal(candidate?.label, 'Add to cart');
  });

  it('recognizes finish and complete as flow actions', () => {
    assert.ok(isFlowAction('Finish'));
    assert.ok(isFlowAction('Checkout: Complete!'));
    assert.ok(!isFlowAction('Add to cart'));
  });

  it('recognizes menu toggles', () => {
    assert.ok(isMenuToggle('Open Menu'));
    assert.ok(isMenuToggle('Close Menu'));
    assert.ok(isMenuToggle('menu'));
    assert.ok(!isMenuToggle('Add to cart'));
  });

  it('returns undefined when everything is tried', () => {
    const actions: ActionCandidate[] = [action('Add to cart', 'button')];
    const tried = new Set(['add to cart']);
    const candidate = findNextAction(actions, tried, '', 0);
    assert.equal(candidate, undefined);
  });
});
