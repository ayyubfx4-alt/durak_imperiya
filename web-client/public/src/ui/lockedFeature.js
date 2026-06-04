import { h } from '../ui.js';
import { toast } from '../state.js';
import { featureLabel, getGamesPlayed, getRequired, isUnlocked, lockedMessage } from '../services/progression.js';

export function lockedOverlay(feature, label = featureLabel(feature)) {
  return h('div', { class: 'locked-feature-overlay', 'data-feature': feature }, [
    h('div', { class: 'locked-icon' }, ['LOCK']),
    h('div', { class: 'locked-label' }, [label]),
    h('div', { class: 'locked-hint' }, [lockedMessage(feature)]),
  ]);
}

export function applyLockState(element, feature, label = featureLabel(feature)) {
  if (!element || !feature) return element;
  const unlocked = isUnlocked(feature);
  element.dataset.featureLock = feature;
  element.classList.toggle('feature-locked', !unlocked);
  element.setAttribute('aria-disabled', unlocked ? 'false' : 'true');

  const existing = element.querySelector(':scope > .locked-feature-overlay');
  if (unlocked) {
    if (existing) existing.remove();
    return element;
  }

  if (!existing) element.appendChild(lockedOverlay(feature, label));
  if (element.dataset.lockBound !== '1') {
    element.dataset.lockBound = '1';
    element.addEventListener('click', lockClickHandler, true);
  }
  return element;
}

export function lockAwareClick(feature, action, label = featureLabel(feature)) {
  return (event) => {
    if (!isUnlocked(feature)) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      showLockedToast(feature, label);
      return;
    }
    action?.(event);
  };
}

export function showLockedPage(root, feature) {
  const required = getRequired(feature);
  const current = getGamesPlayed();
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'screen locked-route-screen' }, [
    h('section', { class: 'locked-route-panel' }, [
      h('div', { class: 'locked-route-icon' }, ['LOCK']),
      h('h1', {}, [featureLabel(feature)]),
      h('p', {}, [`Bu bo'lim ${required} ta o'yindan keyin ochiladi.`]),
      h('div', { class: 'locked-progress-line' }, [
        h('span', {}, [`${current}/${required}`]),
        h('i', {}, [h('b', { style: { width: `${Math.min(100, required ? (current / required) * 100 : 100)}%` } }, [])]),
      ]),
      h('button', {
        class: 'btn-big green',
        onclick: () => { location.hash = '#/lobby'; },
      }, ["O'yin boshlash"]),
    ]),
  ]));
}

function lockClickHandler(event) {
  const target = event.currentTarget;
  const feature = target?.dataset?.featureLock;
  if (!feature || isUnlocked(feature)) return;
  event.preventDefault();
  event.stopPropagation();
  const overlay = target.querySelector(':scope > .locked-feature-overlay');
  if (overlay) {
    overlay.classList.remove('shake');
    void overlay.offsetWidth;
    overlay.classList.add('shake');
  }
  showLockedToast(feature);
}

function showLockedToast(feature, label = featureLabel(feature)) {
  toast(`${label}: ${lockedMessage(feature)}`, 'info', 3000);
}
