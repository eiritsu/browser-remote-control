# React/Form Automation via CDP eval_js

When automating React-based web forms (GitHub, BOSS直聘, etc.), `element.value = x` doesn't trigger React's state update.

## React-compatible value setting

```javascript
// Standard input setting (FAILS on React)
input.value = 'text';
input.dispatchEvent(new Event('input', { bubbles: true }));

// React-compatible (USES native setter to bypass React's proxy)
var nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeSetter.call(input, 'text');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

## Finding form elements

```javascript
// List all inputs with their attributes
JSON.stringify([...document.querySelectorAll('input')]
  .map(i => ({id: i.id, name: i.name, placeholder: i.placeholder, type: i.type}))
  .filter(i => i.id || i.name));
```

## Clicking buttons by text

```javascript
// Find and click button by text content
var btns = [...document.querySelectorAll('button')];
var target = btns.find(b => b.textContent.trim() === '按钮文字');
if (target) target.click();
```

## Submitting forms

React forms often don't use traditional `<form>` submission. Use button click instead:

```javascript
// Find create/submit button and click
var btn = [...document.querySelectorAll('button')]
  .find(b => b.textContent.includes('创建'));
if (btn) btn.click();
```

## GitHub-specific selectors

- Repo name: `#repository-name-input` (note: hyphens, not underscores)
- Description: `input[name="Description"]`
- Public visibility: button with text "公共" / "Public"
- Create: button with text "创建仓库" / "Create repository"

## BOSS直聘 selectors

See `references/bosszhipin-selectors.md`.
